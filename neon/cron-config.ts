import vercel from "../apps/api/vercel.json";

const MINUTE_MS = 60_000;

export const CRON_RELAY = {
	slug: "cron",
	label: "Cron relay",
	timeoutMs: 10 * MINUTE_MS,
	internalPrefix: "/internal/",
} as const;

export type CronJob = { name: string; path: string; schedule: string };

export const CRON_JOBS: CronJob[] = vercel.crons.map(({ path, schedule }) => ({
	name: path.slice(CRON_RELAY.internalPrefix.length).replaceAll("/", "-"),
	path,
	schedule,
}));
