import { defineConfig } from "@neon/config/v1";
import { CRON_JOBS, CRON_RELAY } from "./neon/cron-config";

const cronTarget = process.env.CRON_TARGET_URL;

export default defineConfig({
	preview: {
		realtime: true,
	},
	buckets: {
		assets: { access: "public_read" },
	},
	functions: {
		[CRON_RELAY.slug]: {
			name: CRON_RELAY.label,
			source: "./neon/cron.ts",
			env: {
				CRON_TARGET_URL: { value: cronTarget, required: false },
				CRON_SECRET: {
					value: cronTarget ? process.env.CRON_SECRET : undefined,
					required: false,
				},
			},
		},
	},
	triggers: Object.fromEntries(
		CRON_JOBS.map((job) => [
			job.name,
			{
				type: "schedule" as const,
				function: CRON_RELAY.slug,
				cron: job.schedule,
				functionPath: job.path,
				enabled: Boolean(cronTarget),
			},
		]),
	),
	branch: (branch) => {
		if (branch.isDefault || branch.exists) return {};
		return { ttl: "7d" };
	},
});
