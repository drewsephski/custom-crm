import type { MailboxProviderId } from "@crm/auth/scopes";
import { Link } from "@crm/ui/components/link";
import NextLink from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { AuthHeading } from "@/components/auth-shell";
import { NEXT_PARAM, safeNextPath, withNext } from "@/lib/auth-redirect";
import { getSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { EmailSignIn } from "./email-sign-in";
import { PasswordSignIn } from "./password-sign-in";
import {
	AUTH_INTENT,
	type AuthIntent,
	signInFailureMessage,
} from "./sign-in-copy";
import { SocialSignIn } from "./social-sign-in";
import { type SsoProvider, SsoSignIn } from "./sso-sign-in";

type SignInOptions = {
	google: boolean;
	microsoft: boolean;
	emailPassword: boolean;
	magicLink: boolean;
	providers: SsoProvider[];
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const EMAIL_METHOD = "email";

async function signInOptions(): Promise<SignInOptions | null> {
	try {
		return await getServerQueryClient().fetchQuery(
			getServerTrpc().sso.signInOptions.queryOptions(),
		);
	} catch (error) {
		unstable_rethrow(error);
		console.error("Sign-in: could not read the sign-in options.", error);
		return null;
	}
}

async function currentSession() {
	try {
		return await getSession();
	} catch (error) {
		unstable_rethrow(error);
		console.error("Sign-in: could not read the session.", error);
		return null;
	}
}

function single(value: string | string[] | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export async function SignInMethods({
	intent,
	searchParams,
}: {
	intent: AuthIntent;
	searchParams: SearchParams;
}) {
	const [session, options, params] = await Promise.all([
		currentSession(),
		signInOptions(),
		searchParams,
	]);

	const next = safeNextPath(single(params[NEXT_PARAM]));

	if (session) {
		redirect(next);
	}

	const copy = AUTH_INTENT[intent];
	const method = single(params.method);
	const notice = signInFailureMessage(single(params.error));

	const configured: MailboxProviderId[] = [];
	if (options?.google ?? true) configured.push("google");
	if (options?.microsoft ?? false) configured.push("microsoft");

	const returning = intent === "sign-in";
	const providers = returning ? (options?.providers ?? []) : [];
	const emailAvailable = options?.magicLink ?? false;

	const insisted = configured.find((provider) => provider === method);
	const insistedEmail = emailAvailable && method === EMAIL_METHOD;
	const showSso =
		providers.length > 0 && insisted === undefined && !insistedEmail;
	const social =
		insisted !== undefined
			? [insisted]
			: insistedEmail || showSso
				? []
				: configured;
	const email = emailAvailable && insisted === undefined && !showSso;
	const passwords = returning && (options?.emailPassword ?? false);

	if (!showSso && social.length === 0 && !email && !passwords) {
		return (
			<>
				<AuthHeading
					title="No way in yet"
					description="This CRM has no sign-in method. Configure Google sign-in or email sign-in links."
				/>

				<p className="text-center text-muted-foreground text-sm/5">
					Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for Google sign-in. Set
					RESEND_API_KEY and EMAIL_FROM for email sign-in links. Set
					MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET for Microsoft sign-in.
					Put the variables in the root .env file, then restart. Add your own
					identity provider in Settings after the first sign-in.
				</p>
			</>
		);
	}

	return (
		<>
			<AuthHeading title={copy.title} description={copy.description} />

			{notice ? (
				<p role="alert" className="text-sm/5 text-destructive text-pretty">
					{notice}
				</p>
			) : null}

			{showSso || social.length > 0 ? (
				<div className="flex flex-col gap-3">
					{showSso ? <SsoSignIn providers={providers} next={next} /> : null}
					{social.map((provider) => (
						<SocialSignIn key={provider} provider={provider} next={next} />
					))}
				</div>
			) : null}

			{email ? (
				<EmailSignIn next={next} submitLabel={copy.emailAction} />
			) : null}
			{passwords ? <PasswordSignIn next={next} /> : null}

			<p className="text-sm/5 text-muted-foreground">
				{copy.other.prompt}{" "}
				<Link asChild>
					<NextLink href={withNext(copy.other.path, next)}>
						{copy.other.label}
					</NextLink>
				</Link>
			</p>
		</>
	);
}
