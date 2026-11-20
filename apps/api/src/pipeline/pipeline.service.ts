import { ActivityType, type Db, type Prisma, StageOutcome } from "@crm/db";
import {
	type ActivePipeline,
	ensureActivePipeline,
	type PipelineStageRow,
	readActivePipeline,
	stageSnapshot,
} from "@crm/db/pipeline";
import { parseSavedViewFilters } from "@crm/validation/saved-view";
import type { WorkspaceConfig } from "@crm/validation/workspace-config";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { appendStageDeals, lockBoardStages } from "../deals/board-position";
import type { PipelineApplyResult, PipelinePlan } from "./pipeline.contracts";

type ConfigStage = WorkspaceConfig["pipeline"][number];

const CONFIG_OUTCOME = {
	open: StageOutcome.OPEN,
	won: StageOutcome.WON,
	lost: StageOutcome.LOST,
} as const satisfies Record<ConfigStage["outcome"], StageOutcome>;

const OUTCOME_WORD = {
	OPEN: "open",
	WON: "won",
	LOST: "lost",
} as const satisfies Record<StageOutcome, string>;

type Target = {
	key: string;
	label: string;
	outcome: StageOutcome;
	probability: number;
	position: number;
	isDefault: boolean;
};

function targetsOf(stages: ConfigStage[]): Target[] {
	const defaultKey = stages.find((stage) => stage.outcome === "open")?.key;
	return stages.map((stage, position) => ({
		key: stage.key,
		label: stage.label,
		outcome: CONFIG_OUTCOME[stage.outcome],
		probability: stage.probability,
		position,
		isDefault: stage.key === defaultKey,
	}));
}

function differs(existing: PipelineStageRow, target: Target): boolean {
	return (
		existing.outcome !== target.outcome ||
		existing.probability !== target.probability ||
		existing.position !== target.position ||
		existing.isDefault !== target.isDefault
	);
}

@Injectable()
export class PipelineService {
	private readonly logger = new Logger(PipelineService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async active(): Promise<ActivePipeline> {
		const existing = await readActivePipeline(this.db);
		if (existing) return existing;
		return this.db.$transaction((tx) => ensureActivePipeline(tx));
	}

	async plan(
		tx: Prisma.TransactionClient,
		stages: ConfigStage[],
	): Promise<PipelinePlan> {
		const pipeline = await ensureActivePipeline(tx);
		const counts = await this.dealCounts(tx, pipeline);
		const targets = targetsOf(stages);
		const byKey = new Map(pipeline.stages.map((stage) => [stage.key, stage]));
		const targetKeys = new Set(targets.map((target) => target.key));
		const blocked: string[] = [];

		const planned = targets.map((target) => {
			const existing = byKey.get(target.key);
			const dealCount = existing ? (counts.get(existing.id) ?? 0) : 0;

			if (existing && existing.outcome !== target.outcome && dealCount > 0) {
				blocked.push(
					`"${existing.label}" holds ${dealCount} deal${dealCount === 1 ? "" : "s"} and is ${OUTCOME_WORD[existing.outcome]}. It cannot become ${OUTCOME_WORD[target.outcome]}. Add a new stage and map the deals to it.`,
				);
			}

			const change = !existing
				? ("create" as const)
				: existing.label !== target.label
					? ("rename" as const)
					: differs(existing, target)
						? ("update" as const)
						: ("keep" as const);

			return {
				key: target.key,
				label: target.label,
				outcome: target.outcome,
				probability: target.probability,
				isDefault: target.isDefault,
				change,
				previousLabel:
					existing && existing.label !== target.label ? existing.label : null,
				dealCount,
			};
		});

		const removed = pipeline.stages
			.filter((stage) => !targetKeys.has(stage.key))
			.map((stage) => ({
				stageId: stage.id,
				key: stage.key,
				label: stage.label,
				outcome: stage.outcome,
				dealCount: counts.get(stage.id) ?? 0,
				targets: targets
					.filter((target) => target.outcome === stage.outcome)
					.map((target) => ({ key: target.key, label: target.label })),
			}));

		return {
			inSync:
				removed.length === 0 &&
				planned.every((stage) => stage.change === "keep"),
			stages: planned,
			removed,
			blocked,
		};
	}

	async apply(
		tx: Prisma.TransactionClient,
		stages: ConfigStage[],
		mapping: Record<string, string>,
		actingUserId: string,
	): Promise<PipelineApplyResult> {
		const pipeline = await ensureActivePipeline(tx);
		const plan = await this.plan(tx, stages);

		if (plan.blocked.length > 0) {
			throw new BadRequestException(plan.blocked.join(" "));
		}

		const targets = targetsOf(stages);
		const targetByKey = new Map(targets.map((target) => [target.key, target]));
		const moves = plan.removed
			.filter((stage) => stage.dealCount > 0)
			.map((stage) => {
				const targetKey = mapping[stage.stageId];
				const target = targetKey ? targetByKey.get(targetKey) : undefined;
				if (!target) {
					throw new BadRequestException(
						`"${stage.label}" holds ${stage.dealCount} deal${stage.dealCount === 1 ? "" : "s"}. Choose the stage they move to.`,
					);
				}
				if (target.outcome !== stage.outcome) {
					throw new BadRequestException(
						`Deals in "${stage.label}" are ${OUTCOME_WORD[stage.outcome]}. They can move only to another ${OUTCOME_WORD[stage.outcome]} stage.`,
					);
				}
				return { from: stage, targetKey: target.key };
			});

		const result = {
			stagesCreated: 0,
			stagesUpdated: 0,
			stagesRemoved: 0,
			dealsMoved: 0,
		};

		if (plan.inSync) {
			return { ...result, stageIds: stageIdsOf(pipeline.stages) };
		}

		const existingByKey = new Map(
			pipeline.stages.map((stage) => [stage.key, stage]),
		);

		await lockBoardStages(
			tx,
			moves.flatMap((move) => {
				const target = existingByKey.get(move.targetKey);
				return target ? [move.from.stageId, target.id] : [move.from.stageId];
			}),
		);

		await tx.pipelineStage.updateMany({
			where: { pipelineId: pipeline.id, isDefault: true },
			data: { isDefault: false },
		});

		const stageIds = new Map<string, string>();
		for (const target of targets) {
			const existing = existingByKey.get(target.key);
			const data = {
				label: target.label,
				outcome: target.outcome,
				probability: target.probability,
				position: target.position,
				isDefault: target.isDefault,
			};

			if (!existing) {
				const created = await tx.pipelineStage.create({
					data: { ...data, pipelineId: pipeline.id, key: target.key },
					select: { id: true },
				});
				stageIds.set(target.key, created.id);
				result.stagesCreated += 1;
				continue;
			}

			stageIds.set(target.key, existing.id);
			await tx.pipelineStage.update({
				where: { id: existing.id },
				data,
				select: { id: true },
			});
			if (existing.label !== target.label || differs(existing, target)) {
				result.stagesUpdated += 1;
			}
		}

		const replaced = new Map<string, string | null>();
		const now = new Date();

		for (const move of moves) {
			const target = targetByKey.get(move.targetKey);
			const targetId = stageIds.get(move.targetKey);
			if (!target || !targetId) {
				throw new Error(`Stage ${move.targetKey} was not written.`);
			}

			const deals = await tx.deal.findMany({
				where: { stageId: move.from.stageId },
				select: { id: true, companyId: true },
			});
			await appendStageDeals(tx, move.from.stageId, targetId, now);
			await tx.activity.createMany({
				data: deals.map((deal) => ({
					type: ActivityType.STAGE_CHANGE,
					subject: "Stage changed",
					body: "The pipeline was reconfigured.",
					occurredAt: now,
					companyId: deal.companyId,
					dealId: deal.id,
					createdById: actingUserId,
					meta: {
						from: stageSnapshot({
							id: move.from.stageId,
							key: move.from.key,
							label: move.from.label,
							outcome: move.from.outcome,
						}),
						to: stageSnapshot({
							id: targetId,
							key: target.key,
							label: target.label,
							outcome: target.outcome,
						}),
						reason: "reconfigured",
					},
				})),
			});
			replaced.set(move.from.stageId, targetId);
			result.dealsMoved += deals.length;
		}

		for (const stage of plan.removed) {
			if (!replaced.has(stage.stageId)) replaced.set(stage.stageId, null);
		}

		if (plan.removed.length > 0) {
			await tx.pipelineStage.deleteMany({
				where: { id: { in: plan.removed.map((stage) => stage.stageId) } },
			});
			result.stagesRemoved = plan.removed.length;
			await this.repointSavedViews(tx, replaced);
		}

		this.logger.log({
			message: "Pipeline reconfigured",
			pipelineId: pipeline.id,
			...result,
		});

		return { ...result, stageIds };
	}

	private async dealCounts(
		tx: Prisma.TransactionClient,
		pipeline: ActivePipeline,
	): Promise<Map<string, number>> {
		const groups = await tx.deal.groupBy({
			by: ["stageId"],
			where: { stageId: { in: pipeline.stages.map((stage) => stage.id) } },
			_count: { _all: true },
		});
		return new Map(groups.map((group) => [group.stageId, group._count._all]));
	}

	private async repointSavedViews(
		tx: Prisma.TransactionClient,
		replaced: Map<string, string | null>,
	): Promise<void> {
		const views = await tx.savedView.findMany({
			where: { entity: "DEAL" },
			select: { id: true, filters: true },
		});

		for (const view of views) {
			const filters = parseSavedViewFilters(view.filters);
			const stage = filters.filters.stage;
			if (!stage?.some((id) => replaced.has(id))) continue;

			const next = [
				...new Set(
					stage.flatMap((id) => {
						if (!replaced.has(id)) return [id];
						const target = replaced.get(id);
						return target ? [target] : [];
					}),
				),
			];

			await tx.savedView.update({
				where: { id: view.id },
				data: {
					filters: {
						...filters,
						filters: { ...filters.filters, stage: next },
					},
				},
				select: { id: true },
			});
		}
	}
}

function stageIdsOf(stages: PipelineStageRow[]): Map<string, string> {
	return new Map(stages.map((stage) => [stage.key, stage.id]));
}
