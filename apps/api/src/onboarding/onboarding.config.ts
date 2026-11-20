const SECOND_MS = 1_000;

export const ONBOARDING = {
	brand: {
		path: "/internal/crm/brand-preview",
		maxLookups: 5,
		cooldownMs: 5 * SECOND_MS,
		timeoutMs: 12 * SECOND_MS,
	},
	scope: "onboarding",
} as const;
