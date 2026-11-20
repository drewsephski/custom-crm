import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { AUTH_INTENT } from "../sign-in/sign-in-copy";
import { SignInMethods } from "../sign-in/sign-in-methods";

export const metadata: Metadata = {
	title: "Get started",
};

const COPY = AUTH_INTENT["get-started"];

export default function GetStartedPage({
	searchParams,
}: PageProps<"/get-started">) {
	return (
		<AuthShell>
			<Suspense
				fallback={
					<AuthHeading title={COPY.title} description={COPY.description} />
				}
			>
				<SignInMethods intent="get-started" searchParams={searchParams} />
			</Suspense>
		</AuthShell>
	);
}
