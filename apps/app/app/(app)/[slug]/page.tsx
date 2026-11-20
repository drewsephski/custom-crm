import { Button } from "@crm/ui/components/button";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
} from "@crm/ui/components/page-shell";
import Link from "next/link";
import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { DashboardSummary } from "./dashboard-summary";
import {
	OverviewGreeting,
	OverviewGreetingFallback,
} from "./overview-greeting";
import {
	OverviewScopeToggle,
	OverviewScopeToggleFallback,
} from "./overview-scope";
import { loadOverviewSearchParams } from "./overview-search-params";

export default function OverviewPage({
	params,
	searchParams,
}: PageProps<"/[slug]">) {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<Suspense fallback={<OverviewGreetingFallback />}>
						<OverviewGreeting />
					</Suspense>
				</PageShellHeading>
				<PageShellActions>
					<Suspense fallback={<OverviewScopeToggleFallback />}>
						<OverviewScopeToggle />
					</Suspense>
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<Suspense>
					<Welcome params={params} searchParams={searchParams} />
				</Suspense>
				<Suspense fallback={<PageShellLoading shape="dashboard" />}>
					<Summary searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Summary({
	searchParams,
}: Pick<PageProps<"/[slug]">, "searchParams">) {
	const [, { scope }] = await Promise.all([
		requireSession(),
		loadOverviewSearchParams(searchParams),
	]);

	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		getServerTrpc().dashboard.summary.queryOptions({ scope }),
	);

	return (
		<HydrateClient>
			<DashboardSummary />
		</HydrateClient>
	);
}

async function Welcome({ params, searchParams }: PageProps<"/[slug]">) {
	const [{ slug }, query] = await Promise.all([params, searchParams]);
	if (query.welcome !== "1") return null;
	return (
		<section className="mb-6 grid justify-items-start gap-3">
			<h2>Your workspace is ready</h2>
			<Button asChild>
				<Link href={`/${slug}/companies?new=true`}>Add your first company</Link>
			</Button>
		</section>
	);
}
