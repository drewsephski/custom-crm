"use client";

import { Button } from "@crm/ui/components/button";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { SettingsCard } from "@crm/ui/components/settings-card";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type InviteRole = "member" | "admin" | "owner";

const ROLE_LABELS = {
	member: "Member",
	admin: "Admin",
	owner: "Owner",
} as const satisfies Record<InviteRole, string>;

function isInviteRole(value: string): value is InviteRole {
	return value === "member" || value === "admin" || value === "owner";
}

export function InviteMembers() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const emailId = useId();
	const roleId = useId();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<InviteRole>("member");

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const canInvite = workspace.data?.canInvite ?? false;
	const viewerRole = workspace.data?.viewerRole ?? null;

	const pending = useQuery({
		...trpc.workspace.invitations.queryOptions(),
		enabled: canInvite,
	});

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.workspace.invitations.queryKey(),
		});

	const invite = useMutation(
		trpc.workspace.invite.mutationOptions({
			onSuccess: async (invitation) => {
				setEmail("");
				await refresh();
				toast.success(`Invitation sent to ${invitation.email}.`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const revoke = useMutation(
		trpc.workspace.revokeInvitation.mutationOptions({
			onSuccess: async () => {
				await refresh();
				toast.success("Invitation cancelled.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!canInvite) return null;

	const roles: InviteRole[] =
		viewerRole === "owner" ? ["member", "admin", "owner"] : ["member", "admin"];

	return (
		<SettingsCard
			title="Invite your team"
			description="An invited teammate signs in with the address you enter here, then accepts the invitation. It expires in 7 days."
			action={
				<Button
					type="submit"
					form="invite-member"
					size="sm"
					disabled={invite.isPending || email.trim() === ""}
				>
					{invite.isPending ? <Spinner data-icon="inline-start" /> : null}
					Invite
				</Button>
			}
		>
			<form
				id="invite-member"
				className="flex flex-col gap-4 sm:flex-row"
				onSubmit={(event) => {
					event.preventDefault();
					invite.mutate({ email: email.trim(), role });
				}}
			>
				<Field className="flex-1">
					<FieldLabel htmlFor={emailId}>Email</FieldLabel>
					<Input
						id={emailId}
						type="email"
						autoComplete="off"
						placeholder="teammate@agency.com"
						value={email}
						disabled={invite.isPending}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</Field>
				<Field className="sm:w-40">
					<FieldLabel htmlFor={roleId}>Role</FieldLabel>
					<Select
						value={role}
						onValueChange={(value) => {
							if (isInviteRole(value)) setRole(value);
						}}
					>
						<SelectTrigger id={roleId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{roles.map((option) => (
								<SelectItem key={option} value={option}>
									{ROLE_LABELS[option]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			</form>

			{pending.data && pending.data.length > 0 ? (
				<ul className="flex flex-col divide-y">
					{pending.data.map((invitation) => (
						<li
							key={invitation.id}
							className="flex items-center justify-between gap-3 py-3 text-sm"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{invitation.email}</p>
								<p className="text-muted-foreground">
									{ROLE_LABELS[invitation.role]} · invited by{" "}
									{invitation.invitedBy}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								disabled={revoke.isPending}
								onClick={() => revoke.mutate({ invitationId: invitation.id })}
							>
								Cancel
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</SettingsCard>
	);
}
