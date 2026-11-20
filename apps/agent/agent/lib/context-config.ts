const SECOND_MS = 1_000;

export const CONTEXT = {
	timeoutMs: 60 * SECOND_MS,
	verifyTimeoutMs: 15 * SECOND_MS,

	people: {
		matchFloor: 70,
		enrichCost: 2,
	},

	search: {
		results: 5,
		deepResults: 10,
		excerptChars: 2_000,
	},

	linkedinFind: {
		searchResults: 10,
		maxProfiles: 3,
	},

	avatarHosts: ["brand.dev", "licdn.com"],
} as const;
