"use client";

import { MAGIC_LINK } from "@crm/auth/auth-config";
import { authClient } from "@crm/auth/client";
import { AuthButton } from "@crm/ui/components/auth-button";
import { AuthField, AuthFieldLabel } from "@crm/ui/components/auth-field";
import { AuthInput } from "@crm/ui/components/auth-input";
import { LogoSpinner } from "@crm/ui/components/logo-spinner";
import { useId, useState } from "react";
import { SIGN_IN_PATH, withNext } from "@/lib/auth-redirect";
import { useSeconds } from "@/lib/use-seconds";
import { sendFailureMessage } from "./sign-in-copy";

const SECOND_MS = 1_000;

type Sent = { email: string; resendAt: number };

export function EmailSignIn({
	next,
	submitLabel,
	localEmail,
}: {
	next: string;
	submitLabel: string;
	localEmail: boolean;
}) {
	const emailId = useId();
	const messageId = useId();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState<Sent | null>(null);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const now = useSeconds();

	async function send(address: string) {
		setPending(true);
		setFailure(null);

		const origin = window.location.origin;
		const destination = `${origin}${next}`;

		try {
			const { error } = await authClient.signIn.magicLink({
				email: address,
				callbackURL: destination,
				newUserCallbackURL: destination,
				errorCallbackURL: `${origin}${withNext(SIGN_IN_PATH, next)}`,
			});

			if (error) {
				setFailure(sendFailureMessage(error.status));
				return;
			}

			setSent({
				email: address,
				resendAt: Date.now() + MAGIC_LINK.resendCooldownSeconds * SECOND_MS,
			});
		} catch {
			setFailure(sendFailureMessage(undefined));
		} finally {
			setPending(false);
		}
	}

	if (sent) {
		const wait = Math.max(0, Math.ceil((sent.resendAt - now) / SECOND_MS));

		return (
			<div className="flex flex-col gap-4" aria-live="polite">
				<div className="flex flex-col gap-1">
					<p className="text-sm/5 font-medium">
						{localEmail ? "Development sign-in link" : "Check your email"}
					</p>
					<p className="text-sm/5 text-muted-foreground text-pretty">
						{localEmail
							? "The API console contains the development link for"
							: "We sent a sign-in link to"}{" "}
						<span className="font-medium text-foreground break-all">
							{sent.email}
						</span>
						. The link works one time and expires in{" "}
						{MAGIC_LINK.expiresInMinutes} minutes.
					</p>
				</div>

				{failure ? (
					<p role="alert" className="text-xs/5 text-destructive">
						{failure}
					</p>
				) : null}

				<AuthButton
					type="button"
					variant="outline"
					disabled={pending || wait > 0}
					onClick={() => send(sent.email)}
				>
					{pending ? <LogoSpinner data-icon="inline-start" /> : null}
					{wait > 0 ? `Resend in ${wait} s` : "Resend the link"}
				</AuthButton>
				<AuthButton
					type="button"
					variant="ghost"
					disabled={pending}
					onClick={() => {
						setSent(null);
						setFailure(null);
					}}
				>
					Use a different email
				</AuthButton>
			</div>
		);
	}

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				const address = email.trim().toLowerCase();
				if (address) send(address);
			}}
		>
			<AuthField data-invalid={failure ? true : undefined}>
				<AuthFieldLabel htmlFor={emailId}>Email</AuthFieldLabel>
				<AuthInput
					id={emailId}
					name="email"
					type="email"
					inputMode="email"
					autoComplete="email"
					autoCapitalize="none"
					spellCheck={false}
					placeholder="you@company.com"
					required
					value={email}
					disabled={pending}
					aria-invalid={failure ? true : undefined}
					aria-describedby={failure ? messageId : undefined}
					onChange={(event) => setEmail(event.target.value)}
				/>
				{failure ? (
					<p id={messageId} role="alert" className="text-xs/5 text-destructive">
						{failure}
					</p>
				) : null}
			</AuthField>
			<AuthButton type="submit" disabled={pending}>
				{pending ? <LogoSpinner data-icon="inline-start" /> : null}
				{submitLabel}
			</AuthButton>
		</form>
	);
}
