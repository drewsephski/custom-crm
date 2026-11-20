import {
	ActivityType,
	type Db,
	type Prisma,
	Prisma as PrismaNamespace,
} from "@crm/db";
import { normalizeCurrency } from "@crm/db/currency";
import type { FieldDefinitionWithOptions } from "@crm/db/fields";
import {
	CLOSED_DEALS,
	type DealStageRow,
	defaultStageOf,
	ensureActivePipeline,
	isClosedOutcome,
	isLostOutcome,
	OPEN_DEALS,
	STAGE_SELECT,
	stageSnapshot,
} from "@crm/db/pipeline";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import {
	AgentTriggerService,
	type CrmEventInput,
} from "../agent/agent-trigger.service";
import { ARCHIVE } from "../archive/archive-config";
import {
	ActivityStampService,
	type StampTargets,
} from "../crm/activity-stamp.service";
import { type BulkResult, requireOwner, runBulk } from "../crm/bulk";
import {
	blankToNull,
	decimalFromCents,
	fromCents,
	toCents,
} from "../crm/values";
import { ConversionService } from "../currency/conversion.service";
import { InjectDatabase } from "../database/database.constants";
import { FieldsService } from "../fields/fields.service";
import { PipelineService } from "../pipeline/pipeline.service";
import {
	archivedFilter,
	countsByKey,
	FACET_UNASSIGNED,
	type ListResult,
	type OrderByColumns,
	ownerFilter,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import { lockBoardStages } from "./board-position";
import { BOARD } from "./deals.config";
import type {
	BoardPlacement,
	ClosingWindow,
	DealAttachContactInput,
	DealBoardInput,
	DealBulkOwnerInput,
	DealBulkStageInput,
	DealContactRoleInput,
	DealCreateInput,
	DealDetachContactInput,
	DealListInput,
	DealUpdateInput,
	SetStageInput,
} from "./deals.contracts";
import { CLOSING_WINDOWS } from "./deals.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const COMPANY_SELECT = {
	id: true,
	name: true,
	domain: true,
	iconUrl: true,
	iconDarkUrl: true,
	iconTone: true,
	logoUrl: true,
} as const;

const CONTACT_SELECT = {
	id: true,
	firstName: true,
	lastName: true,
	email: true,
	title: true,
	imageUrl: true,
} as const;

const BOARD_ORDER = [
	{ boardPosition: "asc" },
	{ createdAt: "desc" },
	{ id: "asc" },
] as const satisfies Prisma.DealOrderByWithRelationInput[];

const LOST_REASON_REQUIRED =
	"Say why it was lost. A lost deal with no reason teaches nobody anything.";

const MOVED_MEANWHILE =
	"Somebody else moved this deal at the same moment. Try again.";

type BoardDeal = { id: string; stageId: string; companyId: string };

const SORTABLE: OrderByColumns<Prisma.DealOrderByWithRelationInput[]> = {
	name: (dir) => [{ name: dir }],
	company: (dir) => [{ company: { name: dir } }, { name: "asc" }],
	stage: (dir) => [{ stage: { position: dir } }, { expectedCloseDate: "asc" }],
	amount: (dir) => [{ baseAmount: { sort: dir, nulls: "last" } }],
	expectedCloseDate: (dir) => [{ expectedCloseDate: dir }],
	createdAt: (dir) => [{ createdAt: dir }],
	owner: (dir) => [{ owner: { name: dir } }, { name: "asc" }],
	lastActivity: (dir) => [{ lastActivityAt: { sort: dir, nulls: "last" } }],
	archivedAt: (dir) => [{ archivedAt: { sort: dir, nulls: "last" } }],
};

@Injectable()
export class DealsService {
	private readonly logger = new Logger(DealsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
		private readonly stamp: ActivityStampService,
		private readonly conversion: ConversionService,
		private readonly fields: FieldsService,
		private readonly pipeline: PipelineService,
	) {}

	async list(input: DealListInput) {
		const filterableFields = await this.fields.filterableFieldsFor("DEAL");
		const where = this.buildWhere(input, filterableFields);
		const { skip, take } = paginate(input);

		const openWhere: Prisma.DealWhereInput = { AND: [where, OPEN_DEALS] };
		const base = await this.conversion.reportingCurrency();

		const [rows, total, facetCounts, openValue, unconverted] =
			await Promise.all([
				this.db.deal.findMany({
					where,
					skip,
					take,
					orderBy: resolveOrderBy(input, SORTABLE, [{ createdAt: "desc" }]),
					select: {
						id: true,
						name: true,
						stage: { select: STAGE_SELECT },
						amount: true,
						currency: true,
						baseAmount: true,
						expectedCloseDate: true,
						closedAt: true,
						company: { select: COMPANY_SELECT },
						owner: { select: OWNER_SELECT },
						lastActivityAt: true,
						createdAt: true,
						archivedAt: true,
					},
				}),
				this.db.deal.count({ where }),
				this.facetCounts(input, filterableFields),
				this.db.deal.aggregate({
					where: { AND: [openWhere, this.conversion.countedWhere(base)] },
					_sum: { baseAmount: true },
				}),
				this.conversion.unconverted(openWhere),
			]);

		const tableFields = await this.fields.tableValuesFor(
			"DEAL",
			rows.map((row) => row.id),
		);

		return {
			rows: rows.map(
				({
					amount,
					baseAmount,
					expectedCloseDate,
					closedAt,
					lastActivityAt,
					createdAt,
					archivedAt,
					...row
				}) => ({
					...row,
					amountCents: toCents(amount),
					baseAmountCents: toCents(baseAmount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
					closedAt: closedAt?.toISOString() ?? null,
					lastActivityAt: lastActivityAt?.toISOString() ?? null,
					createdAt: createdAt.toISOString(),
					archivedAt: archivedAt?.toISOString() ?? null,
					fields: tableFields.get(row.id) ?? {},
				}),
			),
			total,
			facetCounts,
			openValueCents: toCents(openValue._sum.baseAmount),
			reportingCurrency: base,
			unconverted,
		} satisfies ListResult<unknown> & {
			openValueCents: number | null;
			reportingCurrency: string;
			unconverted: { count: number; currencies: string[] };
		};
	}

	async byId(id: string) {
		const reportingCurrency = await this.conversion.reportingCurrency();
		const deal = await this.db.deal.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				description: true,
				stage: { select: STAGE_SELECT },
				stageChangedAt: true,
				amount: true,
				currency: true,
				baseAmount: true,
				baseCurrency: true,
				fxRate: true,
				fxRateAt: true,
				expectedCloseDate: true,
				closedAt: true,
				closedReason: true,
				createdAt: true,
				archivedAt: true,
				company: { select: { ...COMPANY_SELECT, industry: true } },
				owner: { select: OWNER_SELECT },
				contacts: {
					select: { role: true, contact: { select: CONTACT_SELECT } },
					orderBy: { contact: { firstName: "asc" } },
				},
			},
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${id}.`);
		}

		const {
			contacts,
			amount,
			baseAmount,
			baseCurrency,
			fxRate,
			fxRateAt,
			archivedAt,
			...rest
		} = deal;

		return {
			...rest,
			fields: await this.fields.valuesFor("DEAL", id),
			amountCents: toCents(amount),
			baseAmountCents:
				baseCurrency === reportingCurrency ? toCents(baseAmount) : null,
			reportingCurrency,
			fxRate:
				baseCurrency === reportingCurrency
					? (fxRate?.toNumber() ?? null)
					: null,
			fxRateAt:
				baseCurrency === reportingCurrency
					? (fxRateAt?.toISOString() ?? null)
					: null,
			stageChangedAt: deal.stageChangedAt.toISOString(),
			expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
			closedAt: deal.closedAt?.toISOString() ?? null,
			createdAt: deal.createdAt.toISOString(),
			archivedAt: archivedAt?.toISOString() ?? null,
			contacts: contacts.map(({ role, contact }) => ({ ...contact, role })),
		};
	}

	async board(input: DealBoardInput) {
		const pipeline = await this.pipeline.active();
		const base = await this.conversion.reportingCurrency();
		const where = this.boardWhere(input);

		const { counts, sums, columns } = await this.db.$transaction(async (tx) => {
			const counts = await tx.deal.groupBy({
				by: ["stageId"],
				where,
				_count: { _all: true },
			});
			const sums = await tx.deal.groupBy({
				by: ["stageId"],
				where: { AND: [where, this.conversion.countedWhere(base)] },
				_sum: { baseAmount: true },
			});
			const columns = [];
			for (const stage of pipeline.stages) {
				columns.push(
					await tx.deal.findMany({
						where: { AND: [where, { stageId: stage.id }] },
						orderBy: [...BOARD_ORDER],
						take: input.limit,
						select: {
							id: true,
							name: true,
							amount: true,
							currency: true,
							baseAmount: true,
							baseCurrency: true,
							expectedCloseDate: true,
							stageChangedAt: true,
							lastActivityAt: true,
							company: { select: COMPANY_SELECT },
							owner: { select: OWNER_SELECT },
						},
					}),
				);
			}
			return { counts, sums, columns };
		});

		const unconverted = await this.conversion.unconverted(where);

		return {
			columns: pipeline.stages.map((stage, index) => ({
				stage: {
					id: stage.id,
					key: stage.key,
					label: stage.label,
					outcome: stage.outcome,
					position: stage.position,
					probability: stage.probability,
				},
				count: counts.find((row) => row.stageId === stage.id)?._count._all ?? 0,
				valueCents:
					toCents(
						sums.find((row) => row.stageId === stage.id)?._sum.baseAmount ??
							null,
					) ?? 0,
				deals: (columns[index] ?? []).map(
					({
						amount,
						baseAmount,
						baseCurrency,
						expectedCloseDate,
						stageChangedAt,
						lastActivityAt,
						...deal
					}) => ({
						...deal,
						amountCents: toCents(amount),
						baseAmountCents: baseCurrency === base ? toCents(baseAmount) : null,
						expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
						stageChangedAt: stageChangedAt.toISOString(),
						lastActivityAt: lastActivityAt?.toISOString() ?? null,
					}),
				),
			})),
			reportingCurrency: base,
			unconverted,
		};
	}

	async create(input: DealCreateInput) {
		const now = new Date();
		await requireOwner(this.db, input.ownerId);

		const currency = normalizeCurrency(
			input.currency ?? (await this.conversion.reportingCurrency()),
		);
		const fx = await this.conversion.dealFields(
			decimalFromCents(input.amountCents),
			currency,
		);

		try {
			const { deal, stage } = await this.agent.withCrmEvents(
				async (tx, emit) => {
					const stage = await this.stageForCreate(tx, input.stageId);
					await lockBoardStages(tx, [stage.id]);
					const closed = isClosedOutcome(stage.outcome);
					const created = await tx.deal.create({
						data: {
							name: input.name.trim(),
							companyId: input.companyId,
							ownerId: input.ownerId,
							stageId: stage.id,
							boardPosition: await this.boardPosition(tx, stage.id, null),
							stageChangedAt: now,
							closedAt: closed ? now : null,
							amount: fromCents(input.amountCents),
							currency,
							...fx,
							expectedCloseDate: parseDate(input.expectedCloseDate),
						},
						select: { id: true, name: true, companyId: true },
					});
					await emit({
						type: "deal.created",
						record: { kind: "deal", id: created.id },
						occurredAt: now,
						data: { companyId: created.companyId, ...stageEventData(stage) },
					});
					if (closed) {
						await emit({
							type: "deal.closed",
							record: { kind: "deal", id: created.id },
							occurredAt: now,
							data: {
								companyId: created.companyId,
								...transitionEventData(null, stage),
							},
						});
					}
					return { deal: created, stage };
				},
			);

			this.logger.log({
				message: "Deal created",
				dealId: deal.id,
				stageId: stage.id,
				stage: stage.key,
			});

			void this.fields.queueBackfillForNewRecord("DEAL", deal.id);

			return deal;
		} catch (error) {
			throw this.translateRelations(error);
		}
	}

	async update(id: string, input: DealUpdateInput) {
		const data: Prisma.DealUpdateInput = {};
		await requireOwner(this.db, input.ownerId ?? null);

		if (input.name !== undefined) data.name = input.name.trim();
		if (input.description !== undefined) {
			data.description =
				input.description === null ? null : blankToNull(input.description);
		}
		if (input.companyId !== undefined) {
			data.company = { connect: { id: input.companyId } };
		}
		if (input.ownerId !== undefined) {
			data.owner = { connect: { id: input.ownerId } };
		}
		if (input.amountCents !== undefined) {
			data.amount = fromCents(input.amountCents);
		}
		if (input.currency !== undefined) {
			data.currency = normalizeCurrency(input.currency);
		}
		if (input.expectedCloseDate !== undefined) {
			data.expectedCloseDate = parseDate(input.expectedCloseDate);
		}

		if (input.amountCents !== undefined || input.currency !== undefined) {
			const current = await this.db.deal.findUnique({
				where: { id },
				select: { amount: true, currency: true },
			});

			if (!current) {
				throw new NotFoundException(`No deal with id ${id}.`);
			}

			const amount =
				input.amountCents !== undefined
					? decimalFromCents(input.amountCents)
					: current.amount;
			const currency =
				input.currency !== undefined
					? normalizeCurrency(input.currency)
					: normalizeCurrency(current.currency);

			Object.assign(data, await this.conversion.dealFields(amount, currency));
		}

		try {
			return await this.db.$transaction(async (tx) => {
				if (input.fields) {
					await this.fields.applyValues(tx, "DEAL", id, input.fields);
				}

				return tx.deal.update({
					where: { id },
					data,
					select: { id: true, name: true },
				});
			});
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async archive(id: string): Promise<{ id: string; name: string }> {
		try {
			const deal = await this.db.deal.update({
				where: { id },
				data: { archivedAt: new Date() },
				select: { name: true },
			});

			this.logger.log({ message: "Deal archived", dealId: id });

			return { id, name: deal.name };
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async restore(id: string): Promise<{ id: string; name: string }> {
		try {
			const deal = await this.db.deal.update({
				where: { id },
				data: { archivedAt: null },
				select: { name: true },
			});

			this.logger.log({ message: "Deal restored", dealId: id });

			return { id, name: deal.name };
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async purge(id: string): Promise<{ id: string; name: string }>;
	async purge(
		id: string,
		guard: { archivedBefore: Date },
	): Promise<{ id: string; name: string } | null>;
	async purge(
		id: string,
		guard?: { archivedBefore: Date },
	): Promise<{ id: string; name: string } | null> {
		let deleted: { targets: StampTargets; name: string } | null;

		try {
			deleted = await this.db.$transaction(async (tx) => {
				const [row] = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
					SELECT "archivedAt" FROM deal WHERE id = ${id} FOR UPDATE
				`;

				if (!row) {
					if (guard) return null;
					throw new NotFoundException(`No deal with id ${id}.`);
				}
				if (
					guard &&
					(!row.archivedAt || row.archivedAt > guard.archivedBefore)
				) {
					return null;
				}

				const targets = await this.stamp.targetsOf({ dealId: id }, tx);
				await tx.agentTask.deleteMany({ where: { dealId: id } });

				const deal = await tx.deal.delete({
					where: { id },
					select: { name: true },
				});

				return { targets, name: deal.name };
			});
		} catch (error) {
			throw this.translate(error, id);
		}

		if (!deleted) return null;

		await this.stamp.recomputeAfterDelete(deleted.targets, { dealId: id });

		this.logger.log({
			message: "Deal purged",
			dealId: id,
			name: deleted.name,
		});

		return { id, name: deleted.name };
	}

	async purgeExpired(before: Date): Promise<BulkResult> {
		const expired = await this.db.deal.findMany({
			where: { archivedAt: { lte: before } },
			select: { id: true },
			take: ARCHIVE.prune.maxBatch,
		});

		return runBulk(
			expired.map((row) => row.id),
			(id) => this.purge(id, { archivedBefore: before }),
		);
	}

	async setStage(input: SetStageInput, actingUserId: string) {
		const closedReason = input.closedReason?.trim();
		const move = async (
			tx: Prisma.TransactionClient,
			emit: (event: CrmEventInput) => Promise<void>,
		) => {
			const deal = await this.lockDealOnBoard(tx, input.id, input.stageId);
			if (!deal) return null;

			const stages = await tx.pipelineStage.findMany({
				where: { id: { in: [deal.stageId, input.stageId] } },
				select: { ...STAGE_SELECT, pipeline: { select: { isActive: true } } },
			});
			const from = stages.find((stage) => stage.id === deal.stageId);
			const to = stages.find((stage) => stage.id === input.stageId);

			if (!from) {
				throw new Error(`Deal ${deal.id} points at a stage that is gone.`);
			}
			if (!to || !to.pipeline.isActive) {
				throw new BadRequestException(
					"That stage is not in this workspace's pipeline.",
				);
			}

			if (from.id === to.id) {
				if (input.placement) {
					await tx.deal.update({
						where: { id: deal.id },
						data: {
							boardPosition: await this.boardPosition(
								tx,
								to.id,
								deal.id,
								input.placement,
							),
						},
						select: { id: true },
					});
				}
				return {
					changed: false as const,
					deal,
					from,
					to,
					now: null,
				};
			}
			if (isLostOutcome(to.outcome) && !closedReason) {
				throw new BadRequestException(LOST_REASON_REQUIRED);
			}

			const closed = isClosedOutcome(to.outcome);
			const wasClosed = isClosedOutcome(from.outcome);
			const now = new Date();
			await tx.deal.update({
				where: { id: input.id },
				data: {
					stageId: to.id,
					boardPosition: await this.boardPosition(
						tx,
						to.id,
						deal.id,
						input.placement,
					),
					stageChangedAt: now,
					closedAt: closed ? now : null,
					closedReason: closed ? (closedReason ?? null) : null,
				},
				select: { id: true },
			});
			await tx.activity.create({
				data: {
					type: ActivityType.STAGE_CHANGE,
					subject: "Stage changed",
					body: closedReason ?? null,
					occurredAt: now,
					companyId: deal.companyId,
					dealId: deal.id,
					createdById: actingUserId,
					meta: { from: stageSnapshot(from), to: stageSnapshot(to) },
				},
			});
			const data = {
				companyId: deal.companyId,
				...transitionEventData(from, to),
			};
			await emit({
				type: "deal.stage.changed",
				record: { kind: "deal", id: deal.id },
				occurredAt: now,
				data,
			});
			if (!wasClosed && closed) {
				await emit({
					type: "deal.closed",
					record: { kind: "deal", id: deal.id },
					occurredAt: now,
					data,
				});
			}
			if (wasClosed && !closed) {
				await emit({
					type: "deal.opened",
					record: { kind: "deal", id: deal.id },
					occurredAt: now,
					data,
				});
			}

			return { changed: true as const, deal, from, to, now };
		};

		let transition: Awaited<ReturnType<typeof move>> = null;
		for (let turn = 0; turn < BOARD.move.attempts && !transition; turn += 1) {
			transition = await this.agent.withCrmEvents(move);
		}
		if (!transition) throw new ConflictException(MOVED_MEANWHILE);

		const { deal, from, to } = transition;
		const stage = stageView(to);

		if (!transition.changed) {
			return { id: deal.id, stage, changed: false };
		}

		await this.stamp.touch(
			{ companyId: deal.companyId, dealId: deal.id },
			transition.now,
		);

		this.logger.log({
			message: "Deal stage changed",
			dealId: deal.id,
			from: from.key,
			to: to.key,
		});

		return { id: deal.id, stage, changed: true };
	}

	private async stageForCreate(
		tx: Prisma.TransactionClient,
		stageId: string | undefined,
	): Promise<DealStageRow> {
		const pipeline = await ensureActivePipeline(tx);
		if (!stageId) return defaultStageOf(pipeline);

		const stage = pipeline.stages.find((candidate) => candidate.id === stageId);
		if (!stage) {
			throw new BadRequestException(
				"That stage is not in this workspace's pipeline.",
			);
		}
		return stage;
	}

	private async lockDealOnBoard(
		tx: Prisma.TransactionClient,
		dealId: string,
		toStageId: string,
	): Promise<BoardDeal | null> {
		const seen = await tx.deal.findUnique({
			where: { id: dealId },
			select: { stageId: true },
		});
		if (!seen) {
			throw new NotFoundException(`No deal with id ${dealId}.`);
		}

		await lockBoardStages(tx, [seen.stageId, toStageId]);

		const [deal] = await tx.$queryRaw<BoardDeal[]>`
			SELECT id, "stageId", "companyId"
			FROM deal
			WHERE id = ${dealId}
			FOR UPDATE
		`;
		if (!deal) {
			throw new NotFoundException(`No deal with id ${dealId}.`);
		}

		return deal.stageId === seen.stageId ? deal : null;
	}

	private async boardPosition(
		tx: Prisma.TransactionClient,
		stageId: string,
		dealId: string | null,
		placement?: BoardPlacement,
	): Promise<number> {
		const others: Prisma.DealWhereInput = dealId
			? { stageId, id: { not: dealId } }
			: { stageId };
		const anchorId = placement?.afterId ?? placement?.beforeId ?? null;

		const top = async () => {
			const first = await tx.deal.aggregate({
				where: others,
				_min: { boardPosition: true },
			});
			return (
				(first._min.boardPosition ?? BOARD.position.step) - BOARD.position.step
			);
		};

		if (!placement || !anchorId || anchorId === dealId) return top();

		const between = async (): Promise<
			[number | null, number | null] | null
		> => {
			const anchor = await tx.deal.findFirst({
				where: { AND: [others, { id: anchorId }] },
				select: { boardPosition: true },
			});
			if (!anchor) return null;

			if (placement.afterId) {
				const next = await tx.deal.aggregate({
					where: {
						AND: [others, { boardPosition: { gt: anchor.boardPosition } }],
					},
					_min: { boardPosition: true },
				});
				return [anchor.boardPosition, next._min.boardPosition];
			}
			const previous = await tx.deal.aggregate({
				where: {
					AND: [others, { boardPosition: { lt: anchor.boardPosition } }],
				},
				_max: { boardPosition: true },
			});
			return [previous._max.boardPosition, anchor.boardPosition];
		};

		const place = (gap: [number | null, number | null]): number | null => {
			const [lower, upper] = gap;
			if (lower === null && upper === null) return 0;
			if (lower === null) return (upper ?? 0) - BOARD.position.step;
			if (upper === null) return lower + BOARD.position.step;
			const middle = (lower + upper) / 2;
			return upper - lower > BOARD.position.minGap &&
				lower < middle &&
				middle < upper
				? middle
				: null;
		};

		const gap = await between();
		if (!gap) return top();

		const placed = place(gap);
		if (placed !== null) return placed;

		await tx.$executeRaw`
			UPDATE deal
			SET "boardPosition" = ranked.position
			FROM (
				SELECT id, row_number() OVER (
					ORDER BY "boardPosition" ASC, "createdAt" DESC, id ASC
				) * ${BOARD.position.step}::double precision AS position
				FROM deal
				WHERE "stageId" = ${stageId} AND id <> ${dealId ?? ""}
			) ranked
			WHERE deal.id = ranked.id
		`;

		const respaced = await between();
		return (respaced ? place(respaced) : null) ?? (await top());
	}

	async contactOptions(dealId: string) {
		const deal = await this.db.deal.findUnique({
			where: { id: dealId },
			select: { companyId: true, contacts: { select: { contactId: true } } },
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${dealId}.`);
		}

		return this.db.contact.findMany({
			where: {
				companyId: deal.companyId,
				id: { notIn: deal.contacts.map((row) => row.contactId) },
			},
			select: CONTACT_SELECT,
			orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
			take: 100,
		});
	}

	async attachContact(input: DealAttachContactInput) {
		const company = await this.companyOf(input.dealId);
		const contact = await this.db.contact.findUnique({
			where: { id: input.contactId },
			select: { companyId: true },
		});

		if (!contact) {
			throw new NotFoundException(`No contact with id ${input.contactId}.`);
		}

		if (contact.companyId !== company.id) {
			throw new BadRequestException(
				`That contact does not work at ${company.name}.`,
			);
		}

		const role = roleOrNull(input.role ?? null);

		await this.db.dealContact.upsert({
			where: {
				dealId_contactId: {
					dealId: input.dealId,
					contactId: input.contactId,
				},
			},
			create: { dealId: input.dealId, contactId: input.contactId, role },
			update: role === null ? {} : { role },
		});

		this.logger.log({
			message: "Contact attached to deal",
			dealId: input.dealId,
			contactId: input.contactId,
		});

		return { dealId: input.dealId, contactId: input.contactId };
	}

	async detachContact(input: DealDetachContactInput) {
		const { count } = await this.db.dealContact.deleteMany({
			where: { dealId: input.dealId, contactId: input.contactId },
		});

		if (count === 0) {
			throw new NotFoundException("That contact is not on this deal.");
		}

		this.logger.log({
			message: "Contact detached from deal",
			dealId: input.dealId,
			contactId: input.contactId,
		});

		return { dealId: input.dealId, contactId: input.contactId };
	}

	async setContactRole(input: DealContactRoleInput) {
		const role = roleOrNull(input.role);

		const { count } = await this.db.dealContact.updateMany({
			where: { dealId: input.dealId, contactId: input.contactId },
			data: { role },
		});

		if (count === 0) {
			throw new NotFoundException("That contact is not on this deal.");
		}

		return { dealId: input.dealId, contactId: input.contactId, role };
	}

	async bulkAssignOwner(input: DealBulkOwnerInput): Promise<BulkResult> {
		await requireOwner(this.db, input.ownerId);

		const ids = [...new Set(input.ids)];
		const { count } = await this.db.deal.updateMany({
			where: { id: { in: ids } },
			data: { ownerId: input.ownerId },
		});

		this.logger.log({
			message: "Deals reassigned",
			count,
			ownerId: input.ownerId,
		});

		return {
			requested: ids.length,
			succeeded: count,
			skipped: 0,
			failed: ids.length - count,
			message: null,
		};
	}

	async bulkSetStage(
		input: DealBulkStageInput,
		actingUserId: string,
	): Promise<BulkResult> {
		const closedReason = input.closedReason?.trim();
		const stage = await this.db.pipelineStage.findFirst({
			where: { id: input.stageId, pipeline: { isActive: true } },
			select: { outcome: true },
		});

		if (!stage) {
			throw new BadRequestException(
				"That stage is not in this workspace's pipeline.",
			);
		}
		if (isLostOutcome(stage.outcome) && !closedReason) {
			throw new BadRequestException(LOST_REASON_REQUIRED);
		}

		return runBulk(input.ids, (id) =>
			this.setStage({ id, stageId: input.stageId, closedReason }, actingUserId),
		);
	}

	async bulkArchive(ids: string[]): Promise<BulkResult> {
		return runBulk(ids, (id) => this.archive(id));
	}

	async bulkRestore(ids: string[]): Promise<BulkResult> {
		return runBulk(ids, (id) => this.restore(id));
	}

	async bulkPurge(ids: string[]): Promise<BulkResult> {
		return runBulk(ids, (id) => this.purge(id));
	}

	private async companyOf(dealId: string) {
		const deal = await this.db.deal.findUnique({
			where: { id: dealId },
			select: { company: { select: { id: true, name: true } } },
		});

		if (!deal) {
			throw new NotFoundException(`No deal with id ${dealId}.`);
		}

		return deal.company;
	}

	private boardWhere(input: DealBoardInput): Prisma.DealWhereInput {
		const and: Prisma.DealWhereInput[] = [
			this.searchFilter(input.q),
			archivedFilter(false),
		];
		const owner = ownerFilter<Prisma.DealWhereInput>(input.owner);
		if (owner) and.push(owner);
		return { AND: and };
	}

	private searchFilter(q: string): Prisma.DealWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ name: { contains: term, mode: "insensitive" } },
				{ company: { name: { contains: term, mode: "insensitive" } } },
			],
		};
	}

	private buildWhere(
		input: DealListInput,
		filterableFields: FieldDefinitionWithOptions[],
	): Prisma.DealWhereInput {
		const and: Prisma.DealWhereInput[] = [
			this.searchFilter(input.q),
			archivedFilter(input.archived),
			...this.fields.fieldFilters(filterableFields, input.fields),
		];

		const owner = ownerFilter<Prisma.DealWhereInput>(input.owner);
		if (owner) and.push(owner);

		if (input.status === "open") {
			and.push(OPEN_DEALS);
		} else if (input.status === "closed") {
			and.push(CLOSED_DEALS);
		}

		if (input.stage.length > 0) {
			and.push({ stageId: { in: input.stage } });
		}

		if (input.closing.length > 0) {
			and.push({
				OR: input.closing.map((window) =>
					closingFilter(window as ClosingWindow),
				),
			});
		}

		return { AND: and };
	}

	private async facetCounts(
		input: DealListInput,
		filterableFields: FieldDefinitionWithOptions[],
	) {
		const where: Prisma.DealWhereInput = {
			AND: [this.searchFilter(input.q), archivedFilter(input.archived)],
		};

		const [owners, stages, openCount, fieldFacets, ...closingCounts] =
			await Promise.all([
				this.db.deal.groupBy({
					by: ["ownerId"],
					where,
					_count: { _all: true },
				}),
				this.db.deal.groupBy({
					by: ["stageId"],
					where,
					_count: { _all: true },
				}),
				this.db.deal.count({ where: { AND: [where, OPEN_DEALS] } }),
				this.fields.filterFacetCounts("DEAL", where, filterableFields),
				...CLOSING_WINDOWS.map((window) =>
					this.db.deal.count({
						where: { AND: [where, closingFilter(window)] },
					}),
				),
			]);

		const stageCounts = countsByKey(stages, "stageId");
		const total = Object.values(stageCounts).reduce(
			(sum, count) => sum + count,
			0,
		);
		const closedCount = total - openCount;

		return {
			status: { open: openCount, closed: closedCount },
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			stage: stageCounts,
			closing: Object.fromEntries(
				CLOSING_WINDOWS.map((window, index) => [
					window,
					closingCounts[index] ?? 0,
				]),
			),
			...Object.fromEntries(
				Object.entries(fieldFacets).map(([key, counts]) => [
					`field:${key}`,
					counts,
				]),
			),
		};
	}

	private translate(cause: unknown, id: string): never {
		if (
			cause instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			cause.code === "P2025"
		) {
			throw new NotFoundException(`No deal with id ${id}.`);
		}
		return this.translateRelations(cause);
	}

	private translateRelations(cause: unknown): never {
		if (
			cause instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			(cause.code === "P2003" || cause.code === "P2025")
		) {
			throw new BadRequestException(
				"That company or owner does not exist any more.",
			);
		}
		throw cause;
	}
}

function closingFilter(window: ClosingWindow): Prisma.DealWhereInput {
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	const startOfMonthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);

	switch (window) {
		case "overdue":
			return { expectedCloseDate: { lt: now }, ...OPEN_DEALS };
		case "this-month":
			return {
				expectedCloseDate: { gte: startOfMonth, lt: startOfNextMonth },
			};
		case "next-month":
			return {
				expectedCloseDate: { gte: startOfNextMonth, lt: startOfMonthAfter },
			};
		case "later":
			return { expectedCloseDate: { gte: startOfMonthAfter } };
		case "none":
			return { expectedCloseDate: null };
	}
}

function stageView(stage: DealStageRow): DealStageRow {
	return {
		id: stage.id,
		key: stage.key,
		label: stage.label,
		outcome: stage.outcome,
		position: stage.position,
		probability: stage.probability,
	};
}

function stageEventData(stage: DealStageRow) {
	return {
		stage: stage.label,
		stageKey: stage.key,
		stageId: stage.id,
		outcome: stage.outcome,
	};
}

function transitionEventData(from: DealStageRow | null, to: DealStageRow) {
	return {
		from: from?.label ?? null,
		to: to.label,
		fromKey: from?.key ?? null,
		toKey: to.key,
		fromStageId: from?.id ?? null,
		toStageId: to.id,
		outcome: to.outcome,
	};
}

function roleOrNull(value: string | null): string | null {
	return value === null ? null : blankToNull(value);
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}
