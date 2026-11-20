import { APIError } from "better-auth/api";
import { AUTH_ERROR } from "./auth-config";
import { sendEmail } from "./email";
import { magicLinkEmail } from "./email-templates";

export async function deliverMagicLink({
	email,
	url,
}: {
	email: string;
	url: string;
}): Promise<void> {
	const result = await sendEmail({ to: email, ...magicLinkEmail({ url }) });
	if (result.ok) return;

	console.error("[auth] The sign-in email is not sent.", {
		reason: result.reason,
		detail: result.detail,
	});

	throw new APIError("SERVICE_UNAVAILABLE", {
		code: AUTH_ERROR.emailNotSent,
		message: "The sign-in email is not sent. Try again in a minute.",
	});
}
