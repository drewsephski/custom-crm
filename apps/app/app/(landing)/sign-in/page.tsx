import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { AUTH_INTENT } from "./sign-in-copy";
import { SignInMethods } from "./sign-in-methods";

export const metadata: Metadata = {
	title: "Sign in",
};

const COPY = AUTH_INTENT["sign-in"];

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
	return (
		<AuthShell>
			<Suspense
				fallback={
					<AuthHeading title={COPY.title} description={COPY.description} />
				}
			>
				<SignInMethods intent="sign-in" searchParams={searchParams} />
			</Suspense>
		</AuthShell>
	);
}
