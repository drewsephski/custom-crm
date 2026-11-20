import { WORKSPACE_ROLES } from "@crm/auth/organization";
import {
	businessTypeKey,
	goalKey,
	ONBOARDING_LIMITS,
	onboardingDetails,
	onboardingPipeline,
	onboardingStep,
	presetKey,
} from "@crm/validation/onboarding";
import { BRAND_PREVIEW_STATUSES } from "@crm/validation/onboarding-brand";
import { z } from "zod";

const L = ONBOARDING_LIMITS;

export const stateInput = z.object({
	another: z.boolean().default(false),
});

export const saveBusinessTypeInput = z.object({
	businessType: businessTypeKey,
	advance: z.boolean().default(false),
});

export const saveGoalsInput = z.object({
	goals: z.array(goalKey).max(goalKey.options.length),
	advance: z.boolean().default(false),
});

export const saveBusinessInput = z.object({
	businessName: z.string().trim().max(L.name),
	website: z.string().trim().max(L.website),
	description: z.string().trim().max(L.description),
	industry: z.string().trim().max(L.label),
	location: z.string().trim().max(L.label),
	useLogo: z.boolean().default(false),
	advance: z.boolean().default(false),
});

export const saveCustomizeInput = z.object({
	presetKey,
	pipeline: onboardingPipeline,
	advance: z.boolean().default(false),
});

export const goToInput = z.object({ step: onboardingStep });

export const lookupBrandInput = z.object({
	website: z.string().trim().min(1).max(L.website),
});

export type SaveBusinessTypeInput = z.infer<typeof saveBusinessTypeInput>;
export type SaveGoalsInput = z.infer<typeof saveGoalsInput>;
export type SaveBusinessInput = z.infer<typeof saveBusinessInput>;
export type SaveCustomizeInput = z.infer<typeof saveCustomizeInput>;

export const BRAND_STATUSES = ["idle", ...BRAND_PREVIEW_STATUSES] as const;

export const brandOutput = z.object({
	status: z.enum(BRAND_STATUSES),
	domain: z.string().nullable(),
	suggestion: z
		.object({
			name: z.string().nullable(),
			description: z.string().nullable(),
			industry: z.string().nullable(),
			location: z.string().nullable(),
			logoUrl: z.string().nullable(),
		})
		.nullable(),
});

export type BrandView = z.infer<typeof brandOutput>;

const presetOutput = z.object({
	key: presetKey,
	label: z.string(),
	description: z.string(),
	recommended: z.boolean(),
	stages: onboardingPipeline,
});

export const progressOutput = z.object({
	step: onboardingStep,
	reachable: z.array(onboardingStep),
	adopting: z.boolean(),
	answers: z.object({
		businessType: businessTypeKey.nullable(),
		goals: z.array(goalKey),
		businessName: z.string(),
		website: z.string(),
		details: onboardingDetails,
	}),
	brand: brandOutput,
	presets: z.array(presetOutput),
	customize: z.object({
		presetKey: presetKey.nullable(),
		pipeline: onboardingPipeline.nullable(),
	}),
});

export type OnboardingProgressView = z.infer<typeof progressOutput>;

export const stateOutput = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("wizard"),
		progress: progressOutput,
		brandLookup: z.boolean(),
		invitations: z.array(
			z.object({
				id: z.string(),
				workspaceName: z.string(),
				role: z.enum(WORKSPACE_ROLES),
			}),
		),
	}),
	z.object({ kind: z.literal("done"), slug: z.string() }),
]);

export type OnboardingState = z.infer<typeof stateOutput>;

export const finishOutput = z.object({
	slug: z.string(),
	pipelineApplied: z.boolean(),
});

export type FinishResult = z.infer<typeof finishOutput>;

export const gettingStartedOutput = z.object({
	show: z.boolean(),
	fresh: z.boolean(),
	goals: z.array(goalKey),
	canConfigure: z.boolean(),
});

export type GettingStartedView = z.infer<typeof gettingStartedOutput>;
