import { canConfigureWorkspace, membershipOf } from "@crm/auth/organization";
import type { Db, Prisma } from "@crm/db";
import { isAnthropicConfigured } from "@crm/db/ai-models";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { requireOrganizationId, runAsSystem } from "@crm/db/tenancy";
import {
	type BusinessProfile,
	parseBusinessProfile,
	parseWorkspaceConfig,
	templateConfig,
	type WorkspaceConfig,
} from "@crm/validation/workspace-config";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import type {
	ApplyResult,
	ConfigVersionView,
} from "./workspace-config.contracts";

const VERSION_SELECT = {
	id: true,
	version: true,
	status: true,
	source: true,
	profile: true,
	config: true,
	error: true,
	createdAt: true,
	appliedAt: true,
} as const;

type VersionRow = Prisma.WorkspaceConfigVersionGetPayload<{
	select: typeof VERSION_SELECT;
}>;

const PROPOSAL_HISTORY = 5;

function toView(row: VersionRow): ConfigVersionView {
	return {
		id: row.id,
		version: row.version,
		status: row.status,
		source: row.source,
		profile: parseBusinessProfile(row.profile),
		config: row.config === null ? null : parseWorkspaceConfig(row.config),
		error: row.error,
		createdAt: row.createdAt.toISOString(),
		appliedAt: row.appliedAt?.toISOString() ?? null,
	};
}

@Injectable()
export class WorkspaceConfigService {
	private readonly logger = new Logger(WorkspaceConfigService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
	) {}

	async state(userId: string) {
		const [applied, proposals, canConfigure] = await Promise.all([
			this.db.workspaceConfigVersion.findFirst({
				where: { status: "APPLIED" },
				orderBy: { version: "desc" },
				select: VERSION_SELECT,
			}),
			this.db.workspaceConfigVersion.findMany({
				where: { status: { in: ["GENERATING", "PROPOSED", "FAILED"] } },
				orderBy: { version: "desc" },
				take: PROPOSAL_HISTORY,
				select: VERSION_SELECT,
			}),
			this.canConfigure(userId),
		]);

		return {
			aiAvailable: isAnthropicConfigured() && this.agent.canReachAgent(),
			canConfigure,
			applied: applied ? toView(applied) : null,
			proposals: proposals.map(toView),
		};
	}

	async propose(
		userId: string,
		profile: BusinessProfile,
	): Promise<ConfigVersionView[]> {
		await this.assertConfigurer(userId);
		const aiAvailable = isAnthropicConfigured() && this.agent.canReachAgent();

		const created = await this.db.$transaction(async (tx) => {
			await lockIdempotencyKey(tx, "workspace-config");
			const last = await tx.workspaceConfigVersion.findFirst({
				orderBy: { version: "desc" },
				select: { version: true },
			});
			const next = (last?.version ?? 0) + 1;

			const template = await tx.workspaceConfigVersion.create({
				data: {
					version: next,
					status: "PROPOSED",
					source: "TEMPLATE",
					profile,
					config: templateConfig(profile),
					createdById: userId,
				},
				select: VERSION_SELECT,
			});

			const ai = aiAvailable
				? await tx.workspaceConfigVersion.create({
						data: {
							version: next + 1,
							status: "GENERATING",
							source: "AI",
							profile,
							createdById: userId,
						},
						select: VERSION_SELECT,
					})
				: null;

			return { template, ai };
		});

		if (created.ai) {
			await this.agent.workspaceConfigRequested(created.ai.id);
		}

		this.logger.log({
			message: "Workspace configuration proposed",
			userId,
			ai: Boolean(created.ai),
		});

		return [created.template, ...(created.ai ? [created.ai] : [])].map(toView);
	}

	async edit(
		userId: string,
		versionId: string,
		config: WorkspaceConfig,
	): Promise<ConfigVersionView> {
		await this.assertConfigurer(userId);

		const { count } = await this.db.workspaceConfigVersion.updateMany({
			where: { id: versionId, status: "PROPOSED" },
			data: { config: parseWorkspaceConfig(config) },
		});

		if (count === 0) {
			throw new BadRequestException(
				"Only a proposal that has not been applied can be edited.",
			);
		}

		return toView(await this.read(versionId));
	}

	async apply(userId: string, versionId: string): Promise<ApplyResult> {
		await this.assertConfigurer(userId);

		const result = await this.db.$transaction(async (tx) => {
			const [locked] = await tx.$queryRaw<{ id: string; status: string }[]>`
				SELECT id, status::text AS status FROM "workspaceConfigVersion"
				WHERE id = ${versionId}
				FOR UPDATE
			`;

			if (!locked) throw new NotFoundException("That proposal does not exist.");

			if (locked.status === "APPLIED") {
				return {
					fieldsCreated: 0,
					fieldsKept: 0,
					viewsCreated: 0,
					viewsKept: 0,
					alreadyApplied: true,
				};
			}

			if (locked.status !== "PROPOSED") {
				throw new BadRequestException(
					"Only a finished proposal can be applied.",
				);
			}

			const row = await tx.workspaceConfigVersion.findUniqueOrThrow({
				where: { id: versionId },
				select: { config: true },
			});
			if (row.config === null) {
				throw new BadRequestException(
					"That proposal has no configuration yet.",
				);
			}
			const config = parseWorkspaceConfig(row.config);

			const fields = await this.applyFields(tx, config);
			const views = await this.applyViews(tx, config, userId);

			await tx.workspaceConfigVersion.updateMany({
				where: { status: "APPLIED" },
				data: { status: "SUPERSEDED" },
			});
			await tx.workspaceConfigVersion.update({
				where: { id: versionId },
				data: { status: "APPLIED", appliedAt: new Date(), appliedById: userId },
			});

			return {
				fieldsCreated: fields.created,
				fieldsKept: fields.kept,
				viewsCreated: views.created,
				viewsKept: views.kept,
				alreadyApplied: false,
			};
		});

		this.logger.log({
			message: "Workspace configuration applied",
			userId,
			versionId,
			...result,
		});

		return { ...result, version: toView(await this.read(versionId)) };
	}

	private async applyFields(
		tx: Prisma.TransactionClient,
		config: WorkspaceConfig,
	): Promise<{ created: number; kept: number }> {
		let created = 0;
		let kept = 0;

		for (const field of config.fields) {
			const existing = await tx.fieldDefinition.findUnique({
				where: {
					organizationId_entity_key: {
						organizationId: requireOrganizationId(),
						entity: field.entity,
						key: field.key,
					},
				},
				select: { id: true },
			});

			if (existing) {
				kept += 1;
				continue;
			}

			const last = await tx.fieldDefinition.findFirst({
				where: { entity: field.entity },
				orderBy: { position: "desc" },
				select: { position: true },
			});

			await tx.fieldDefinition.create({
				data: {
					entity: field.entity,
					key: field.key,
					label: field.label,
					type: field.type,
					agentFilled: false,
					showOnTable: true,
					showOnFilter: field.type === "SELECT",
					position: (last?.position ?? -1) + 1,
					options: {
						create: field.options.map((option, index) => ({
							label: option,
							position: index,
						})),
					},
				},
			});
			created += 1;
		}

		return { created, kept };
	}

	private async applyViews(
		tx: Prisma.TransactionClient,
		config: WorkspaceConfig,
		userId: string,
	): Promise<{ created: number; kept: number }> {
		let created = 0;
		let kept = 0;

		for (const view of config.views) {
			const existing = await tx.savedView.findFirst({
				where: { entity: view.entity, name: view.name, shared: true },
				select: { id: true },
			});

			if (existing) {
				kept += 1;
				continue;
			}

			await tx.savedView.create({
				data: {
					entity: view.entity,
					name: view.name,
					shared: true,
					filters: {},
					ownerId: userId,
				},
			});
			created += 1;
		}

		return { created, kept };
	}

	private async read(versionId: string): Promise<VersionRow> {
		const row = await this.db.workspaceConfigVersion.findUnique({
			where: { id: versionId },
			select: VERSION_SELECT,
		});
		if (!row) throw new NotFoundException("That proposal does not exist.");
		return row;
	}

	private async canConfigure(userId: string): Promise<boolean> {
		const organizationId = requireOrganizationId();
		const membership = await runAsSystem("read the caller's role", () =>
			membershipOf(userId, organizationId, this.db),
		);
		return canConfigureWorkspace(membership?.role ?? null);
	}

	private async assertConfigurer(userId: string): Promise<void> {
		if (!(await this.canConfigure(userId))) {
			throw new ForbiddenException(
				"Only an owner or an admin can change how this workspace is set up.",
			);
		}
	}
}
