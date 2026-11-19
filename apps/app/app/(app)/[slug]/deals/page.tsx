import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@crm/ui/components/page-shell";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { CreateDealSheet } from "./create-deal-sheet";
import { DealsBoard } from "./deals-board";
import { dealsSearchParams } from "./deals-search-params";
import { DealsTable } from "./deals-table";
import { loadDealView } from "./deals-view";

export const metadata: Metadata = {
	title: "Deals",
};

export default function DealsPage({
	searchParams,
}: PageProps<"/[slug]/deals">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Deals</PageShellTitle>
					<PageShellDescription>
						Your pipeline, stage by stage, and everything that has already
						closed.
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<CreateDealSheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading shape="table" />}>
					<Deals searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Deals({
	searchParams,
}: Pick<PageProps<"/[slug]/deals">, "searchParams">) {
	const [, values, { view }] = await Promise.all([
		requireSession(),
		dealsSearchParams.load(searchParams),
		loadDealView(searchParams),
	]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const input = dealsSearchParams.toInput(values);
	await Promise.all([
		view === "board"
			? queryClient.prefetchQuery(
					trpc.deals.board.queryOptions({ q: input.q, owner: input.owner }),
				)
			: queryClient.prefetchQuery(trpc.deals.list.queryOptions(input)),
		queryClient.prefetchQuery(trpc.pipeline.active.queryOptions()),
		queryClient.prefetchQuery(trpc.users.list.queryOptions()),
		queryClient.prefetchQuery(trpc.companies.options.queryOptions({ q: "" })),
	]);

	return (
		<HydrateClient>
			{view === "board" ? <DealsBoard /> : <DealsTable />}
		</HydrateClient>
	);
}
