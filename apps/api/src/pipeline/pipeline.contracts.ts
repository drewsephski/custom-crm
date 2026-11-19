import { pipelineStage, stageOutcome } from "@crm/validation/pipeline";
import { z } from "zod";

export const pipelineOutput = z.object({
	id: z.string(),
	name: z.string(),
	stages: z.array(pipelineStage),
});

export type PipelineView = z.infer<typeof pipelineOutput>;

export const PLAN_CHANGES = ["create", "rename", "update", "keep"] as const;

const plannedStage = z.object({
	key: z.string(),
	label: z.string(),
	outcome: stageOutcome,
	probability: z.number().nullable(),
	isDefault: z.boolean(),
	change: z.enum(PLAN_CHANGES),
	previousLabel: z.string().nullable(),
	dealCount: z.number(),
});

const removedStage = z.object({
	stageId: z.string(),
	key: z.string(),
	label: z.string(),
	outcome: stageOutcome,
	dealCount: z.number(),
	targets: z.array(z.object({ key: z.string(), label: z.string() })),
});

export const pipelinePlanOutput = z.object({
	inSync: z.boolean(),
	stages: z.array(plannedStage),
	removed: z.array(removedStage),
	blocked: z.array(z.string()),
});

export type PipelinePlan = z.infer<typeof pipelinePlanOutput>;

export type PipelineApplyResult = {
	stagesCreated: number;
	stagesUpdated: number;
	stagesRemoved: number;
	dealsMoved: number;
	stageIds: Map<string, string>;
};
