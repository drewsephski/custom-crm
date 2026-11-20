import { canConfigureWorkspace, membershipOf } from "@crm/auth/organization";
import type { Db, Prisma } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { requireOrganizationId, runAsSystem } from "@crm/db/tenancy";
import {
	parseSavedViewFilters,
	type SavedViewFilters,
} from "@crm/validation/saved-view";
import {
	type BusinessProfile,
	parseBusinessProfile,
	parseWorkspaceConfig,
	templateConfig,
	type WorkspaceConfig,
	workspaceConfig,
} from "@crm/validation/workspace-config";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { AiCapabilityService } from "../agent/ai-capability.service";
import { InjectDatabase } from "../database/database.constants";
import type { PipelinePlan } from "../pipeline/pipeline.contracts";
import { PipelineService } from "../pipeline/pipeline.service";
import { FACET_UNASSIGNED } from "../trpc/list-input";
import type {
	ApplyInput,
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

const NOTHING_APPLIED = {
	fieldsCreated: 0,
	fieldsKept: 0,
	viewsCreated: 0,
	viewsUpdated: 0,
	viewsKept: 0,
	stagesCreated: 0,
	stagesUpdated: 0,
	stagesRemoved: 0,
	dealsMoved: 0,
} as const;

type ConfigView = WorkspaceConfig["views"][number];

function viewFilters(
	view: ConfigView,
	stageIds: Map<string, string>,
): SavedViewFilters {
	const filters: Record<string, string[]> = {};
	const { status, stages, unassigned } = view.filter;

	if (view.entity === "DEAL") {
		if (status) filters.status = [status];
		const ids = stages.flatMap((key) => {
			const id = stageIds.get(key);
			return id ? [id] : [];
		});
		if (ids.length > 0) filters.stage = ids;
	}
	if (unassigned && view.entity !== "DEAL") {
		filters.owner = [FACET_UNASSIGNED];
	}

	return parseSavedViewFilters(
		unassigned ? { filters, sort: "createdAt", dir: "desc" } : { filters },
	);
}

function isUnfiltered(view: SavedViewFilters): boolean {
	return (
		view.q === "" &&
		!view.archived &&
		Object.values(view.filters).every((selected) => selected.length === 0)
	);
}

function sameConfig(stored: VersionRow["config"], config: WorkspaceConfig) {
	const parsed = workspaceConfig.safeParse(stored);
	return (
		parsed.success && JSON.stringify(parsed.data) === JSON.stringify(config)
	);
}

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
		private readonly ai: AiCapabilityService,
		private readonly pipelines: PipelineService,
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

		const appliedView = applied ? toView(applied) : null;
		const pipelineInSync = appliedView?.config
			? (
					await this.db.$transaction((tx) =>
						this.pipelines.plan(tx, appliedView.config?.pipeline ?? []),
					)
				).inSync
			: true;

		return {
			aiAvailable: this.ai.canGenerate(),
			canConfigure,
			pipelineInSync,
			applied: appliedView,
			proposals: proposals.map(toView),
		};
	}

	async propose(
		userId: string,
		profile: BusinessProfile,
	): Promise<ConfigVersionView[]> {
		await this.assertConfigurer(userId);
		const aiAvailable = this.ai.canGenerate();

		const created = await this.db.$transaction(async (tx) => {
			const next = await this.lockNextVersion(tx);

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

	async createReviewed(
		userId: string,
		profile: BusinessProfile,
		config: WorkspaceConfig,
	): Promise<ConfigVersionView> {
		await this.assertConfigurer(userId);
		const reviewed = parseWorkspaceConfig(config);

		const version = await this.db.$transaction(async (tx) => {
			const next = await this.lockNextVersion(tx);

			const existing = await tx.workspaceConfigVersion.findFirst({
				where: {
					createdById: userId,
					source: "TEMPLATE",
					status: { in: ["PROPOSED", "APPLIED"] },
				},
				orderBy: { version: "desc" },
				select: VERSION_SELECT,
			});
			if (existing && sameConfig(existing.config, reviewed)) return existing;

			return tx.workspaceConfigVersion.create({
				data: {
					version: next,
					status: "PROPOSED",
					source: "TEMPLATE",
					profile,
					config: reviewed,
					createdById: userId,
				},
				select: VERSION_SELECT,
			});
		});

		this.logger.log({
			message: "Reviewed workspace configuration stored",
			userId,
			versionId: version.id,
		});

		return toView(version);
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

	async pipelinePlan(versionId: string): Promise<PipelinePlan> {
		const version = await this.read(versionId);
		if (version.config === null) {
			throw new BadRequestException("That proposal has no configuration yet.");
		}
		const config = parseWorkspaceConfig(version.config);
		return this.db.$transaction((tx) =>
			this.pipelines.plan(tx, config.pipeline),
		);
	}

	async apply(userId: string, input: ApplyInput): Promise<ApplyResult> {
		await this.assertConfigurer(userId);
		const { versionId } = input;

		const result = await this.db.$transaction(async (tx) => {
			await lockIdempotencyKey(tx, "workspace-config");

			const [locked] = await tx.$queryRaw<{ id: string; status: string }[]>`
				SELECT id, status::text AS status FROM "workspaceConfigVersion"
				WHERE id = ${versionId}
				FOR UPDATE
			`;

			if (!locked) throw new NotFoundException("That proposal does not exist.");

			if (locked.status !== "PROPOSED" && locked.status !== "APPLIED") {
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
			const reapplied = locked.status === "APPLIED";

			if (reapplied) {
				const plan = await this.pipelines.plan(tx, config.pipeline);
				if (plan.inSync) return { ...NOTHING_APPLIED, alreadyApplied: true };
			}

			const pipeline = await this.pipelines.apply(
				tx,
				config.pipeline,
				input.stageMapping,
				userId,
			);
			const fields = await this.applyFields(tx, config);
			const views = await this.applyViews(
				tx,
				config,
				userId,
				pipeline.stageIds,
			);

			if (!reapplied) {
				await tx.workspaceConfigVersion.updateMany({
					where: { status: "APPLIED" },
					data: { status: "SUPERSEDED" },
				});
				await tx.workspaceConfigVersion.update({
					where: { id: versionId },
					data: {
						status: "APPLIED",
						appliedAt: new Date(),
						appliedById: userId,
					},
				});
			}

			return {
				fieldsCreated: fields.created,
				fieldsKept: fields.kept,
				viewsCreated: views.created,
				viewsUpdated: views.updated,
				viewsKept: views.kept,
				stagesCreated: pipeline.stagesCreated,
				stagesUpdated: pipeline.stagesUpdated,
				stagesRemoved: pipeline.stagesRemoved,
				dealsMoved: pipeline.dealsMoved,
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
		stageIds: Map<string, string>,
	): Promise<{ created: number; updated: number; kept: number }> {
		let created = 0;
		let updated = 0;
		let kept = 0;

		for (const view of config.views) {
			const filters = viewFilters(view, stageIds);
			const existing = await tx.savedView.findFirst({
				where: { entity: view.entity, name: view.name, shared: true },
				select: { id: true, filters: true },
			});

			if (existing) {
				if (isUnfiltered(parseSavedViewFilters(existing.filters))) {
					if (isUnfiltered(filters)) {
						kept += 1;
						continue;
					}
					await tx.savedView.update({
						where: { id: existing.id },
						data: { filters },
						select: { id: true },
					});
					updated += 1;
					continue;
				}
				kept += 1;
				continue;
			}

			await tx.savedView.create({
				data: {
					entity: view.entity,
					name: view.name,
					shared: true,
					filters,
					ownerId: userId,
				},
			});
			created += 1;
		}

		return { created, updated, kept };
	}

	private async lockNextVersion(tx: Prisma.TransactionClient): Promise<number> {
		await lockIdempotencyKey(tx, "workspace-config");
		const last = await tx.workspaceConfigVersion.findFirst({
			orderBy: { version: "desc" },
			select: { version: true },
		});
		return (last?.version ?? 0) + 1;
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
