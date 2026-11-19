import { afterEach, describe, expect, it } from "bun:test";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { AiCapabilityService } from "../src/agent/ai-capability.service";

const original = process.env.ANTHROPIC_API_KEY;

function capability(reachable: boolean) {
	const agent = { canReachAgent: () => reachable } as AgentTriggerService;
	return new AiCapabilityService(agent);
}

afterEach(() => {
	if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
	else process.env.ANTHROPIC_API_KEY = original;
});

describe("AI proposal capability", () => {
	it("is off without a model key", () => {
		delete process.env.ANTHROPIC_API_KEY;
		expect(capability(true).canGenerate()).toBe(false);
	});

	it("is off when the agent cannot be reached", () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		expect(capability(false).canGenerate()).toBe(false);
	});

	it("is on with a model key and a reachable agent", () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		expect(capability(true).canGenerate()).toBe(true);
	});
});
