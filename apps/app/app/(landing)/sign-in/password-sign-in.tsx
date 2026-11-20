"use client";

import { authClient } from "@crm/auth/client";
import { AuthButton } from "@crm/ui/components/auth-button";
import {
	AuthField,
	AuthFieldGroup,
	AuthFieldLabel,
} from "@crm/ui/components/auth-field";
import { AuthInput } from "@crm/ui/components/auth-input";
import { LogoSpinner } from "@crm/ui/components/logo-spinner";
import { useId, useState } from "react";
import { toast } from "sonner";

export function PasswordSignIn({ next }: { next: string }) {
	const nameId = useId();
	const emailId = useId();
	const passwordId = useId();
	const [creating, setCreating] = useState(false);
	const [pending, setPending] = useState(false);

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={async (event) => {
				event.preventDefault();
				const form = new FormData(event.currentTarget);
				const email = String(form.get("email") ?? "").trim();
				const password = String(form.get("password") ?? "");
				const name = String(form.get("name") ?? "").trim() || email;

				setPending(true);
				const { error } = creating
					? await authClient.signUp.email({ email, password, name })
					: await authClient.signIn.email({ email, password });
				setPending(false);

				if (error) {
					toast.error(error.message ?? "That did not work.");
					return;
				}
				window.location.assign(next);
			}}
		>
			<AuthFieldGroup>
				{creating ? (
					<AuthField>
						<AuthFieldLabel htmlFor={nameId}>Your name</AuthFieldLabel>
						<AuthInput id={nameId} name="name" autoComplete="name" required />
					</AuthField>
				) : null}
				<AuthField>
					<AuthFieldLabel htmlFor={emailId}>Email</AuthFieldLabel>
					<AuthInput
						id={emailId}
						name="email"
						type="email"
						autoComplete="email"
						required
					/>
				</AuthField>
				<AuthField>
					<AuthFieldLabel htmlFor={passwordId}>Password</AuthFieldLabel>
					<AuthInput
						id={passwordId}
						name="password"
						type="password"
						minLength={12}
						autoComplete={creating ? "new-password" : "current-password"}
						required
					/>
				</AuthField>
			</AuthFieldGroup>
			<AuthButton type="submit" disabled={pending}>
				{pending ? <LogoSpinner data-icon="inline-start" /> : null}
				{creating ? "Create account" : "Sign in"}
			</AuthButton>
			<button
				type="button"
				className="text-muted-foreground text-sm underline"
				onClick={() => setCreating((value) => !value)}
			>
				{creating ? "I already have an account" : "Create an account"}
			</button>
		</form>
	);
}
