import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { EMAIL } from "../src/auth-config";
import { emailDelivery, emailEnabled, sendEmail } from "../src/email";
import { invitationEmail, magicLinkEmail } from "../src/email-templates";
import type { EmailSettings } from "../src/env";

const API_KEY = "re_test_secret_key";

const CONFIGURED: EmailSettings = {
	apiKey: API_KEY,
	from: "Custom CRM <login@example.test>",
	isProduction: true,
};

const MESSAGE = {
	to: "rep@example.test",
	subject: "Sign in",
	text: "Open https://app.example.test/verify?token=abc",
	html: "<p>Open the link</p>",
};

const realFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit };

function stubFetch(handler: (call: Call) => Promise<Response>): Call[] {
	const calls: Call[] = [];

	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		const call = { url: String(input), init: init ?? {} };
		calls.push(call);
		return handler(call);
	}) as unknown as typeof fetch;

	return calls;
}

function json(
	body:
		| { id: string }
		| { message: string; name?: string; statusCode?: number }
		| { accepted: boolean },
	status = 200,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("emailDelivery", () => {
	it("uses Resend when the key and the sender are set", () => {
		expect(emailDelivery(CONFIGURED)).toBe("resend");
		expect(emailDelivery({ ...CONFIGURED, isProduction: false })).toBe(
			"resend",
		);
		expect(emailEnabled(CONFIGURED)).toBe(true);
	});

	it("is off in production without a key", () => {
		const settings = { ...CONFIGURED, apiKey: undefined };

		expect(emailDelivery(settings)).toBe("off");
		expect(emailEnabled(settings)).toBe(false);
	});

	it("is off in production without a sender", () => {
		expect(emailDelivery({ ...CONFIGURED, from: undefined })).toBe("off");
	});

	it("logs to the console outside production without a key", () => {
		const settings = {
			apiKey: undefined,
			from: undefined,
			isProduction: false,
		};

		expect(emailDelivery(settings)).toBe("console");
		expect(emailEnabled(settings)).toBe(true);
	});
});

describe("sendEmail", () => {
	it("posts the message to Resend and returns the message id", async () => {
		const calls = stubFetch(async () => json({ id: "email_123" }));

		const result = await sendEmail(MESSAGE, { settings: CONFIGURED });

		expect(result).toEqual({ ok: true, delivery: "resend", id: "email_123" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(EMAIL.resend.endpoint);
		expect(calls[0]?.init.method).toBe("POST");
		expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
			`Bearer ${API_KEY}`,
		);
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			from: CONFIGURED.from,
			to: [MESSAGE.to],
			subject: MESSAGE.subject,
			text: MESSAGE.text,
			html: MESSAGE.html,
		});
	});

	it("reports a provider error with its reason", async () => {
		stubFetch(async () =>
			json(
				{
					statusCode: 403,
					name: "validation_error",
					message: "The example.test domain is not verified.",
				},
				403,
			),
		);

		const result = await sendEmail(MESSAGE, { settings: CONFIGURED });

		expect(result).toEqual({
			ok: false,
			reason: "provider",
			detail: "Resend answered 403: The example.test domain is not verified.",
		});
	});

	it("reports a provider error that has no readable body", async () => {
		stubFetch(async () => new Response("Bad gateway", { status: 502 }));

		const result = await sendEmail(MESSAGE, { settings: CONFIGURED });

		expect(result).toEqual({
			ok: false,
			reason: "provider",
			detail: "Resend answered 502.",
		});
	});

	it("never calls a 200 without a message id a success", async () => {
		stubFetch(async () => json({ accepted: true }));

		const result = await sendEmail(MESSAGE, { settings: CONFIGURED });

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ reason: "unreadable-response" });
	});

	it("reports a network error", async () => {
		stubFetch(async () => {
			throw new TypeError("fetch failed");
		});

		const result = await sendEmail(MESSAGE, { settings: CONFIGURED });

		expect(result).toEqual({
			ok: false,
			reason: "network",
			detail: "fetch failed",
		});
	});

	it("gives up after the timeout", async () => {
		stubFetch(
			({ init }) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason),
					);
				}),
		);

		const result = await sendEmail(MESSAGE, {
			settings: CONFIGURED,
			timeoutMs: 20,
		});

		expect(result).toEqual({
			ok: false,
			reason: "timeout",
			detail: "Resend did not answer in 20 ms.",
		});
	});

	it("sends nothing in production without a key, and says so", async () => {
		const calls = stubFetch(async () => json({ id: "never" }));

		const result = await sendEmail(MESSAGE, {
			settings: { ...CONFIGURED, apiKey: undefined },
		});

		expect(result).toMatchObject({ ok: false, reason: "off" });
		expect(calls).toHaveLength(0);
	});

	it("logs the message outside production without a key", async () => {
		const calls = stubFetch(async () => json({ id: "never" }));
		const info = spyOn(console, "info").mockImplementation(() => {});

		const result = await sendEmail(MESSAGE, {
			settings: { apiKey: undefined, from: undefined, isProduction: false },
		});

		const logged = info.mock.calls.flat().join("\n");
		info.mockRestore();

		expect(result).toEqual({ ok: true, delivery: "console" });
		expect(calls).toHaveLength(0);
		expect(logged).toContain(MESSAGE.to);
		expect(logged).toContain(MESSAGE.subject);
		expect(logged).toContain("https://app.example.test/verify?token=abc");
	});

	it("never writes the API key to the console", async () => {
		const outputs = [
			spyOn(console, "info").mockImplementation(() => {}),
			spyOn(console, "warn").mockImplementation(() => {}),
			spyOn(console, "error").mockImplementation(() => {}),
			spyOn(console, "log").mockImplementation(() => {}),
		];

		stubFetch(async () => json({ message: "Invalid API key." }, 401));
		const refused = await sendEmail(MESSAGE, { settings: CONFIGURED });
		stubFetch(async () => {
			throw new TypeError("fetch failed");
		});
		const unreachable = await sendEmail(MESSAGE, { settings: CONFIGURED });

		const written = outputs.flatMap((output) => output.mock.calls.flat());
		for (const output of outputs) output.mockRestore();

		expect(JSON.stringify([refused, unreachable, written])).not.toContain(
			API_KEY,
		);
	});
});

describe("email templates", () => {
	it("writes a sign-in email with one link and the expiry", () => {
		const url =
			"https://api.example.test/api/auth/magic-link/verify?token=abc&callbackURL=https%3A%2F%2Fapp.example.test%2Fonboarding";
		const email = magicLinkEmail({ url });

		expect(email.subject).toBe("Sign in to Custom CRM");
		expect(email.text).toContain(url);
		expect(email.text).toContain("15 minutes");
		expect(email.text).toContain("Ignore this email");
		expect(email.html).toContain(url.replaceAll("&", "&amp;"));
		expect(email.html).not.toContain("<img");
		expect(email.html.match(/<a /g)).toHaveLength(1);
	});

	it("escapes a workspace name in an invitation", () => {
		const email = invitationEmail({
			workspaceName: '<script>alert("x")</script>\nAgency',
			inviterName: "Dana & Co",
			role: "admin",
			email: "new@example.test",
			url: "https://app.example.test/sign-in?next=%2Finvitations",
			expiresInDays: 7,
		});

		expect(email.subject).not.toContain("\n");
		expect(email.html).not.toContain("<script>");
		expect(email.html).toContain("&lt;script&gt;");
		expect(email.html).toContain("Dana &amp; Co");
		expect(email.text).toContain("as an admin");
		expect(email.text).toContain(
			"https://app.example.test/sign-in?next=%2Finvitations",
		);
	});
});
