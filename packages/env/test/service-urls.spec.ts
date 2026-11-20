import { describe, expect, it } from "bun:test";
import { agentServiceUrl, apiServiceUrl } from "../src/service-urls";

describe("runtime service bindings", () => {
	it("resolves each request against its current binding and preserves the base path", () => {
		const previousApi = process.env.INTERNAL_API_URL;
		const previousAgent = process.env.INTERNAL_AGENT_URL;
		try {
			process.env.INTERNAL_API_URL = "http://service.test/api-binding/";
			process.env.INTERNAL_AGENT_URL = "http://service.test/agent-binding";
			expect(apiServiceUrl("/api/trpc?batch=1").href).toBe(
				"http://service.test/api-binding/api/trpc?batch=1",
			);
			expect(agentServiceUrl("/internal/crm/dispatch").href).toBe(
				"http://service.test/agent-binding/internal/crm/dispatch",
			);
		} finally {
			if (previousApi === undefined) delete process.env.INTERNAL_API_URL;
			else process.env.INTERNAL_API_URL = previousApi;
			if (previousAgent === undefined) delete process.env.INTERNAL_AGENT_URL;
			else process.env.INTERNAL_AGENT_URL = previousAgent;
		}
	});
});
