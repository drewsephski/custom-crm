import type { Prisma } from "./generated/prisma/client";
import { StageOutcome } from "./generated/prisma/enums";
import { lockIdempotencyKey } from "./idempotency";
import {
	DEFAULT_PIPELINE_NAME,
	DEFAULT_PIPELINE_STAGES,
} from "./pipeline-defaults";
import { requireOrganizationId } from "./tenancy";

export { DEFAULT_PIPELINE_NAME, DEFAULT_PIPELINE_STAGES };

export const STAGE_SELECT = {
	id: true,
	key: true,
	label: true,
	outcome: true,
	position: true,
	probability: true,
} as const satisfies Prisma.PipelineStageSelect;

export type DealStageRow = Prisma.PipelineStageGetPayload<{
	select: typeof STAGE_SELECT;
}>;

export const PIPELINE_STAGE_SELECT = {
	...STAGE_SELECT,
	isDefault: true,
	inWinRate: true,
} as const satisfies Prisma.PipelineStageSelect;

export type PipelineStageRow = Prisma.PipelineStageGetPayload<{
	select: typeof PIPELINE_STAGE_SELECT;
}>;

export type ActivePipeline = {
	id: string;
	name: string;
	stages: PipelineStageRow[];
};

export const OPEN_DEALS = {
	stage: { outcome: StageOutcome.OPEN },
} as const satisfies Prisma.DealWhereInput;

export const CLOSED_DEALS = {
	stage: { outcome: { not: StageOutcome.OPEN } },
} as const satisfies Prisma.DealWhereInput;

export function isClosedOutcome(outcome: StageOutcome): boolean {
	return outcome !== StageOutcome.OPEN;
}

export function isLostOutcome(outcome: StageOutcome): boolean {
	return outcome === StageOutcome.LOST;
}

export type StageSnapshot = {
	id: string;
	key: string;
	label: string;
	outcome: StageOutcome;
};

export function stageSnapshot(stage: StageSnapshot): StageSnapshot {
	return {
		id: stage.id,
		key: stage.key,
		label: stage.label,
		outcome: stage.outcome,
	};
}

type PipelineReader = Pick<Prisma.TransactionClient, "pipeline">;

export async function readActivePipeline(
	client: PipelineReader,
): Promise<ActivePipeline | null> {
	return client.pipeline.findFirst({
		where: { organizationId: requireOrganizationId(), isActive: true },
		select: {
			id: true,
			name: true,
			stages: {
				select: PIPELINE_STAGE_SELECT,
				orderBy: [{ position: "asc" }, { createdAt: "asc" }],
			},
		},
	});
}

export async function ensureActivePipeline(
	tx: Prisma.TransactionClient,
): Promise<ActivePipeline> {
	const existing = await readActivePipeline(tx);
	if (existing) return existing;

	await lockIdempotencyKey(tx, "pipeline");

	const raced = await readActivePipeline(tx);
	if (raced) return raced;

	const defaultKey = DEFAULT_PIPELINE_STAGES[0].key;
	await tx.pipeline.create({
		data: {
			name: DEFAULT_PIPELINE_NAME,
			isActive: true,
			stages: {
				create: DEFAULT_PIPELINE_STAGES.map((stage, position) => ({
					key: stage.key,
					label: stage.label,
					outcome: stage.outcome,
					probability: stage.probability,
					position,
					isDefault: stage.key === defaultKey,
				})),
			},
		},
		select: { id: true },
	});

	const created = await readActivePipeline(tx);
	if (!created) {
		throw new Error("The default pipeline was created and cannot be read.");
	}
	return created;
}

export function defaultStageOf(pipeline: ActivePipeline): PipelineStageRow {
	const stage =
		pipeline.stages.find((candidate) => candidate.isDefault) ??
		pipeline.stages.find(
			(candidate) => candidate.outcome === StageOutcome.OPEN,
		);
	if (!stage) {
		throw new Error(`Pipeline ${pipeline.id} has no open stage.`);
	}
	return stage;
}
