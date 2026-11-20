import { type Db, type Prisma, ResearchReview, ResearchStatus } from "@crm/db";
import {
	RESEARCH_BUDGET,
	researchPeriodEnd,
	researchPeriodStart,
	workspaceCreditLimit,
	workspaceCreditUsage,
} from "@crm/db/research-budget";
import { settingsKey } from "@crm/db/settings";
import {
	type ResearchFinding,
	type ResearchFindings,
	researchFindings,
	researchMatch,
	researchSources,
} from "@crm/validation/research-result";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import type {
	ResearchDecideFindingInput,
	ResearchDecision,
	ResearchForRecord,
	ResearchForRecordInput,
	ResearchResultRow,
	ResearchUsage,
} from "./research.contracts";
import { RESEARCH } from "./research-config";
import { researchErrorCopy, researchRefusal } from "./research-copy";
import {
	COMPANY_ACCEPT_SELECT,
	CONTACT_ACCEPT_SELECT,
	canAcceptField,
	companyAcceptColumn,
	contactAcceptColumn,
	type ResearchRecordKind,
	sameValue,
} from "./research-fields";

type RecordRef = { kind: ResearchRecordKind; id: string };

const RESULT_SELECT = {
	id: true,
	companyId: true,
	contactId: true,
	task: true,
	status: true,
	partial: true,
	cacheHit: true,
	findings: true,
	sources: true,
	confidence: true,
	match: true,
	review: true,
	creditsUsed: true,
	error: true,
	retrievedAt: true,
	createdAt: true,
} as const satisfies Prisma.ResearchResultSelect;

type StoredResult = Prisma.ResearchResultGetPayload<{
	select: typeof RESULT_SELECT;
}>;

const lockedResult = z.object({
	id: z.string(),
	companyId: z.string().nullable(),
	contactId: z.string().nullable(),
	findings: z.json(),
	review: z.enum(
		Object.values(ResearchReview) as [ResearchReview, ...ResearchReview[]],
	),
});

const ANSWERED: ResearchStatus[] = [
	ResearchStatus.COMPLETE,
	ResearchStatus.PARTIAL,
	ResearchStatus.EMPTY,
];

const EMPTY_FINDINGS: ResearchFindings = { summary: null, items: [] };

function targetOf(row: {
	companyId: string | null;
	contactId: string | null;
}): RecordRef | null {
	if (row.contactId) return { kind: "contact", id: row.contactId };
	if (row.companyId) return { kind: "company", id: row.companyId };
	return null;
}

function rate(part: number, whole: number): number | null {
	return whole === 0 ? null : part / whole;
}

@Injectable()
export class ResearchService {
	private readonly logger = new Logger(ResearchService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async revision(input: ResearchForRecordInput): Promise<string> {
		await this.requireRecord(input);
		const revision = await this.db.researchResult.aggregate({
			where: input,
			_max: { updatedAt: true },
			_count: true,
		});
		return `${revision._count}/${revision._max.updatedAt?.getTime() ?? 0}`;
	}

	async forRecord(
		input: ResearchForRecordInput,
		now: Date = new Date(),
	): Promise<ResearchForRecord> {
		const record = await this.requireRecord(input);
		const staleBefore = new Date(
			now.getTime() - RESEARCH_BUDGET.reservationTtlMs,
		);

		const where: Prisma.ResearchResultWhereInput = {
			...(record.kind === "company"
				? { companyId: record.id }
				: { contactId: record.id }),
			NOT: {
				status: ResearchStatus.RESERVED,
				createdAt: { lt: staleBefore },
			},
		};

		const [rows, total] = await Promise.all([
			this.db.researchResult.findMany({
				where,
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: RESEARCH.page.size,
				select: RESULT_SELECT,
			}),
			this.db.researchResult.count({ where }),
		]);

		return { rows: rows.map((row) => this.present(row)), total };
	}

	async usage(now: Date = new Date()): Promise<ResearchUsage> {
		const setting = await this.db.appSetting.findUnique({
			where: settingsKey(),
			select: { researchCreditLimit: true },
		});
		const limit = workspaceCreditLimit(setting?.researchCreditLimit);
		const inPeriod = { createdAt: { gte: researchPeriodStart(now) } };

		const [credits, byStatus, cacheHits] = await Promise.all([
			workspaceCreditUsage(this.db, limit, now),
			this.db.researchResult.groupBy({
				by: ["status"],
				where: inPeriod,
				_count: { _all: true },
			}),
			this.db.researchResult.count({
				where: {
					...inPeriod,
					cacheHit: true,
					status: { in: [...ANSWERED, ResearchStatus.FAILED] },
				},
			}),
		]);

		const counts = new Map(
			byStatus.map((group) => [group.status, group._count._all]),
		);
		const countOf = (status: ResearchStatus) => counts.get(status) ?? 0;

		const succeeded = ANSWERED.reduce(
			(sum, status) => sum + countOf(status),
			0,
		);
		const failed = countOf(ResearchStatus.FAILED);
		const refused = countOf(ResearchStatus.REFUSED);
		const settled = succeeded + failed;
		const committed = credits.used + credits.reserved;

		return {
			period: credits.period,
			limit: credits.limit,
			used: credits.used,
			reserved: credits.reserved,
			remaining: credits.remaining,
			exhausted: credits.exhausted,
			warn:
				!credits.exhausted &&
				limit > 0 &&
				committed >= limit * RESEARCH_BUDGET.warnRatio,
			resetsAt: researchPeriodEnd(now).toISOString(),
			requests: settled + refused,
			cacheHits,
			cacheHitRate: rate(cacheHits, settled),
			succeeded,
			successRate: rate(succeeded, settled),
			failed,
			refused,
		};
	}

	async decideFinding(
		input: ResearchDecideFindingInput,
		userId: string,
	): Promise<ResearchDecision> {
		const decision = await this.db.$transaction(
			async (tx) => {
				const locked = await tx.$queryRaw<unknown[]>`
					SELECT "id", "companyId", "contactId", "findings", "review"
					FROM "researchResult"
					WHERE "id" = ${input.resultId}
					FOR UPDATE
				`;
				const [raw] = locked;

				if (!raw) {
					throw new NotFoundException(
						`No research result with id ${input.resultId}.`,
					);
				}

				const row = lockedResult.parse(raw);
				const findings = this.readFindings(row.id, row.findings);
				const matching = findings.items.filter(
					(item) => item.field === input.field,
				);
				const item =
					matching.find((candidate) => candidate.state === "suggested") ??
					matching[0];

				if (!item) {
					throw new NotFoundException(
						`This research result has no finding for "${input.field}".`,
					);
				}

				const target = targetOf(row);
				const wanted = input.decision === "accept" ? "accepted" : "dismissed";

				if (item.state === wanted) {
					return {
						resultId: row.id,
						field: item.field,
						state: wanted,
						applied: false,
						review: row.review,
						record: target,
					} satisfies ResearchDecision;
				}

				if (item.state !== "suggested") {
					throw new ConflictException(
						"That suggestion has already been settled.",
					);
				}

				const applied =
					input.decision === "accept"
						? await this.apply(tx, target, item)
						: false;

				const items = findings.items.map((candidate) =>
					candidate === item ? { ...candidate, state: wanted } : candidate,
				);
				const open = items.some((candidate) => candidate.state === "suggested");
				const review = open
					? row.review
					: items.some((candidate) => candidate.state === "accepted")
						? ResearchReview.ACCEPTED
						: ResearchReview.DISMISSED;

				await tx.researchResult.update({
					where: { id: row.id },
					data: {
						findings: researchFindings.parse({ ...findings, items }),
						review,
						reviewedById: open ? undefined : userId,
						reviewedAt: open ? undefined : new Date(),
					},
				});

				return {
					resultId: row.id,
					field: item.field,
					state: wanted,
					applied,
					review,
					record: target,
				} satisfies ResearchDecision;
			},
			{
				timeout: RESEARCH.review.transactionTimeoutMs,
				maxWait: RESEARCH.review.transactionWaitMs,
			},
		);

		this.logger.log({
			message: "Research finding decided",
			resultId: decision.resultId,
			field: decision.field,
			state: decision.state,
			applied: decision.applied,
			userId,
		});

		return decision;
	}

	private async apply(
		tx: Prisma.TransactionClient,
		target: RecordRef | null,
		item: ResearchFinding,
	): Promise<boolean> {
		if (!target) {
			throw new BadRequestException(
				"This research result is not attached to a company or contact.",
			);
		}

		const value = item.value?.trim();

		if (!value) {
			throw new BadRequestException(
				`The suggestion for ${item.label} has no value to add.`,
			);
		}

		if (target.kind === "company") {
			const column = companyAcceptColumn(item.field);
			if (!column) throw this.notAcceptable(item);

			const record = await tx.company.findUnique({
				where: { id: target.id },
				select: COMPANY_ACCEPT_SELECT,
			});
			if (!record) {
				throw new NotFoundException(`No company with id ${target.id}.`);
			}

			if (sameValue(record[column], value)) return false;
			if (!sameValue(record[column], item.current)) throw this.changed(item);

			const written = await tx.company.updateMany({
				where: { id: target.id, [column]: record[column] },
				data: { [column]: value },
			});
			if (written.count !== 1) throw this.changed(item);
			return true;
		}

		const column = contactAcceptColumn(item.field);
		if (!column) throw this.notAcceptable(item);

		const record = await tx.contact.findUnique({
			where: { id: target.id },
			select: CONTACT_ACCEPT_SELECT,
		});
		if (!record) {
			throw new NotFoundException(`No contact with id ${target.id}.`);
		}

		if (sameValue(record[column], value)) return false;
		if (!sameValue(record[column], item.current)) throw this.changed(item);

		const written = await tx.contact.updateMany({
			where: { id: target.id, [column]: record[column] },
			data: { [column]: value },
		});
		if (written.count !== 1) throw this.changed(item);
		return true;
	}

	private notAcceptable(item: ResearchFinding): BadRequestException {
		return new BadRequestException(
			`${item.label} cannot be added to the record from research. Edit the record to change it.`,
		);
	}

	private changed(item: ResearchFinding): ConflictException {
		return new ConflictException(
			`${item.label} changed on the record after this suggestion was made. Refresh and review it again.`,
		);
	}

	private readFindings(
		resultId: string,
		value: Prisma.JsonValue,
	): ResearchFindings {
		if (value === null) return EMPTY_FINDINGS;

		const parsed = researchFindings.safeParse(value);

		if (!parsed.success) {
			this.logger.error({
				message: "Research findings are unreadable",
				resultId,
				issues: parsed.error.issues.length,
			});
			throw new InternalServerErrorException(
				"This research result is stored in a form the CRM cannot read.",
			);
		}

		return parsed.data;
	}

	private async requireRecord(
		input: ResearchForRecordInput,
	): Promise<RecordRef> {
		if (input.companyId) {
			const company = await this.db.company.findUnique({
				where: { id: input.companyId },
				select: { id: true },
			});
			if (!company) {
				throw new NotFoundException(`No company with id ${input.companyId}.`);
			}
			return { kind: "company", id: company.id };
		}

		if (input.contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: input.contactId },
				select: { id: true },
			});
			if (!contact) {
				throw new NotFoundException(`No contact with id ${input.contactId}.`);
			}
			return { kind: "contact", id: contact.id };
		}

		throw new BadRequestException("Choose exactly one company or contact.");
	}

	private present(row: StoredResult): ResearchResultRow {
		const findings =
			row.findings === null
				? { success: true as const, data: EMPTY_FINDINGS }
				: researchFindings.safeParse(row.findings);
		const sources = researchSources.safeParse(row.sources);
		const match =
			row.match === null
				? { success: true as const, data: null }
				: researchMatch.safeParse(row.match);
		const readable = findings.success && sources.success && match.success;

		if (!readable) {
			this.logger.warn({
				message: "Research result is unreadable",
				resultId: row.id,
				findings: findings.success,
				sources: sources.success,
				match: match.success,
			});
		}

		const kind = targetOf(row)?.kind ?? null;
		const refusal = researchRefusal(row.status, row.error);

		return {
			id: row.id,
			task: row.task,
			status: row.status,
			inProgress: row.status === ResearchStatus.RESERVED,
			partial: row.partial,
			cacheHit: row.cacheHit,
			creditsUsed: row.creditsUsed,
			confidence: row.confidence,
			review: row.review,
			refusal,
			error: researchErrorCopy(row.status, refusal, readable),
			readable,
			summary: readable && findings.success ? findings.data.summary : null,
			findings:
				readable && findings.success
					? findings.data.items.map((item) => ({
							...item,
							canAccept:
								item.state === "suggested" &&
								Boolean(item.value?.trim()) &&
								canAcceptField(kind, item.field),
						}))
					: [],
			sources: readable && sources.success ? sources.data : [],
			match: readable && match.success ? match.data : null,
			retrievedAt: row.retrievedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
		};
	}
}
