import { expect, it } from "bun:test";
import {
	getRewrittenUrl,
	unstable_doesMiddlewareMatch,
	unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import project from "../../../vercel.json";
import { config } from "../proxy.js";

const rewrites = project.rewrites.map(({ source, destination }) => ({
	source,
	destination: `/${destination.service}`,
}));

it.each([
	"dispatch",
	"agent-dispatch",
	"builder-dispatch",
	"cancel-run",
	"brand-preview",
	"slack/create-channel",
])("routes %s to the agent without a workspace sign-in", async (command) => {
	const url = `https://crm.example/internal/crm/${command}`;
	expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
	const response = await unstable_getResponseFromNextConfig({
		url,
		nextConfig: { rewrites: async () => rewrites },
	});
	expect(getRewrittenUrl(response)).toBe("https://crm.example/agent");
});

it.each([
	"/internal/crm/dispatch-health",
	"/internal/mcp/connections/example/token",
	"/internal/crm/dispatch/extra",
])("keeps %s behind the workspace proxy", async (path) => {
	const url = `https://crm.example${path}`;
	expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
	const response = await unstable_getResponseFromNextConfig({
		url,
		nextConfig: { rewrites: async () => rewrites },
	});
	expect(getRewrittenUrl(response)).toBe("https://crm.example/app");
});
