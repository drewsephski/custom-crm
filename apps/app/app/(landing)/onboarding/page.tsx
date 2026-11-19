import { DEFAULT_WORKSPACE_NAME } from "@crm/auth/organization";
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireSession } from "@/lib/session";
import { getServerTrpcClient } from "@/lib/trpc/server";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
	title: "Set up",
};

export const instant = false;

async function hasWorkspace(): Promise<boolean> {
	try {
		const { workspaces } = await getServerTrpcClient().workspaces.list.query();
		return workspaces.length > 0;
	} catch (error) {
		unstable_rethrow(error);
		return false;
	}
}

export default async function OnboardingPage({
	searchParams,
}: PageProps<"/onboarding">) {
	await requireSession();
	const { new: creating } = await searchParams;

	if (creating === "1" || !(await hasWorkspace())) {
		return (
			<AuthShell>
				<AuthHeading
					title="Create your agency workspace"
					description="Your workspace is private to your agency. You can invite your team once it exists."
				/>

				<CreateWorkspaceForm />
			</AuthShell>
		);
	}

	return (
		<AuthShell>
			<AuthHeading
				title="Tell us about your company"
				description="The name is what the CRM calls you; the website is how the agent learns what you sell."
			/>

			<OnboardingForm placeholder={DEFAULT_WORKSPACE_NAME} />
		</AuthShell>
	);
}
