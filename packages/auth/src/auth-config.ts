const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const MAGIC_LINK_LIFETIME_MINUTES = 15;

export const EMAIL = {
	resend: {
		endpoint: "https://api.resend.com/emails",
		timeoutMs: 10 * SECOND_MS,
	},
} as const;

export const MAGIC_LINK = {
	expiresInMinutes: MAGIC_LINK_LIFETIME_MINUTES,
	expiresInSeconds: MAGIC_LINK_LIFETIME_MINUTES * MINUTE_SECONDS,
	paths: {
		send: "/sign-in/magic-link",
		verify: "/magic-link/verify",
	},
	send: { windowSeconds: MINUTE_SECONDS, max: 3 },
	verify: { windowSeconds: MINUTE_SECONDS, max: 10 },
	resendCooldownSeconds: MINUTE_SECONDS / 2,
} as const;

export const AUTH_ERROR = {
	invalidToken: "INVALID_TOKEN",
	signInNotAllowed: "SIGN_IN_NOT_ALLOWED",
	emailNotSent: "EMAIL_NOT_SENT",
} as const;
