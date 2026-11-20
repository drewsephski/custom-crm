import {
	researchFindings,
	researchMatch,
} from "@crm/validation/research-result";
import { z } from "zod";
import { CONTEXT } from "../context-config";
import { linkedinProfileUrl, linkedinSlug } from "../linkedin";
import { httpUrl } from "./urls";

export const providerPerson = z.object({
	match: z.discriminatedUnion("status", [
		z.object({ status: z.literal("not_found") }),
		z.object({
			status: z.literal("candidate"),
			score: z.number().min(0).max(100),
			person: z.object({
				social_urls: z.array(z.string()),
				current_role: z.object({ title: z.string().nullish() }).nullish(),
			}),
		}),
	]),
});

function profileSource(url: string) {
	const safe = httpUrl(url);
	if (!safe) return null;
	const host = new URL(safe).hostname;
	if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
	const slug = linkedinSlug(safe);
	return slug ? linkedinProfileUrl(slug) : null;
}

export function personEvidence({ match }: z.infer<typeof providerPerson>) {
	if (match.status === "not_found")
		return { match: researchMatch.parse({ candidates: 0 }) };
	const candidate = {
		match: researchMatch.parse({ candidates: 1, score: match.score }),
		confidence: match.score,
	};
	const sourceUrl = match.person.social_urls.map(profileSource).find(Boolean);
	if (!sourceUrl || match.score < CONTEXT.people.matchFloor) return candidate;
	const fields = [
		{ field: "linkedinUrl", label: "LinkedIn profile", value: sourceUrl },
		{
			field: "title",
			label: "Job title",
			value: match.person.current_role?.title,
		},
	];
	return {
		...candidate,
		sources: [{ url: sourceUrl, title: "Candidate profile" }],
		findings: researchFindings.parse({
			items: fields
				.filter((item) => item.value)
				.map((item) => ({ ...item, state: "suggested", sourceUrl })),
		}),
		review: "SUGGESTED" as const,
	};
}
