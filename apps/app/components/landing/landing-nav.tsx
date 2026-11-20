import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { Button } from "@crm/ui/components/button";
import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import {
	ENTRY_PATH,
	GET_STARTED_PATH,
	LANDING_PATH,
	SIGN_IN_PATH,
} from "@/lib/auth-redirect";
import { Wordmark } from "./wordmark";

export function LandingNav() {
	return (
		<header className="relative flex h-16 w-full shrink-0 items-center justify-center border-border border-b">
			<nav className="flex w-full max-w-6xl items-center justify-between gap-4 px-6">
				<Link href={LANDING_PATH} aria-label="Homepage">
					<Wordmark />
				</Link>

				<Suspense fallback={<NavActions signedIn={false} />}>
					<SessionNavActions />
				</Suspense>
			</nav>
		</header>
	);
}

async function SessionNavActions() {
	const signedIn =
		getSessionCookie(await headers(), { cookiePrefix: AUTH_COOKIE_PREFIX }) !==
		null;

	return <NavActions signedIn={signedIn} />;
}

function NavActions({ signedIn }: { signedIn: boolean }) {
	if (signedIn) {
		return (
			<Button size="sm" asChild>
				<Link href={ENTRY_PATH}>Open workspace</Link>
			</Button>
		);
	}

	return (
		<div className="flex shrink-0 items-center gap-1">
			<Button variant="ghost" size="sm" asChild>
				<Link href={SIGN_IN_PATH}>Sign in</Link>
			</Button>
			<Button size="sm" asChild>
				<Link href={GET_STARTED_PATH}>Get started</Link>
			</Button>
		</div>
	);
}
