import { afterEach, describe, expect, it } from "bun:test";
import {
	AI_MODEL_DEFAULTS,
	complexModel,
	costUsd,
	defaultModel,
	describeModel,
	isAnthropicConfigured,
} from "@crm/db/ai-models";

const saved = {
	model: process.env.ANTHROPIC_MODEL,
	complex: process.env.ANTHROPIC_COMPLEX_MODEL,
	key: process.env.ANTHROPIC_API_KEY,
};

function restore(key: string, value: string | undefined) {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

afterEach(() => {
	restore("ANTHROPIC_MODEL", saved.model);
	restore("ANTHROPIC_COMPLEX_MODEL", saved.complex);
	restore("ANTHROPIC_API_KEY", saved.key);
});

describe("the configured Anthropic models", () => {
	it("defaults to Haiku for everyday work and Opus for hard reasoning", () => {
		delete process.env.ANTHROPIC_MODEL;
		delete process.env.ANTHROPIC_COMPLEX_MODEL;

		expect(defaultModel().id).toBe(AI_MODEL_DEFAULTS.default);
		expect(complexModel().id).toBe(AI_MODEL_DEFAULTS.complex);
		expect(defaultModel().id).toBe("claude-haiku-5-5");
		expect(complexModel().id).toBe("claude-opus-5-5");
	});

	it("takes a native Anthropic id from the environment", () => {
		process.env.ANTHROPIC_MODEL = "claude-sonnet-5-5";
		process.env.ANTHROPIC_COMPLEX_MODEL = "anthropic/claude-opus-5-5";

		expect(defaultModel().id).toBe("claude-sonnet-5-5");
		expect(complexModel().id).toBe("claude-opus-5-5");
	});

	it("ignores a gateway id, which this install cannot route", () => {
		process.env.ANTHROPIC_MODEL = "zai/glm-5.2-fast";

		expect(defaultModel().id).toBe(AI_MODEL_DEFAULTS.default);
	});

	it("prices a call from the model's per-million rates", () => {
		const haiku = describeModel("claude-haiku-5-5");

		expect(
			costUsd(haiku, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
		).toBeCloseTo(0.6);
	});

	it("reports a missing key instead of failing", () => {
		delete process.env.ANTHROPIC_API_KEY;
		expect(isAnthropicConfigured()).toBe(false);

		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		expect(isAnthropicConfigured()).toBe(true);
	});
});
