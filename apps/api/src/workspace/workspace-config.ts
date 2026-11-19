const DAY_MS = 24 * 60 * 60 * 1000;

export const WORKSPACE = {
	invitation: { ttlMs: 7 * DAY_MS },
	slug: { maxAttempts: 20, suffixLength: 4 },
} as const;
