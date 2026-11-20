const SECOND_MS = 1_000;

export const ONBOARDING = {
	transaction: { maxWait: 15 * SECOND_MS, timeout: 60 * SECOND_MS },
	brand: {
		path: "/internal/crm/brand-preview",
		maxLookups: 5,
		cooldownMs: 5 * SECOND_MS,
		timeoutMs: 12 * SECOND_MS,
	},
	scope: "onboarding",
} as const;
