import { onboardingBrand } from "@crm/validation/onboarding-brand";
import { researchFindings } from "@crm/validation/research-result";
import { z } from "zod";
import { publicDomain } from "./urls";

const optional = z.string().nullish();
export const providerBrand = z.object({
	brand: z
		.object({
			domain: optional,
			title: optional,
			description: optional,
			phone: optional,
			email: optional,
			industries: z
				.object({ eic: z.array(z.object({ industry: optional })).nullish() })
				.nullish(),
			address: z
				.object({ city: optional, state_code: optional, country: optional })
				.nullish(),
			logos: z.array(z.object({ url: optional })).nullish(),
		})
		.nullish(),
});

export function brandProfile(
	response: z.infer<typeof providerBrand>,
	requested: string,
) {
	const raw = response.brand;
	const domain = publicDomain(requested);
	if (!raw || !domain || (raw.domain && publicDomain(raw.domain) !== domain))
		return null;
	return onboardingBrand.parse({
		domain,
		name: raw.title,
		description: raw.description,
		industry: raw.industries?.eic?.[0]?.industry,
		location: [raw.address?.city, raw.address?.state_code, raw.address?.country]
			.filter(Boolean)
			.join(", "),
		phone: raw.phone,
		email: raw.email,
		logoUrl: raw.logos?.[0]?.url,
		socials: [],
		sources: [`https://${domain}/`],
		retrievedAt: new Date().toISOString(),
	});
}

export function brandEvidence(
	response: z.infer<typeof providerBrand>,
	domain: string,
) {
	const brand = brandProfile(response, domain);
	if (!brand) return {};
	const fields = ["description", "industry", "email", "phone"] as const;
	const findings = researchFindings.parse({
		summary: brand.description,
		items: fields
			.filter((field) => brand[field])
			.map((field) => ({
				field,
				label: field,
				value: brand[field],
				state: "suggested",
				sourceUrl: brand.sources[0],
			})),
	});
	return {
		findings,
		sources: brand.sources.map((url) => ({ url, title: brand.name })),
		review: "SUGGESTED" as const,
	};
}

export const sourcedAnswer = z.object({
	json_content: z.object({
		positioning: z.string().nullish(),
		pricingModel: z.string().nullish(),
		targetCustomer: z.string().nullish(),
		notableCustomers: z.array(z.string()).optional(),
		recentNews: z.array(z.string()).optional(),
	}),
	sources: z.array(z.string()),
	partial: z.boolean().default(false),
});
export function answerEvidence(result: z.infer<typeof sourcedAnswer>) {
	return {
		findings: { summary: result.json_content.positioning ?? null, items: [] },
		sources: result.sources.flatMap((url) =>
			/^https?:\/\//i.test(url) ? [{ url, title: null }] : [],
		),
		partial: result.partial,
	};
}
