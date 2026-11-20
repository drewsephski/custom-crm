import type { BrandRetrieveParams } from "context.dev/resources/brand";
import type { PersonEnrichParams } from "context.dev/resources/people";
import type {
	WebExtractParams,
	WebSearchParams,
} from "context.dev/resources/web";
import { z } from "zod";
import { contextDevClient } from "../context-client";

export type CallOptions = {
	signal: AbortSignal;
	timeout: number;
	maxRetries: 0;
};

export type ProviderClient = {
	brand: {
		retrieve(
			body: BrandRetrieveParams,
			options?: CallOptions,
		): PromiseLike<unknown>;
	};
	people: {
		enrich(
			body: PersonEnrichParams,
			options?: CallOptions,
		): PromiseLike<unknown>;
	};
	web: {
		search(body: WebSearchParams, options?: CallOptions): PromiseLike<unknown>;
		extract(
			body: WebExtractParams,
			options?: CallOptions,
		): PromiseLike<unknown>;
	};
	post(
		path: string,
		options: CallOptions & { body: unknown },
	): PromiseLike<unknown>;
};

export const PROVIDER_PATHS = {
	peopleSearch: "/people/search",
	answers: "/web/answers",
} as const;

const CREDITS_HEADER = "x-credits-used";

const metered = z.object({
	key_metadata: z.object({ credits_consumed: z.number().min(0) }),
});

export function defaultProviderClient(): ProviderClient | null {
	return contextDevClient()?.withOptions({ maxRetries: 0 }) ?? null;
}

export function creditsConsumed(raw: unknown): number | null {
	const parsed = metered.safeParse(raw);
	return parsed.success
		? Math.ceil(parsed.data.key_metadata.credits_consumed)
		: null;
}

export function creditsFromHeaders(
	headers: Headers | null | undefined,
): number | null {
	const raw = headers?.get(CREDITS_HEADER)?.trim();
	if (!raw) return null;

	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}
