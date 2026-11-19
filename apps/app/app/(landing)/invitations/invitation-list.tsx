"use client";

import { AuthButton } from "@crm/ui/components/auth-button";
import { LogoSpinner } from "@crm/ui/components/logo-spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

export function InvitationList() {
	const trpc = useTRPC();
	const invitations = useQuery(trpc.workspaces.invitations.queryOptions());

	const accept = useMutation(
		trpc.workspaces.acceptInvitation.mutationOptions({
			onSuccess: (workspace) => window.location.assign(`/${workspace.slug}`),
			onError: (error) => toast.error(error.message),
		}),
	);

	if (invitations.isPending) {
		return <LogoSpinner />;
	}

	if (!invitations.data || invitations.data.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No invitations are waiting for this address.{" "}
				<Link className="underline" href="/onboarding?new=1">
					Create your own workspace
				</Link>{" "}
				instead.
			</p>
		);
	}

	return (
		<ul className="flex flex-col gap-4">
			{invitations.data.map((invitation) => (
				<li key={invitation.id} className="flex flex-col gap-2">
					<p className="text-sm">
						<span className="font-medium">{invitation.invitedBy}</span> invited
						you to{" "}
						<span className="font-medium">{invitation.workspaceName}</span> as{" "}
						{invitation.role}.
					</p>
					<AuthButton
						type="button"
						disabled={accept.isPending}
						onClick={() => accept.mutate({ invitationId: invitation.id })}
					>
						{accept.isPending ? <LogoSpinner data-icon="inline-start" /> : null}
						Join {invitation.workspaceName}
					</AuthButton>
				</li>
			))}
		</ul>
	);
}
