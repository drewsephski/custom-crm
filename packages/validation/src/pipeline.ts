import { z } from "zod";
import { parse } from "./index";

export const STAGE_OUTCOMES = ["OPEN", "WON", "LOST"] as const;

export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

export const stageOutcome = z.enum(STAGE_OUTCOMES);

export const dealStage = z.object({
	id: z.string(),
	key: z.string(),
	label: z.string(),
	outcome: stageOutcome,
	position: z.number(),
	probability: z.number().nullable(),
});

export type DealStage = z.infer<typeof dealStage>;

export const pipelineStage = dealStage.extend({
	isDefault: z.boolean(),
	inWinRate: z.boolean(),
});

export type PipelineStage = z.infer<typeof pipelineStage>;

export const stageSnapshot = z.object({
	id: z.string(),
	key: z.string(),
	label: z.string(),
	outcome: stageOutcome,
});

export type StageSnapshot = z.infer<typeof stageSnapshot>;

export const STAGE_CHANGE_REASONS = ["reconfigured"] as const;

export const stageChangeMeta = z.object({
	from: stageSnapshot.nullable(),
	to: stageSnapshot,
	reason: z.enum(STAGE_CHANGE_REASONS).optional(),
});

export type StageChangeMeta = z.infer<typeof stageChangeMeta>;

export function parseStageChangeMeta(value: unknown): StageChangeMeta {
	return parse(stageChangeMeta, value, "stage change");
}

export function readStageChangeMeta(value: unknown): StageChangeMeta | null {
	const parsed = stageChangeMeta.safeParse(value);
	return parsed.success ? parsed.data : null;
}
