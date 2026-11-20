import type ContextDev from "context.dev";
import { APIError } from "context.dev/core/error";
import type { BrandRetrieveResponse } from "context.dev/resources/brand";
import { z } from "zod";
import {
	contextDevApiKey,
	contextDevClient,
	contextDevConfigured,
} from "./context-client";
import { CONTEXT } from "./context-config";
import { cachedLookup, metered } from "./research/meter";
import { RESEARCH } from "./research/research-config";
import { publicDomain } from "./research/urls";

export type JsonSchema = {
	type?:
		| "array"
		| "boolean"
		| "integer"
		| "null"
		| "number"
		| "object"
		| "string";
	description?: string;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
	required?: string[];
	enum?: (string | number | boolean | null)[];
	additionalProperties?: boolean | JsonSchema;
};

export type Brand = {
	domain?: string | null;
	title?: string | null;
	description?: string | null;
	slogan?: string | null;
	email?: string | null;
	phone?: string | null;
	colors?: { hex?: string | null; name?: string | null }[] | null;
	logos?:
		| {
				url?: string | null;
				mode?: string | null;
				type?: string | null;
				colors?: { hex?: string | null; name?: string | null }[] | null;
		  }[]
		| null;
	socials?: { type?: string | null; url?: string | null }[] | null;
	address?: {
		city?: string | null;
		state_code?: string | null;
		country?: string | null;
		country_code?: string | null;
	} | null;
	industries?: {
		eic?: { industry?: string | null; subindustry?: string | null }[] | null;
	} | null;
	links?: {
		pricing?: string | null;
		careers?: string | null;
	} | null;
};

export type LookupResult =
	| { outcome: "found"; brand: Brand; raw: unknown }
	| { outcome: "skipped"; reason: string }
	| { outcome: "failed"; reason: string; retryable: boolean };

export type SearchResult = {
	url: string | null;
	title: string | null;
	description: string | null;
	markdown: string | null;
};

export function contextDev(): ContextDev | null {
	return contextDevClient();
}

export function contextDevEnabled(): boolean {
	return contextDevConfigured();
}

export async function brandByDomain(
	domain: string,
	maxAgeMs?: number,
	target?: { companyId?: string; previewUser?: string },
): Promise<LookupResult> {
	if (!publicDomain(domain))
		return {
			outcome: "skipped",
			reason: "The business needs a public domain.",
		};
	const params = {
		type: "by_domain",
		domain,
		timeoutMS: CONTEXT.timeoutMs,
	} as const;

	return lookup(
		maxAgeMs === undefined ? params : { ...params, maxAgeMs },
		target,
	);
}

export async function extract(
	url: string,
	schema: JsonSchema,
	instructions: string,
): Promise<
	{ outcome: "found"; data: unknown } | { outcome: "failed"; reason: string }
> {
	if (!publicDomain(url))
		return { outcome: "failed", reason: "Enter a public website URL." };
	const api = contextDev();
	if (!api) {
		return { outcome: "failed", reason: "Context.dev is not configured." };
	}

	try {
		const response = await metered(
			{
				operation: "web.extract",
				key: JSON.stringify([url, schema, instructions]),
				estimate:
					RESEARCH.extract.maxPages *
					RESEARCH.operations["web.extract"].estimateCredits,
			},
			() =>
				api.web.extract({
					url,
					schema,
					instructions,
					maxPages: RESEARCH.extract.maxPages,
					timeoutMS: CONTEXT.timeoutMs,
				}),
		);
		return { outcome: "found", data: response.data };
	} catch (error) {
		return { outcome: "failed", reason: describe(error) };
	}
}

export async function search(
	query: string,
	options: { limit?: number; excludeDomains?: string[] } = {},
): Promise<
	| { outcome: "found"; results: SearchResult[] }
	| { outcome: "failed"; reason: string }
> {
	const api = contextDev();
	if (!api) {
		return { outcome: "failed", reason: "Context.dev is not configured." };
	}

	const params = {
		query,
		numResults: Math.max(options.limit ?? 10, 10),
		markdownOptions: { enabled: true },
	};

	try {
		const response = await metered(
			{
				operation: "web.search",
				key: JSON.stringify(params),
				estimate: params.numResults + Math.ceil(params.numResults / 10),
			},
			() =>
				api.web.search(
					options.excludeDomains
						? { ...params, excludeDomains: options.excludeDomains }
						: params,
				),
		);

		const results = (response.results ?? []).map((result) => ({
			url: result.url ?? null,
			title: result.title ?? null,
			description: result.description ?? null,
			markdown:
				result.markdown?.code === "SUCCESS"
					? (result.markdown.markdown ?? null)
					: null,
		}));

		return { outcome: "found", results };
	} catch (error) {
		return { outcome: "failed", reason: describe(error) };
	}
}

const cachedBrand = cachedLookup<BrandRetrieveResponse>();
async function lookup(
	params: Parameters<ContextDev["brand"]["retrieve"]>[0],
	target?: { companyId?: string; previewUser?: string },
): Promise<LookupResult> {
	const api = contextDev();
	if (!api) {
		return { outcome: "skipped", reason: "Context.dev is not configured." };
	}

	try {
		const response = await cachedBrand(
			{
				operation: "brand.retrieve",
				domain: params.type === "by_domain" ? params.domain : undefined,
				key: JSON.stringify(params),
				target: { companyId: target?.companyId },
				previewUser: target?.previewUser,
			},
			() => api.brand.retrieve(params),
			"maxAgeMs" in params && params.maxAgeMs === 0,
		);
		const brand = response.brand as Brand | undefined;

		if (!brand) return { outcome: "skipped", reason: "No brand matched." };

		return { outcome: "found", brand, raw: response };
	} catch (error) {
		return classify(error);
	}
}

function classify(cause: unknown): LookupResult {
	if (!(cause instanceof APIError)) {
		return { outcome: "failed", reason: describe(cause), retryable: true };
	}

	const code = errorCode(cause);

	if (cause.status === 400) {
		if (code === "NOT_FOUND" || code === "WEBSITE_ACCESS_ERROR") {
			return {
				outcome: "skipped",
				reason:
					code === "NOT_FOUND"
						? "No brand matched this domain."
						: "The site could not be reached.",
			};
		}
		return { outcome: "failed", reason: describe(cause), retryable: false };
	}

	if (cause.status === 422) {
		return {
			outcome: "skipped",
			reason: "That is a personal or disposable email address.",
		};
	}

	if (cause.status === 401 || cause.status === 403) {
		return { outcome: "failed", reason: describe(cause), retryable: false };
	}

	if (cause.status === 408 || cause.status === 429) {
		return { outcome: "failed", reason: describe(cause), retryable: true };
	}

	return {
		outcome: "failed",
		reason: describe(cause),
		retryable: (cause.status ?? 500) >= 500,
	};
}

const apiErrorBody = z
	.object({ error_code: z.string().optional().catch(undefined) })
	.catch({});

function errorCode(error: APIError): string | undefined {
	return apiErrorBody.parse(error.error).error_code;
}

export function describe(cause: unknown): string {
	return withoutKey(
		cause instanceof APIError
			? `${cause.status ?? "?"} ${errorCode(cause) ?? cause.message}`
			: cause instanceof Error
				? cause.message
				: String(cause),
	).slice(0, CONTEXT.errorChars);
}

function withoutKey(text: string): string {
	const key = contextDevApiKey();
	return key ? text.split(key).join(CONTEXT.redactedKey) : text;
}
