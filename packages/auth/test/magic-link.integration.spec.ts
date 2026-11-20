import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import { randomInt, randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { runAsSystem } from "@crm/db/tenancy";
import { auth } from "../src/auth";
import { AUTH_ERROR, MAGIC_LINK } from "../src/auth-config";
import { SESSION_COOKIE_NAME } from "../src/cookies";
import { apiUrl, appUrl, env } from "../src/env";
import { GOOGLE_PROVIDER_ID } from "../src/scopes";
import { googleHostedDomainHint } from "../src/workspace";

const RUN = process.env.TEST_RUN_ID ?? "magic-link-spec";
const EMAIL_DOMAIN = "magic-link.example.test";
const IP_PREFIX = `10.${randomInt(1, 250)}.${randomInt(1, 250)}`;
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ENTRY_URL = `${appUrl}/onboarding`;
const SIGN_IN_URL = `${appUrl}/sign-in`;
const HOSTED_DOMAIN = googleHostedDomainHint();

const realFetch = globalThis.fetch;
const realEnv = {
	ALLOWED_SIGN_IN: process.env.ALLOWED_SIGN_IN,
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	EMAIL_FROM: process.env.EMAIL_FROM,
};

let nextHost = 1;
let info: ReturnType<typeof spyOn<Console, "info">>;
let errors: ReturnType<typeof spyOn<Console, "error">>;

function restoreEnv() {
	for (const [key, value] of Object.entries(realEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function addressOf(label: string): string {
	return `${RUN}-${label}@${EMAIL_DOMAIN}`.toLowerCase();
}

function freshIp(): string {
	nextHost += 1;
	return `${IP_PREFIX}.${nextHost}`;
}

async function clean() {
	await runAsSystem("clean magic link spec rows", async () => {
		const mine = { startsWith: `${RUN}-`.toLowerCase() };
		const users = await db.user.findMany({
			where: { email: { ...mine, endsWith: `@${EMAIL_DOMAIN}` } },
			select: { id: true },
		});
		const userIds = users.map((user) => user.id);

		await db.session.deleteMany({ where: { userId: { in: userIds } } });
		await db.account.deleteMany({ where: { userId: { in: userIds } } });
		await db.user.deleteMany({ where: { id: { in: userIds } } });
		await db.verification.deleteMany({
			where: { value: { contains: `${RUN}-`.toLowerCase() } },
		});
		await db.rateLimit.deleteMany({
			where: { key: { startsWith: `${IP_PREFIX}.` } },
		});
	});
}

function post(path: string, body: object, ip: string): Promise<Response> {
	return auth.handler(
		new Request(`${apiUrl}/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: appUrl,
				"x-forwarded-for": ip,
			},
			body: JSON.stringify(body),
		}),
	);
}

function requestLink(
	email: string,
	ip: string,
	callbackURL = ENTRY_URL,
): Promise<Response> {
	return post(
		MAGIC_LINK.paths.send,
		{
			email,
			callbackURL,
			newUserCallbackURL: ENTRY_URL,
			errorCallbackURL: SIGN_IN_URL,
		},
		ip,
	);
}

function open(url: string, ip: string): Promise<Response> {
	return auth.handler(new Request(url, { headers: { "x-forwarded-for": ip } }));
}

function lastLoggedLink(): string {
	const logged = info.mock.calls.flat().join("\n");
	const links = logged.match(/https?:\/\/\S+\/magic-link\/verify\?\S+/g) ?? [];
	const link = links.at(-1);
	if (!link) throw new Error("The console transport logged no sign-in link.");

	return link;
}

async function linkFor(email: string, ip: string): Promise<string> {
	const response = await requestLink(email, ip);
	expect(response.status).toBe(200);

	return lastLoggedLink();
}

function sessionCookie(response: Response): string | null {
	const cookie = response.headers
		.getSetCookie()
		.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));

	return cookie?.split(";")[0] ?? null;
}

function errorOf(response: Response): string | null {
	const location = response.headers.get("location");

	return location ? new URL(location).searchParams.get("error") : null;
}

function userByEmail(email: string) {
	return db.user.findUnique({
		where: { email },
		select: {
			id: true,
			emailVerified: true,
			accounts: { select: { providerId: true } },
			sessions: { select: { id: true } },
		},
	});
}

function base64Url(value: ArrayBuffer | string): string {
	const bytes =
		typeof value === "string"
			? new TextEncoder().encode(value)
			: new Uint8Array(value);

	return Buffer.from(bytes).toString("base64url");
}

async function googleSigner() {
	const kid = `spec-${randomUUID()}`;
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

	globalThis.fetch = (async (input: string | URL | Request) => {
		if (String(input) !== GOOGLE_CERTS_URL) {
			throw new Error(`Unexpected outbound request to ${String(input)}`);
		}

		return Response.json({
			keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }],
		});
	}) as unknown as typeof fetch;

	return async (email: string): Promise<string> => {
		const issuedAt = Math.floor(Date.now() / 1000);
		const header = base64Url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
		const claims = base64Url(
			JSON.stringify({
				iss: "https://accounts.google.com",
				aud: env.google?.clientId,
				sub: `google-${email}`,
				email,
				email_verified: true,
				name: "Spec Person",
				iat: issuedAt,
				exp: issuedAt + 300,
				...(HOSTED_DOMAIN && { hd: HOSTED_DOMAIN }),
			}),
		);
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			pair.privateKey,
			new TextEncoder().encode(`${header}.${claims}`),
		);

		return `${header}.${claims}.${base64Url(signature)}`;
	};
}

function googleSignIn(token: string, ip: string): Promise<Response> {
	return post(
		"/sign-in/social",
		{ provider: GOOGLE_PROVIDER_ID, idToken: { token } },
		ip,
	);
}

beforeAll(async () => {
	process.env.ALLOWED_SIGN_IN = "";
	delete process.env.RESEND_API_KEY;
	delete process.env.EMAIL_FROM;
	info = spyOn(console, "info").mockImplementation(() => {});
	errors = spyOn(console, "error").mockImplementation(() => {});
	await clean();
});

afterEach(() => {
	globalThis.fetch = realFetch;
	process.env.ALLOWED_SIGN_IN = "";
	delete process.env.RESEND_API_KEY;
	delete process.env.EMAIL_FROM;
});

afterAll(async () => {
	info.mockRestore();
	errors.mockRestore();
	restoreEnv();
	await clean();
});

describe("magic link sign-in", () => {
	it("registers a new address, verifies it and opens a session", async () => {
		const email = addressOf("new");
		const ip = freshIp();

		const sent = await requestLink(email, ip);
		expect(sent.status).toBe(200);
		expect(await sent.json()).toEqual({ status: true });
		expect(await userByEmail(email)).toBeNull();

		const link = lastLoggedLink();
		const response = await open(link, ip);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(ENTRY_URL);

		const cookie = sessionCookie(response);
		expect(cookie).not.toBeNull();

		const session = await auth.api.getSession({
			headers: new Headers({ cookie: cookie ?? "" }),
		});
		expect(session?.user.email).toBe(email);
		expect(session?.user.emailVerified).toBe(true);

		const user = await userByEmail(email);
		expect(user?.emailVerified).toBe(true);
		expect(user?.sessions).toHaveLength(1);
	});

	it("stores the token hashed and keeps it out of the address after sign-in", async () => {
		const email = addressOf("hashed");
		const ip = freshIp();
		const link = await linkFor(email, ip);
		const token = new URL(link).searchParams.get("token") ?? "";

		const [row] = await db.verification.findMany({
			where: { value: { contains: email } },
		});
		expect(token.length).toBeGreaterThan(20);
		expect(row?.identifier).toStartWith("magic-link:");
		expect(row?.identifier).not.toContain(token);
		expect(row?.value).not.toContain(token);

		const lifetimeMs = (row?.expiresAt.getTime() ?? 0) - Date.now();
		expect(lifetimeMs).toBeGreaterThan(
			(MAGIC_LINK.expiresInSeconds - 60) * 1000,
		);
		expect(lifetimeMs).toBeLessThanOrEqual(MAGIC_LINK.expiresInSeconds * 1000);

		const response = await open(link, ip);
		expect(response.headers.get("location")).not.toContain(token);
	});

	it("signs a returning address into the same account, at the page it asked for", async () => {
		const email = addressOf("returning");
		const ip = freshIp();

		await open(await linkFor(email, ip), ip);
		const first = await userByEmail(email);

		const sent = await requestLink(email, ip, `${appUrl}/invitations`);
		expect(sent.status).toBe(200);
		const response = await open(lastLoggedLink(), ip);
		const second = await userByEmail(email);

		expect(response.headers.get("location")).toBe(`${appUrl}/invitations`);
		expect(second?.id).toBe(first?.id);
		expect(second?.sessions).toHaveLength(2);
		expect(
			await db.user.count({
				where: { email: { equals: email, mode: "insensitive" } },
			}),
		).toBe(1);
	});

	it("refuses a link the second time", async () => {
		const email = addressOf("reused");
		const ip = freshIp();
		const link = await linkFor(email, ip);

		expect(sessionCookie(await open(link, ip))).not.toBeNull();

		const again = await open(link, ip);

		expect(again.status).toBe(302);
		expect(again.headers.get("location")).toStartWith(`${SIGN_IN_URL}?`);
		expect(errorOf(again)).toBe(AUTH_ERROR.invalidToken);
		expect(sessionCookie(again)).toBeNull();
		expect((await userByEmail(email))?.sessions).toHaveLength(1);
	});

	it("refuses a token that was never issued", async () => {
		const ip = freshIp();
		const link = new URL(await linkFor(addressOf("forged"), ip));
		link.searchParams.set("token", "notTheTokenThatWasSent");

		const response = await open(link.toString(), ip);

		expect(errorOf(response)).toBe(AUTH_ERROR.invalidToken);
		expect(sessionCookie(response)).toBeNull();
		expect(await userByEmail(addressOf("forged"))).toBeNull();
	});

	it("refuses an expired link and creates no account", async () => {
		const email = addressOf("expired");
		const ip = freshIp();
		const link = await linkFor(email, ip);

		await db.verification.updateMany({
			where: { value: { contains: email } },
			data: { expiresAt: new Date(Date.now() - 1000) },
		});

		const response = await open(link, ip);

		expect(errorOf(response)).toBe(AUTH_ERROR.invalidToken);
		expect(sessionCookie(response)).toBeNull();
		expect(await userByEmail(email)).toBeNull();
	});

	it("refuses a callback on another origin", async () => {
		const ip = freshIp();
		const link = new URL(await linkFor(addressOf("redirect"), ip));
		link.searchParams.set("callbackURL", "https://evil.example/steal");

		const response = await open(link.toString(), ip);

		expect(response.status).toBe(403);
		expect(sessionCookie(response)).toBeNull();
		expect(await userByEmail(addressOf("redirect"))).toBeNull();
	});

	it("answers the same for an address with an account and one without", async () => {
		const known = addressOf("known");
		const ip = freshIp();
		await open(await linkFor(known, ip), ip);

		const forKnown = await requestLink(known, freshIp());
		const forUnknown = await requestLink(addressOf("unknown"), freshIp());

		expect(forUnknown.status).toBe(forKnown.status);
		expect(await forUnknown.text()).toBe(await forKnown.text());
		expect(await userByEmail(addressOf("unknown"))).toBeNull();
	});

	it("surfaces a failed send as an error, never as a success", async () => {
		process.env.RESEND_API_KEY = "re_spec_key";
		process.env.EMAIL_FROM = "Spec <spec@example.test>";
		globalThis.fetch = (async () =>
			Response.json(
				{ message: "The domain is not verified." },
				{ status: 403 },
			)) as unknown as typeof fetch;

		const response = await requestLink(addressOf("unsent"), freshIp());
		const body = await response.text();

		expect(response.status).toBe(503);
		expect(JSON.parse(body)).toMatchObject({ code: AUTH_ERROR.emailNotSent });
		expect(body).not.toContain("re_spec_key");
		expect(errors.mock.calls.flat().map(String).join(" ")).not.toContain(
			"re_spec_key",
		);
	});

	it("limits how many links one address can request per window", async () => {
		const ip = freshIp();
		const statuses: number[] = [];

		for (let attempt = 0; attempt <= MAGIC_LINK.send.max; attempt += 1) {
			const response = await requestLink(addressOf("limited"), ip);
			statuses.push(response.status);
		}

		expect(statuses.slice(0, MAGIC_LINK.send.max)).toEqual(
			Array.from({ length: MAGIC_LINK.send.max }, () => 200),
		);
		expect(statuses.at(-1)).toBe(429);
	});

	it("limits how many links one address can open per window", async () => {
		const ip = freshIp();
		const link = new URL(await linkFor(addressOf("opened"), freshIp()));
		link.searchParams.set("token", "notTheTokenThatWasSent");
		const statuses: number[] = [];

		for (let attempt = 0; attempt <= MAGIC_LINK.verify.max; attempt += 1) {
			statuses.push((await open(link.toString(), ip)).status);
		}

		expect(statuses.at(0)).toBe(302);
		expect(statuses.at(-1)).toBe(429);
	});

	it("refuses a new address the allow-list does not name, on the sign-in page", async () => {
		const email = addressOf("stranger");
		const ip = freshIp();
		const link = await linkFor(email, ip);

		process.env.ALLOWED_SIGN_IN = "allowed.example.test";
		const response = await open(link, ip);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toStartWith(`${SIGN_IN_URL}?`);
		expect(errorOf(response)).toBe(AUTH_ERROR.signInNotAllowed);
		expect(sessionCookie(response)).toBeNull();
		expect(await userByEmail(email)).toBeNull();
	});
});

describe.skipIf(!env.google)("magic link and Google share one account", () => {
	it("links Google to an account a magic link created", async () => {
		const email = addressOf("link-then-google");
		const ip = freshIp();
		await open(await linkFor(email, ip), ip);
		const created = await userByEmail(email);
		expect(created?.accounts).toEqual([]);

		const sign = await googleSigner();
		const response = await googleSignIn(await sign(email), freshIp());
		const linked = await userByEmail(email);

		expect(response.status).toBe(200);
		expect(sessionCookie(response)).not.toBeNull();
		expect(linked?.id).toBe(created?.id);
		expect(linked?.accounts).toEqual([{ providerId: GOOGLE_PROVIDER_ID }]);
		expect(
			await db.user.count({
				where: { email: { equals: email, mode: "insensitive" } },
			}),
		).toBe(1);
	});

	it("signs a Google account in by magic link without a second account", async () => {
		const email = addressOf("google-then-link");
		const sign = await googleSigner();
		const registered = await googleSignIn(await sign(email), freshIp());
		expect(registered.status).toBe(200);
		const created = await userByEmail(email);
		expect(created?.accounts).toEqual([{ providerId: GOOGLE_PROVIDER_ID }]);

		globalThis.fetch = realFetch;
		const ip = freshIp();
		const response = await open(await linkFor(email, ip), ip);
		const after = await userByEmail(email);
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: sessionCookie(response) ?? "" }),
		});

		expect(response.headers.get("location")).toBe(ENTRY_URL);
		expect(session?.user.id).toBe(created?.id);
		expect(after?.accounts).toEqual([{ providerId: GOOGLE_PROVIDER_ID }]);
		expect(
			await db.user.count({
				where: { email: { equals: email, mode: "insensitive" } },
			}),
		).toBe(1);
	});
});
