const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_TTL_DAYS = 7;

export const WORKSPACE = {
	invitation: {
		ttlDays: INVITATION_TTL_DAYS,
		ttlMs: INVITATION_TTL_DAYS * DAY_MS,
		acceptPath: "/sign-in?next=%2Finvitations",
	},
	slug: { maxAttempts: 20, suffixLength: 4 },
} as const;
