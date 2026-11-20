const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

export const LIVE = {
	stream: {
		heartbeatMs: 20 * SECOND_MS,
		lifetimeMs: 2 * MINUTE_MS,
		clientRetryMs: 2 * SECOND_MS,
		maxPerUser: 6,
	},
	listener: {
		applicationName: "crm-live",
		connectTimeoutMs: 10 * SECOND_MS,
		idleDisconnectMs: 30 * SECOND_MS,
		backoff: {
			baseMs: SECOND_MS,
			factor: 2,
			maxMs: 30 * SECOND_MS,
		},
	},
} as const;

export type LiveListenerTiming = {
	connectTimeoutMs: number;
	idleDisconnectMs: number;
	backoff: { baseMs: number; factor: number; maxMs: number };
};

export function backoffDelayMs(
	failures: number,
	backoff: LiveListenerTiming["backoff"],
): number {
	const exponent = Math.max(0, failures - 1);
	return Math.min(backoff.maxMs, backoff.baseMs * backoff.factor ** exponent);
}
