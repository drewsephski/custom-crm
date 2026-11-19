import { afterEach, describe, expect, it } from "bun:test";
import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { WORKSPACE_HEADER } from "@crm/auth/workspace-header";
import { NextRequest } from "next/server";
import { readWorkspaceGate } from "../lib/onboarding";
import { proxy } from "../proxy";

const SESSION_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token=abc.def`;

const SLUG = "comp-ai";

const realFetch = globalThis.fetch;

const realMarketing = process.env.IS_MARKETING;

afterEach(() => {
	globalThis.fetch = realFetch;
	marketing(realMarketing);
});

function marketing(value: string | undefined) {
	if (value === undefined) delete process.env.IS_MARKETING;
	else process.env.IS_MARKETING = value;
}

function stub(
	handler: (url: string, workspace: string | null) => Promise<Response>,
) {
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
		handler(
			String(input),
			new Headers(init?.headers).get(WORKSPACE_HEADER),
		)) as unknown as typeof fetch;
}

type GateResponse =
	| { result: { data: unknown } }
	| { error: { message: string; data: { code: string } } };

function json(body: GateResponse, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function answerWith(body: GateResponse, status = 200) {
	stub(async () => json(body, status));
}

const workspace = (data: {
	onboarded: boolean;
	canRename: boolean;
	slug?: string;
}) => ({ result: { data: { slug: SLUG, ...data } } });

const forbidden: GateResponse = {
	error: {
		message: "You are not a member of that workspace.",
		data: { code: "FORBIDDEN" },
	},
};

const noWorkspace: GateResponse = {
	error: { message: "NO_WORKSPACE", data: { code: "PRECONDITION_FAILED" } },
};

function setup({
	onboarded = true,
	canRename = true,
	slug = SLUG,
	member = [SLUG],
	none = false,
}: {
	onboarded?: boolean;
	canRename?: boolean;
	slug?: string;
	member?: string[];
	none?: boolean;
} = {}) {
	const calls: Array<string | null> = [];

	stub(async (_url, requested) => {
		calls.push(requested);
		if (none) return json(noWorkspace, 412);
		if (requested && !member.includes(requested)) return json(forbidden, 403);
		return json(workspace({ onboarded, canRename, slug: requested ?? slug }));
	});

	return calls;
}

function request(pathname: string, cookies: string[] = []) {
	return new NextRequest(new URL(pathname, "http://localhost:3000"), {
		headers: cookies.length ? { cookie: cookies.join("; ") } : {},
	});
}

function redirectedTo(response: Response): string | null {
	const location = response.headers.get("location");

	return location ? new URL(location).pathname : null;
}

function forwardedWorkspace(response: Response): string | null {
	return response.headers.get(`x-middleware-request-${WORKSPACE_HEADER}`);
}

describe("readWorkspaceGate", () => {
	it("reads the workspace out of a plain tRPC envelope", async () => {
		setup({ onboarded: false });

		expect(
			await readWorkspaceGate(request("/", [SESSION_COOKIE]), null),
		).toEqual({
			kind: "workspace",
			slug: SLUG,
			onboarded: false,
			canRename: true,
		});
	});

	it("names the workspace it asks about", async () => {
		const calls = setup();

		await readWorkspaceGate(request("/", [SESSION_COOKIE]), SLUG);

		expect(calls).toEqual([SLUG]);
	});

	it("tells a stranger's workspace from a missing one", async () => {
		setup();
		expect(
			(await readWorkspaceGate(request("/", [SESSION_COOKIE]), "harbor")).kind,
		).toBe("not-a-member");

		setup({ none: true });
		expect(
			(await readWorkspaceGate(request("/", [SESSION_COOKIE]), null)).kind,
		).toBe("no-workspace");
	});

	it("is unknown when the API cannot be read", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(
			(await readWorkspaceGate(request("/", [SESSION_COOKIE]), null)).kind,
		).toBe("unknown");

		answerWith({ result: { data: { nothing: "useful" } } });
		expect(
			(await readWorkspaceGate(request("/", [SESSION_COOKIE]), null)).kind,
		).toBe("unknown");
	});
});

describe("proxy", () => {
	it("shows a stranger the landing page and nothing behind it", async () => {
		marketing("true");

		expect(redirectedTo(await proxy(request("/")))).toBeNull();
		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
		expect(redirectedTo(await proxy(request(`/${SLUG}`)))).toBe("/sign-in");
	});

	it("sends a stranger to sign in when the install has no landing page", async () => {
		marketing(undefined);

		expect(redirectedTo(await proxy(request("/")))).toBe("/sign-in");
		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
	});

	it("ignores a neighbour's cookie from the parent domain", async () => {
		expect(AUTH_COOKIE_PREFIX).not.toBe("better-auth");
		setup();

		expect(
			redirectedTo(
				await proxy(
					request(`/${SLUG}/companies`, [
						"better-auth.session_token=someone.else",
					]),
				),
			),
		).toBe("/sign-in");
	});

	it("sends an account with no workspace to create one", async () => {
		setup({ none: true });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBe("/onboarding");
		expect(
			redirectedTo(await proxy(request("/onboarding", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("gates a workspace whose details are not filled in", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBe("/onboarding");
		expect(
			redirectedTo(await proxy(request("/onboarding", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("takes a settled rep off the setup page, unless they are creating another workspace", async () => {
		setup();

		expect(
			redirectedTo(await proxy(request("/onboarding", [SESSION_COOKIE]))),
		).toBe(`/${SLUG}`);
		expect(
			redirectedTo(await proxy(request("/onboarding?new=1", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("never blocks the app on a research key", async () => {
		setup();

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBeNull();
		expect(
			redirectedTo(
				await proxy(request("/onboarding/research", [SESSION_COOKIE])),
			),
		).toBeNull();
	});

	it("moves a workspace the rep does not belong to onto their own, keeping the rest", async () => {
		setup();

		expect(
			redirectedTo(
				await proxy(request("/harbor/settings/members", [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}/settings/members`);
	});

	it("keeps each workspace a rep belongs to on its own address", async () => {
		setup({ member: [SLUG, "harbor"] });

		const response = await proxy(
			request("/harbor/companies", [SESSION_COOKIE]),
		);

		expect(redirectedTo(response)).toBeNull();
		expect(forwardedWorkspace(response)).toBe("harbor");
	});

	it("asks again on every request, and remembers nothing", async () => {
		const calls = setup();

		const first = await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE]));
		expect([...first.cookies.getAll()]).toHaveLength(0);

		await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE]));
		expect(calls).toEqual([SLUG, SLUG]);
	});

	it("puts the slug on a link that predates it, keeping the query", async () => {
		setup();

		const response = await proxy(
			request("/companies?record=contact:abc", [SESSION_COOKIE]),
		);

		expect(response.headers.get("location")).toBe(
			`http://localhost:3000/${SLUG}/companies?record=contact:abc`,
		);
	});

	it("never fights /grant-access or the agent bridge", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/grant-access", [SESSION_COOKIE]))),
		).toBeNull();
		expect(
			redirectedTo(await proxy(request("/eve/v1/info", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("fails open when the API is unreachable", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBeNull();
	});
});
