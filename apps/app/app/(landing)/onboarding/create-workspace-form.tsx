"use client";

import { AuthButton } from "@crm/ui/components/auth-button";
import {
	AuthField,
	AuthFieldDescription,
	AuthFieldGroup,
	AuthFieldLabel,
} from "@crm/ui/components/auth-field";
import { AuthInput } from "@crm/ui/components/auth-input";
import {
	AuthInputGroup,
	AuthInputGroupAddon,
	AuthInputGroupInput,
	AuthInputGroupText,
} from "@crm/ui/components/auth-input-group";
import { LogoSpinner } from "@crm/ui/components/logo-spinner";
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

export function CreateWorkspaceForm() {
	const trpc = useTRPC();
	const nameId = useId();
	const websiteId = useId();

	const create = useMutation(
		trpc.workspaces.create.mutationOptions({
			onSuccess: (workspace) => {
				window.location.assign(`/${workspace.slug}/settings/setup`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const form = new FormData(event.currentTarget);
				const website = String(form.get("website") ?? "").trim();

				create.mutate({
					name: String(form.get("name") ?? "").trim(),
					...(website && { website }),
				});
			}}
			className="flex flex-col gap-6"
		>
			<AuthFieldGroup>
				<AuthField>
					<AuthFieldLabel htmlFor={nameId}>Agency name</AuthFieldLabel>
					<AuthInput
						id={nameId}
						name="name"
						placeholder="Northstar Digital"
						autoComplete="organization"
						autoFocus
						required
					/>
				</AuthField>

				<AuthField>
					<AuthFieldLabel htmlFor={websiteId}>Website</AuthFieldLabel>
					<AuthInputGroup>
						<AuthInputGroupAddon>
							<AuthInputGroupText>https://</AuthInputGroupText>
						</AuthInputGroupAddon>
						<AuthInputGroupInput
							id={websiteId}
							name="website"
							placeholder="northstar.digital"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							inputMode="url"
						/>
					</AuthInputGroup>
					<AuthFieldDescription>
						Optional. When research is set up, the agent reads it to learn what
						you sell.
					</AuthFieldDescription>
				</AuthField>
			</AuthFieldGroup>

			<p className="text-muted-foreground text-sm">
				Invited by a teammate?{" "}
				<a className="underline" href="/invitations">
					See your invitations
				</a>
				.
			</p>

			<AuthButton type="submit" disabled={create.isPending}>
				{create.isPending ? <LogoSpinner data-icon="inline-start" /> : null}
				Create workspace
			</AuthButton>
		</form>
	);
}
