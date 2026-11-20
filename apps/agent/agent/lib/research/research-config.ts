import { RESEARCH_BUDGET } from "@crm/db/research-budget";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const RESEARCH_OPERATIONS = [
	"brand.retrieve",
	"people.enrich",
	"people.search",
	"web.search",
	"web.extract",
	"web.answers",
] as const;

export type ResearchOperation = (typeof RESEARCH_OPERATIONS)[number];

export type OperationSettings = {
	estimateCredits: number;
	ttlMs: number;
	emptyTtlMs: number;
	shared: boolean;
	timeoutMs: number;
};

export type WindowLimit = { limit: number; windowMs: number };

export type ResearchSettings = {
	cache: { maxEntries: number };
	provider: string;
	operations: Record<ResearchOperation, OperationSettings>;
	answers: { fastCredits: number; ultraCredits: number };
	peopleSearch: { fastCredits: number; ultraCredits: number };
	search: {
		resultsPerCredit: number;
		creditsPerMarkdownResult: number;
		minResults: number;
		maxResults: number;
	};
	extract: { maxPages: number };
	rate: { workspace: WindowLimit; user: WindowLimit };
	concurrency: {
		perWorkspace: number;
		global: number;
		maxQueue: number;
		maxWaitMs: number;
	};
	retry: {
		maxAttempts: number;
		baseDelayMs: number;
		maxDelayMs: number;
		maxRetryAfterMs: number;
		jitter: number;
	};
	dedup: { pollMs: number; maxWaitMs: number };
	reservation: { ttlMs: number; reconcileEveryMs: number };
	collapse: { refusalMs: number; cacheHitMs: number };
	preview: {
		maxAttempts: number;
		user: WindowLimit;
		maxTrackedUsers: number;
	};
};

export const RESEARCH = {
	cache: { maxEntries: 256 },
	provider: "context.dev",

	operations: {
		"brand.retrieve": {
			estimateCredits: 10,
			ttlMs: 30 * DAY_MS,
			emptyTtlMs: DAY_MS,
			shared: true,
			timeoutMs: 60 * SECOND_MS,
		},
		"people.enrich": {
			estimateCredits: 20,
			ttlMs: 30 * DAY_MS,
			emptyTtlMs: 7 * DAY_MS,
			shared: false,
			timeoutMs: 60 * SECOND_MS,
		},
		"people.search": {
			estimateCredits: 10,
			ttlMs: 7 * DAY_MS,
			emptyTtlMs: DAY_MS,
			shared: false,
			timeoutMs: 60 * SECOND_MS,
		},
		"web.search": {
			estimateCredits: 1,
			ttlMs: DAY_MS,
			emptyTtlMs: HOUR_MS,
			shared: false,
			timeoutMs: 60 * SECOND_MS,
		},
		"web.extract": {
			estimateCredits: 10,
			ttlMs: 7 * DAY_MS,
			emptyTtlMs: DAY_MS,
			shared: false,
			timeoutMs: 120 * SECOND_MS,
		},
		"web.answers": {
			estimateCredits: 10,
			ttlMs: 7 * DAY_MS,
			emptyTtlMs: DAY_MS,
			shared: false,
			timeoutMs: 60 * SECOND_MS,
		},
	},

	answers: { fastCredits: 10, ultraCredits: 100 },

	peopleSearch: { fastCredits: 10, ultraCredits: 50 },

	search: {
		resultsPerCredit: 10,
		creditsPerMarkdownResult: 1,
		minResults: 10,
		maxResults: 20,
	},

	extract: { maxPages: 8 },

	rate: {
		workspace: { limit: 30, windowMs: MINUTE_MS },
		user: { limit: 12, windowMs: MINUTE_MS },
	},

	concurrency: {
		perWorkspace: 4,
		global: 8,
		maxQueue: 64,
		maxWaitMs: 30 * SECOND_MS,
	},

	retry: {
		maxAttempts: 3,
		baseDelayMs: SECOND_MS,
		maxDelayMs: 15 * SECOND_MS,
		maxRetryAfterMs: 30 * SECOND_MS,
		jitter: 0.5,
	},

	dedup: { pollMs: SECOND_MS / 2, maxWaitMs: 20 * SECOND_MS },

	reservation: {
		ttlMs: RESEARCH_BUDGET.reservationTtlMs,
		reconcileEveryMs: MINUTE_MS,
	},

	collapse: { refusalMs: 15 * MINUTE_MS, cacheHitMs: MINUTE_MS },

	preview: {
		maxAttempts: 1,
		user: { limit: 5, windowMs: MINUTE_MS },
		maxTrackedUsers: 5_000,
	},
} as const satisfies ResearchSettings;
