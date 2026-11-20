"use client";
import { Button } from "@crm/ui/components/button";
import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import {
	createRealtimeClient,
	type SealedLiveQuery,
} from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

export function ResearchResults({
	record,
	refreshMs,
}: {
	record: { companyId?: string; contactId?: string };
	refreshMs: number;
}) {
	const trpc = useTRPC();
	const live = useQuery(trpc.workspace.researchLive.queryOptions(record));
	const results = useQuery({
		...trpc.research.forRecord.queryOptions(record),
		refetchInterval: refreshMs,
	});
	const decision = useMutation(
		trpc.research.decideFinding.mutationOptions({
			onSuccess: () => results.refetch(),
		}),
	);
	if (results.error)
		return <p role="alert">Research results could not load.</p>;

	return (
		<section aria-label="Research results" className="grid gap-3 p-3">
			{live.data && (
				<LiveResearch
					key={live.data.url}
					live={live.data}
					refresh={async () => {
						const next = await live.refetch();
						if (!next.data) throw new Error("Live updates unavailable");
						return next.data.sealedQuery;
					}}
					update={() => void results.refetch()}
				/>
			)}
			{results.data?.rows.map((row) => (
				<article key={row.id} className="grid gap-2">
					<strong>
						{row.task} · {row.status.toLowerCase()}
					</strong>
					{row.error && <p role="status">{row.error}</p>}
					{row.summary && <p>{row.summary}</p>}
					{row.findings.map((f) => (
						<div key={f.field}>
							{f.label} · {f.value} · {f.state}
							{f.state === "suggested" &&
								(["accept", "dismiss"] as const).map((action) => (
									<Button
										key={action}
										variant="ghost"
										disabled={
											decision.isPending ||
											(action === "accept" && !f.canAccept)
										}
										onClick={() =>
											decision.mutate({
												resultId: row.id,
												field: f.field,
												decision: action,
											})
										}
									>
										{action}
									</Button>
								))}
						</div>
					))}
					{row.sources.map((s) => (
						<a key={s.url} href={s.url} target="_blank" rel="noreferrer">
							{s.title ?? s.url}
						</a>
					))}
				</article>
			))}
			{decision.error && <p role="alert">{decision.error.message}</p>}
		</section>
	);
}

type Signal = { id: string; state: string };
type SubscriptionProps = {
	refresh: () => Promise<SealedLiveQuery<Signal>>;
	update: () => void;
};
function LiveResearch({
	live,
	refresh,
	update,
}: SubscriptionProps & {
	live: NonNullable<RouterOutputs["workspace"]["researchLive"]>;
}) {
	const [client] = useState(() => createRealtimeClient({ url: live.url }));
	return (
		<RealtimeProvider client={client}>
			<Subscribe query={live.sealedQuery} refresh={refresh} update={update} />
		</RealtimeProvider>
	);
}
function Subscribe({
	query,
	refresh,
	update,
}: SubscriptionProps & { query: SealedLiveQuery<Signal> }) {
	const { utils } = useLiveQuery(query, { refreshQuery: refresh });
	useMountEffect(() => utils.onUpdate(update));
	return null;
}
