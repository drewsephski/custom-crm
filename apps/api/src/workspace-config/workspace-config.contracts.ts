import {
	businessProfile,
	workspaceConfig,
} from "@crm/validation/workspace-config";
import { z } from "zod";

export const proposeInput = businessProfile;

export const editInput = z.object({
	versionId: z.string().min(1).max(64),
	config: workspaceConfig,
});

export const applyInput = z.object({
	versionId: z.string().min(1).max(64),
});

export const configVersionOutput = z.object({
	id: z.string(),
	version: z.number(),
	status: z.enum(["GENERATING", "PROPOSED", "APPLIED", "SUPERSEDED", "FAILED"]),
	source: z.enum(["TEMPLATE", "AI"]),
	profile: businessProfile,
	config: workspaceConfig.nullable(),
	error: z.string().nullable(),
	createdAt: z.string(),
	appliedAt: z.string().nullable(),
});

export type ConfigVersionView = z.infer<typeof configVersionOutput>;

export const configStateOutput = z.object({
	aiAvailable: z.boolean(),
	canConfigure: z.boolean(),
	applied: configVersionOutput.nullable(),
	proposals: z.array(configVersionOutput),
});

export const applyOutput = z.object({
	version: configVersionOutput,
	fieldsCreated: z.number(),
	fieldsKept: z.number(),
	viewsCreated: z.number(),
	viewsKept: z.number(),
	alreadyApplied: z.boolean(),
});

export type ApplyResult = z.infer<typeof applyOutput>;
