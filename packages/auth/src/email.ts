import { z } from "zod";
import { EMAIL } from "./auth-config";
import { type EmailSettings, emailSettings } from "./env";

export type EmailDelivery = "resend" | "console" | "off";

export type EmailMessage = {
	to: string;
	subject: string;
	text: string;
	html: string;
};

export type EmailFailureReason =
	| "off"
	| "provider"
	| "network"
	| "timeout"
	| "unreadable-response";

export type EmailResult =
	| { ok: true; delivery: "resend"; id: string }
	| { ok: true; delivery: "console" }
	| { ok: false; reason: EmailFailureReason; detail: string };

export type SendEmailOptions = {
	settings?: EmailSettings;
	timeoutMs?: number;
};

type Transport =
	| { kind: "resend"; apiKey: string; from: string }
	| { kind: "console" }
	| { kind: "off" };

const resendAccepted = z.object({ id: z.string().min(1) });

const resendRefused = z.object({
	message: z.string().min(1),
	name: z.string().optional(),
});

function transportOf(settings: EmailSettings): Transport {
	if (settings.apiKey && settings.from) {
		return { kind: "resend", apiKey: settings.apiKey, from: settings.from };
	}

	return settings.isProduction ? { kind: "off" } : { kind: "console" };
}

export function emailDelivery(
	settings: EmailSettings = emailSettings(),
): EmailDelivery {
	return transportOf(settings).kind;
}

export function emailEnabled(
	settings: EmailSettings = emailSettings(),
): boolean {
	return emailDelivery(settings) !== "off";
}

export async function sendEmail(
	message: EmailMessage,
	options: SendEmailOptions = {},
): Promise<EmailResult> {
	const transport = transportOf(options.settings ?? emailSettings());

	if (transport.kind === "off") {
		return {
			ok: false,
			reason: "off",
			detail: "Email delivery is not configured.",
		};
	}

	if (transport.kind === "console") {
		console.info(
			`[auth] Email not sent, RESEND_API_KEY or EMAIL_FROM is not set.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
		);
		return { ok: true, delivery: "console" };
	}

	return sendWithResend(
		message,
		transport,
		options.timeoutMs ?? EMAIL.resend.timeoutMs,
	);
}

async function sendWithResend(
	message: EmailMessage,
	transport: { apiKey: string; from: string },
	timeoutMs: number,
): Promise<EmailResult> {
	let response: Response;

	try {
		response = await fetch(EMAIL.resend.endpoint, {
			method: "POST",
			headers: {
				authorization: `Bearer ${transport.apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				from: transport.from,
				to: [message.to],
				subject: message.subject,
				text: message.text,
				html: message.html,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError") {
			return {
				ok: false,
				reason: "timeout",
				detail: `Resend did not answer in ${timeoutMs} ms.`,
			};
		}

		return {
			ok: false,
			reason: "network",
			detail: error instanceof Error ? error.message : "Resend is unreachable.",
		};
	}

	const body: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		const refused = resendRefused.safeParse(body);
		return {
			ok: false,
			reason: "provider",
			detail: refused.success
				? `Resend answered ${response.status}: ${refused.data.message}`
				: `Resend answered ${response.status}.`,
		};
	}

	const accepted = resendAccepted.safeParse(body);
	if (!accepted.success) {
		return {
			ok: false,
			reason: "unreadable-response",
			detail: "Resend answered without a message id.",
		};
	}

	return { ok: true, delivery: "resend", id: accepted.data.id };
}
