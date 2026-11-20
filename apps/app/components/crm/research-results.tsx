"use client";
import { Button } from "@crm/ui/components/button";
import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

export function ResearchResults({
	record,
	refreshMs,
}: {
	record: { companyId?: string; contactId?: string };
	refreshMs: number;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const { slug } = useParams<{ slug: string }>();
	const [connected, setConnected] = useState(false);
	const results = useQuery({
		...trpc.research.forRecord.queryOptions(record),
		refetchInterval: connected ? false : refreshMs,
	});
	useMountEffect(() => {
		const params = new URLSearchParams({ workspace: slug });
		if (record.companyId) params.set("companyId", record.companyId);
		if (record.contactId) params.set("contactId", record.contactId);
		const stream = new EventSource(`/api/research/events?${params}`);
		stream.onopen = () => setConnected(true);
		stream.onerror = () => setConnected(false);
		stream.onmessage = () => void results.refetch();
		return () => stream.close();
	});
	const decision = useMutation(
		trpc.research.decideFinding.mutationOptions({
			onSuccess: async ({ record, applied }) => {
				await Promise.all([
					results.refetch(),
					record && applied ? cache[record.kind](record.id) : undefined,
				]);
			},
		}),
	);
	if (results.error)
		return <p role="alert">Research results could not load.</p>;

	return (
		<section aria-label="Research results" className="grid gap-3 p-3">
			{results.data?.rows.map((row) => (
				<article key={row.id} className="grid gap-2">
					<strong>
						{row.task} · {row.status.toLowerCase()}
					</strong>
					{row.error && <p role="status">{row.error}</p>}
					{row.match && (
						<p>
							{row.match.score === null
								? "No matching profile"
								: `Provider match score: ${row.match.score}/100`}
						</p>
					)}
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
