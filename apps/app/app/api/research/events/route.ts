import { setTimeout as delay } from "node:timers/promises";
import { researchForRecordInput } from "@crm/validation/research-result";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import { RESEARCH_STREAM } from "@/lib/research-stream-config";
import { getServerTrpcClient } from "@/lib/trpc/server";

const workspaceSlug = z.string().regex(/^[a-z0-9-]{1,64}$/);
const errorStatus = z.object({
	httpStatus: z.number().int().min(400).max(599),
});
const encoder = new TextEncoder();

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const workspace = workspaceSlug.safeParse(params.get("workspace"));
	const record = researchForRecordInput.safeParse(Object.fromEntries(params));
	if (!workspace.success || !record.success)
		return new Response(null, { status: 400 });
	const cookie = request.headers.get("cookie");
	if (!cookie) return new Response(null, { status: 401 });
	const abort = new AbortController();
	const signal = AbortSignal.any([request.signal, abort.signal]);
	const client = getServerTrpcClient({ cookie, workspace: workspace.data });
	const revision = () =>
		client.research.revision.query(record.data, { signal });
	let previous: string;
	try {
		previous = await revision();
	} catch (error) {
		const status = errorStatus.safeParse(
			error instanceof TRPCClientError ? error.data : null,
		);
		return new Response(null, {
			status: status.success ? status.data.httpStatus : 503,
		});
	}
	const until = Date.now() + RESEARCH_STREAM.durationMs;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode("data: changed\n\n"));
		},
		async pull(controller) {
			try {
				await delay(RESEARCH_STREAM.intervalMs, undefined, { signal });
				if (Date.now() >= until) {
					controller.close();
					return;
				}
				const next = await revision();
				controller.enqueue(
					encoder.encode(
						next === previous ? ": heartbeat\n\n" : "data: changed\n\n",
					),
				);
				previous = next;
			} catch {
				if (!abort.signal.aborted) controller.close();
			}
		},
		cancel() {
			abort.abort();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "private, no-store, no-transform",
			"x-accel-buffering": "no",
		},
	});
}
