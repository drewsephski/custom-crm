import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { agentCommandBridge } from "../src/service-urls";

const keys = [
	"AGENT_BRIDGE_SECRET",
	"AGENT_URL",
	"API_URL",
	"INTERNAL_AGENT_URL",
	"VERCEL_ENV",
	"VERCEL_URL",
	"VERCEL_AUTOMATION_BYPASS_SECRET",
];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
const path = "/internal/crm/dispatch";

beforeEach(() => {
	for (const key of keys) delete process.env[key];
	process.env.AGENT_BRIDGE_SECRET = "test-bridge";
	process.env.API_URL = "https://crm.example";
});

afterEach(() => {
	for (const [key, value] of previous) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

async function dispatch() {
	const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(null, { status: 202 }),
	);
	try {
		await agentCommandBridge()?.post(path, {
			signal: new AbortController().signal,
			body: "{}",
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		const call = fetch.mock.calls[0];
		if (!call) throw new Error("Missing agent request");
		const request = new Request(...call);
		expect(request.method).toBe("POST");
		expect(request.redirect).toBe("error");
		expect(request.headers.get("authorization")).toBe("Bearer test-bridge");
		expect(request.headers.get("content-type")).toBe("application/json");
		expect(await request.text()).toBe("{}");
		return request;
	} finally {
		fetch.mockRestore();
	}
}

it("sends protected preview commands to the current deployment", async () => {
	process.env.VERCEL_ENV = "preview";
	process.env.VERCEL_URL = "preview.example";
	process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "test-bypass";
	const request = await dispatch();
	expect(request.url).toBe(`https://preview.example${path}`);
	expect(request.headers.get("x-vercel-protection-bypass")).toBe("test-bypass");
});

it("uses the public production origin without a protection bypass", async () => {
	process.env.VERCEL_ENV = "production";
	process.env.VERCEL_URL = "production-deployment.example";
	expect((await dispatch()).url).toBe(`https://crm.example${path}`);
});

it("uses the standalone agent URL without sending a Vercel credential", async () => {
	process.env.AGENT_URL = "http://127.0.0.1:4000";
	process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "test-bypass";
	const request = await dispatch();
	expect(request.url).toBe(`http://127.0.0.1:4000${path}`);
	expect(request.headers.has("x-vercel-protection-bypass")).toBe(false);
});

it("disables commands without a bridge secret", () => {
	delete process.env.AGENT_BRIDGE_SECRET;
	expect(agentCommandBridge()).toBeNull();
});
