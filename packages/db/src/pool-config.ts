const SECOND_MS = 1_000;

export const DB_POOL = {
	max: 10,
	idleTimeoutMs: 30 * SECOND_MS,
	connectionTimeoutMs: 10 * SECOND_MS,
	env: {
		max: "DATABASE_POOL_MAX",
		idleTimeoutMs: "DATABASE_POOL_IDLE_TIMEOUT_MS",
		connectionTimeoutMs: "DATABASE_POOL_CONNECT_TIMEOUT_MS",
	},
} as const;
