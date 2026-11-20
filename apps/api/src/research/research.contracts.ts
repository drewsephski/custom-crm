import { ResearchReview, ResearchStatus } from "@crm/db";
import {
	RESEARCH_FINDING_STATES,
	type researchForRecordInput,
} from "@crm/validation/research-result";
import { z } from "zod";
import { RESEARCH_REFUSALS } from "./research-copy";

export type ResearchForRecordInput = z.infer<typeof researchForRecordInput>;

export const researchDecideFindingInput = z.object({
	resultId: z.string().min(1),
	field: z.string().trim().min(1),
	decision: z.enum(["accept", "dismiss"]),
});

export type ResearchDecideFindingInput = z.infer<
	typeof researchDecideFindingInput
>;

const researchStatus = z.enum(
	Object.values(ResearchStatus) as [ResearchStatus, ...ResearchStatus[]],
);

const researchReview = z.enum(
	Object.values(ResearchReview) as [ResearchReview, ...ResearchReview[]],
);

const researchSourceOutput = z.object({
	url: z.string(),
	title: z.string().nullable(),
});

const researchFindingOutput = z.object({
	field: z.string(),
	label: z.string(),
	value: z.string().nullable(),
	state: z.enum(RESEARCH_FINDING_STATES),
	current: z.string().nullable(),
	sourceUrl: z.string().nullable(),
	canAccept: z.boolean(),
});

const researchMatchOutput = z.object({
	score: z.number().nullable(),
	matchedOn: z.array(z.string()),
	candidates: z.number(),
});

const researchResultOutput = z.object({
	id: z.string(),
	task: z.string(),
	status: researchStatus,
	inProgress: z.boolean(),
	partial: z.boolean(),
	cacheHit: z.boolean(),
	creditsUsed: z.number(),
	confidence: z.number().nullable(),
	review: researchReview,
	refusal: z.enum(RESEARCH_REFUSALS).nullable(),
	error: z.string().nullable(),
	readable: z.boolean(),
	summary: z.string().nullable(),
	findings: z.array(researchFindingOutput),
	sources: z.array(researchSourceOutput),
	match: researchMatchOutput.nullable(),
	retrievedAt: z.string().nullable(),
	createdAt: z.string(),
});

export type ResearchResultRow = z.infer<typeof researchResultOutput>;

export const researchForRecordOutput = z.object({
	rows: z.array(researchResultOutput),
	total: z.number(),
});

export type ResearchForRecord = z.infer<typeof researchForRecordOutput>;

export const researchUsageOutput = z.object({
	period: z.string(),
	limit: z.number(),
	used: z.number(),
	reserved: z.number(),
	remaining: z.number(),
	exhausted: z.boolean(),
	warn: z.boolean(),
	resetsAt: z.string(),
	requests: z.number(),
	cacheHits: z.number(),
	cacheHitRate: z.number().nullable(),
	succeeded: z.number(),
	successRate: z.number().nullable(),
	failed: z.number(),
	refused: z.number(),
});

export type ResearchUsage = z.infer<typeof researchUsageOutput>;

export const researchDecideFindingOutput = z.object({
	resultId: z.string(),
	field: z.string(),
	state: z.enum(["accepted", "dismissed"]),
	applied: z.boolean(),
	review: researchReview,
	record: z
		.object({ kind: z.enum(["company", "contact"]), id: z.string() })
		.nullable(),
});

export type ResearchDecision = z.infer<typeof researchDecideFindingOutput>;
