const MILLION = 1_000_000;

export type AnthropicModel = {
	id: string;
	contextWindowTokens: number;
	usdPerMillionInput: number;
	usdPerMillionOutput: number;
};

type ModelPrice = Omit<AnthropicModel, "id">;

const KNOWN = new Map<string, ModelPrice>([
	[
		"claude-haiku-5-5",
		{
			contextWindowTokens: MILLION,
			usdPerMillionInput: 0.1,
			usdPerMillionOutput: 0.5,
		},
	],
	[
		"claude-sonnet-5-5",
		{
			contextWindowTokens: MILLION,
			usdPerMillionInput: 2,
			usdPerMillionOutput: 10,
		},
	],
	[
		"claude-opus-5-5",
		{
			contextWindowTokens: MILLION,
			usdPerMillionInput: 4,
			usdPerMillionOutput: 20,
		},
	],
]);

const UNKNOWN_MODEL_PRICE: ModelPrice = {
	contextWindowTokens: 200_000,
	usdPerMillionInput: 4,
	usdPerMillionOutput: 20,
};

export const AI_MODEL_DEFAULTS = {
	default: "claude-haiku-5-5",
	complex: "claude-opus-5-5",
} as const;

function modelId(value: string | undefined, fallback: string): string {
	const trimmed = value?.trim().replace(/^anthropic\//u, "");
	return trimmed && /^claude-[a-z0-9-]+$/u.test(trimmed) ? trimmed : fallback;
}

export function describeModel(id: string): AnthropicModel {
	return { id, ...(KNOWN.get(id) ?? UNKNOWN_MODEL_PRICE) };
}

export function defaultModel(): AnthropicModel {
	return describeModel(
		modelId(process.env.ANTHROPIC_MODEL, AI_MODEL_DEFAULTS.default),
	);
}

export function complexModel(): AnthropicModel {
	return describeModel(
		modelId(process.env.ANTHROPIC_COMPLEX_MODEL, AI_MODEL_DEFAULTS.complex),
	);
}

export function isAnthropicConfigured(): boolean {
	return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function costUsd(
	model: AnthropicModel,
	usage: { inputTokens: number; outputTokens: number },
): number {
	return (
		(usage.inputTokens * model.usdPerMillionInput +
			usage.outputTokens * model.usdPerMillionOutput) /
		MILLION
	);
}
