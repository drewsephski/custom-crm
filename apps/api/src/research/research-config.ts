const SECOND_MS = 1_000;

export const RESEARCH = {
	page: {
		size: 20,
	},
	review: {
		transactionTimeoutMs: 15 * SECOND_MS,
		transactionWaitMs: 5 * SECOND_MS,
	},
} as const;
