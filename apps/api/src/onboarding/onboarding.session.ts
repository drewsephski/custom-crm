import type { Prisma } from "@crm/db";
import {
	type BusinessTypeKey,
	EMPTY_ONBOARDING_DETAILS,
	type GoalKey,
	knownBusinessType,
	knownGoals,
	knownPreset,
	type OnboardingDetails,
	type OnboardingStep,
	type PresetKey,
	parseOnboardingDetails,
	presetChoices,
	reachableSteps,
	resumeStep,
} from "@crm/validation/onboarding";
import {
	type OnboardingBrand,
	parseOnboardingBrand,
} from "@crm/validation/onboarding-brand";
import {
	parseWorkspaceConfig,
	type WorkspaceConfig,
} from "@crm/validation/workspace-config";
import type { BrandView, OnboardingProgressView } from "./onboarding.contracts";

export const SESSION_SELECT = {
	id: true,
	organizationId: true,
	step: true,
	businessType: true,
	goals: true,
	businessName: true,
	website: true,
	details: true,
	brand: true,
	brandStatus: true,
	brandDomain: true,
	presetKey: true,
	config: true,
	configVersionId: true,
} as const;

export type SessionRow = Prisma.OnboardingSessionGetPayload<{
	select: typeof SESSION_SELECT;
}>;

const STORED_STATUS = {
	IDLE: "idle",
	READY: "ready",
	NOT_FOUND: "not_found",
	UNAVAILABLE: "unavailable",
	FAILED: "failed",
} as const satisfies Record<SessionRow["brandStatus"], BrandView["status"]>;

export type OnboardingSession = {
	id: string;
	organizationId: string | null;
	step: OnboardingStep;
	reachable: OnboardingStep[];
	businessType: BusinessTypeKey | null;
	goals: GoalKey[];
	businessName: string;
	website: string;
	details: OnboardingDetails;
	brand: {
		status: BrandView["status"];
		domain: string | null;
		found: OnboardingBrand | null;
	};
	presetKey: PresetKey | null;
	config: WorkspaceConfig | null;
	configVersionId: string | null;
};

export function readSession(row: SessionRow): OnboardingSession {
	const businessType = knownBusinessType(row.businessType);
	const goals = knownGoals(row.goals);
	const businessName = row.businessName ?? "";
	const config = row.config === null ? null : parseWorkspaceConfig(row.config);
	const progress = {
		businessType,
		goals,
		businessName,
		hasConfig: config !== null,
	};

	return {
		id: row.id,
		organizationId: row.organizationId,
		step: resumeStep(row.step, progress),
		reachable: reachableSteps(progress),
		businessType,
		goals,
		businessName,
		website: row.website ?? "",
		details:
			row.details === null
				? EMPTY_ONBOARDING_DETAILS
				: parseOnboardingDetails(row.details),
		brand: {
			status: STORED_STATUS[row.brandStatus],
			domain: row.brandDomain,
			found: row.brand === null ? null : parseOnboardingBrand(row.brand),
		},
		presetKey: knownPreset(row.presetKey),
		config,
		configVersionId: row.configVersionId,
	};
}

export function brandView(
	status: BrandView["status"],
	domain: string | null,
	found: OnboardingBrand | null,
): BrandView {
	return {
		status,
		domain,
		suggestion:
			status === "ready" && found
				? {
						name: found.name,
						description: found.description,
						industry: found.industry,
						location: found.location,
						logoUrl: found.logoUrl,
					}
				: null,
	};
}

export function progressOf(session: OnboardingSession): OnboardingProgressView {
	return {
		step: session.step,
		reachable: session.reachable,
		adopting: session.organizationId !== null,
		answers: {
			businessType: session.businessType,
			goals: session.goals,
			businessName: session.businessName,
			website: session.website,
			details: session.details,
		},
		brand: brandView(
			session.brand.status,
			session.brand.domain,
			session.brand.found,
		),
		presets: session.businessType
			? presetChoices(
					{ businessType: session.businessType, goals: session.goals },
					session.presetKey,
				)
			: [],
		customize: {
			presetKey: session.presetKey,
			pipeline: session.config?.pipeline ?? null,
		},
	};
}
