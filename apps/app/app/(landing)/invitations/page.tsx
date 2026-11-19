import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireSession } from "@/lib/session";
import { InvitationList } from "./invitation-list";

export const metadata: Metadata = {
	title: "Invitations",
};

export const instant = false;

export default async function InvitationsPage() {
	await requireSession();

	return (
		<AuthShell>
			<AuthHeading
				title="Your invitations"
				description="Accept one to join that agency's workspace."
			/>

			<InvitationList />
		</AuthShell>
	);
}
