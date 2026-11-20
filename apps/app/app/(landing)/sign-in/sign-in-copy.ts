import { AUTH_ERROR } from "@crm/auth/auth-config";
import { PRODUCT } from "@crm/validation/product";
import { GET_STARTED_PATH, SIGN_IN_PATH } from "@/lib/auth-redirect";

export type AuthIntent = "sign-in" | "get-started";

export const AUTH_INTENT = {
	"sign-in": {
		title: "Welcome back",
		description: "Sign in to open your workspace.",
		emailAction: "Continue with email",
		other: {
			prompt: "New here?",
			label: "Get started",
			path: GET_STARTED_PATH,
		},
	},
	"get-started": {
		title: `Get started with ${PRODUCT.name}`,
		description: "Create your account in one step. You need no password.",
		emailAction: "Continue with email",
		other: {
			prompt: "Already have an account?",
			label: "Sign in",
			path: SIGN_IN_PATH,
		},
	},
} as const satisfies Record<
	AuthIntent,
	{
		title: string;
		description: string;
		emailAction: string;
		other: { prompt: string; label: string; path: string };
	}
>;

const LINK_FAILURE = new Map<string, string>(
	Object.entries({
		[AUTH_ERROR.invalidToken]:
			"This sign-in link is expired or already used. Enter your email to get a new link.",
		[AUTH_ERROR.signInNotAllowed]:
			"This CRM is private. That address is not on the allow-list.",
	}),
);

const GENERIC_FAILURE = "Sign-in did not complete. Try again.";

export function signInFailureMessage(code: string | undefined): string | null {
	if (!code) return null;

	return LINK_FAILURE.get(code) ?? GENERIC_FAILURE;
}

const TOO_MANY_REQUESTS = 429;

export function sendFailureMessage(status: number | undefined): string {
	return status === TOO_MANY_REQUESTS
		? "Too many sign-in emails. Wait one minute, then try again."
		: "The sign-in email is not sent. Try again in a minute.";
}
