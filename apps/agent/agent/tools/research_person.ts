import { defineTool } from "eve/tools";
import { z } from "zod";
import { CONTEXT_DEV_SEARCH, enabled, unavailable } from "../lib/capabilities";
import { CONTEXT } from "../lib/context-config";
import { search } from "../lib/context-dev";
import { spend } from "../lib/focus";
import { ask } from "../lib/perplexity";
import { inSessionTenant } from "../lib/tenant-scope";

const UNCONFIGURED =
	"PERPLEXITY_API_KEY or a Context.dev key (Settings → General)";

async function perplexityAnswer(question: string, deep: boolean) {
	const answer = await ask(question, {
		model: deep ? "sonar-pro" : "sonar",
		system:
			"You are researching for a B2B sales rep. Be specific and factual. " +
			"State only what your sources support, prefer recent information, and " +
			"say plainly when you do not know. Never speculate about a person.",
	});

	if (!answer.ok) return { ok: false as const, reason: answer.reason };

	return {
		ok: true as const,
		answer: answer.data.text,
		citations: answer.data.citations,
		note: "Only write claims that have a citation.",
	};
}

async function contextDevSources(question: string, deep: boolean) {
	const limit = deep ? CONTEXT.search.deepResults : CONTEXT.search.results;
	const found = await search(question, { limit });

	if (found.outcome === "failed") {
		return { ok: false as const, reason: found.reason };
	}

	const sources = found.results
		.filter((result) => result.url !== null)
		.slice(0, limit)
		.map((result) => ({
			url: result.url,
			title: result.title,
			description: result.description,
			excerpt: result.markdown?.slice(0, CONTEXT.search.excerptChars) ?? null,
		}));

	return {
		ok: true as const,
		sources,
		note: "These are search results, not an answer. Answer only from the excerpts, cite the URL behind every claim, and say what they do not settle. A matching name is not proof that a page is about this person.",
	};
}

export default defineTool({
	description:
		"Research a person or company on the open web for sales context — recent news, funding, launches, public statements. Returns cited claims, or search results with page text to read and cite. NOT a source of truth for someone's identity or job title; use get_linkedin_profile for that.",
	inputSchema: z.object({
		question: z
			.string()
			.describe(
				"A specific question, e.g. 'What has Acme announced in the last 6 months?'",
			),
		deep: z
			.boolean()
			.default(false)
			.describe("Reason over more sources. Slower, better for prep briefs."),
	}),
	async execute({ question, deep }, ctx) {
		return inSessionTenant(ctx, async () => {
			const perplexity = await enabled("PERPLEXITY_API_KEY");
			if (!perplexity && !(await enabled(CONTEXT_DEV_SEARCH))) {
				return unavailable(UNCONFIGURED);
			}

			const charge = spend(deep ? 2 : 1);
			if (!charge.ok) return { ok: false as const, reason: charge.reason };

			return perplexity
				? perplexityAnswer(question, deep)
				: contextDevSources(question, deep);
		});
	},
});
