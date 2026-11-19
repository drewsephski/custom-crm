import {
	PageShell,
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
import { WorkspaceSetup } from "./workspace-setup";

export const metadata: Metadata = {
	title: "Workspace setup",
};

export default function WorkspaceSetupPage() {
	return (
		<PageShell width="narrow" className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Set up your CRM</PageShellTitle>
					<PageShellDescription>
						Describe how your agency works. You get a proposed pipeline, fields
						and views to review before anything changes.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading shape="settings" />}>
					<Setup />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Setup() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.workspaceConfig.state.queryOptions()),
		queryClient.prefetchQuery(trpc.workspace.get.queryOptions()),
	]);

	return (
		<HydrateClient>
			<WorkspaceSetup />
		</HydrateClient>
	);
}
