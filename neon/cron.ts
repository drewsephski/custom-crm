import { parseTriggerInvocation } from "@neon/functions/triggers";
import { CRON_JOBS, CRON_RELAY } from "./cron-config";

type RelayTarget = { url: string; secret: string };

function relayTarget(): RelayTarget | null {
	const url = process.env.CRON_TARGET_URL?.trim();
	const secret = process.env.CRON_SECRET?.trim();
	return url && secret ? { url, secret } : null;
}

async function relay(path: string, target: RelayTarget): Promise<Response> {
	try {
		const response = await fetch(new URL(path, target.url), {
			headers: { authorization: `Bearer ${target.secret}` },
			signal: AbortSignal.timeout(CRON_RELAY.timeoutMs),
		});
		return Response.json(
			{ path, relayed: true, status: response.status },
			{ status: response.ok ? 200 : 502 },
		);
	} catch (error) {
		return Response.json(
			{
				path,
				relayed: false,
				reason: error instanceof Error ? error.message : "request failed",
			},
			{ status: 502 },
		);
	}
}

export default {
	async fetch(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);

		if (request.method === "GET" && pathname === "/") {
			return Response.json({
				service: CRON_RELAY.slug,
				relaying: relayTarget() !== null,
				jobs: CRON_JOBS.map((job) => job.name),
			});
		}

		if (request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
		}

		const parsed = await parseTriggerInvocation(request);
		if (!parsed.ok) {
			return new Response(parsed.error, {
				status: parsed.error === "invalid_body" ? 400 : 401,
			});
		}

		const job = CRON_JOBS.find((candidate) => candidate.path === pathname);
		if (!job) return new Response("Unknown job", { status: 404 });

		const target = relayTarget();
		if (!target) {
			return Response.json({
				path: job.path,
				relayed: false,
				reason: "CRON_TARGET_URL or CRON_SECRET is not set",
			});
		}

		return relay(job.path, target);
	},
};
