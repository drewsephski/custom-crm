import { z } from "zod";

export const ONBOARDING_BRAND_LIMITS = {
	name: 120,
	description: 1_200,
	label: 120,
	url: 2_048,
	socials: 8,
	sources: 5,
} as const;

const L = ONBOARDING_BRAND_LIMITS;

const text = (max: number) => z.string().trim().min(1).max(max);

const httpUrl = z
	.url({ protocol: /^https?$/ })
	.max(L.url)
	.nullable()
	.catch(null);

export const onboardingBrandSocial = z.object({
	type: text(L.label),
	url: z.url({ protocol: /^https?$/ }).max(L.url),
});

export const onboardingBrand = z.object({
	domain: text(253),
	name: text(L.name).nullable().catch(null),
	description: text(L.description).nullable().catch(null),
	industry: text(L.label).nullable().catch(null),
	location: text(L.label).nullable().catch(null),
	phone: text(L.label).nullable().catch(null),
	email: z.email().max(320).nullable().catch(null),
	logoUrl: httpUrl,
	socials: z.array(onboardingBrandSocial).max(L.socials).catch([]),
	sources: z
		.array(z.url({ protocol: /^https?$/ }).max(L.url))
		.max(L.sources)
		.catch([]),
	retrievedAt: z.iso.datetime(),
});

export type OnboardingBrand = z.infer<typeof onboardingBrand>;

export const BRAND_PREVIEW_STATUSES = [
	"ready",
	"not_found",
	"unavailable",
	"limited",
	"failed",
] as const;

export type BrandPreviewStatus = (typeof BRAND_PREVIEW_STATUSES)[number];

export const brandPreviewRequest = z.object({
	website: z.string().trim().min(1).max(255),
	userId: z.string().min(1).max(128),
});

export type BrandPreviewRequest = z.infer<typeof brandPreviewRequest>;

export const brandPreviewResponse = z.discriminatedUnion("status", [
	z.object({ status: z.literal("ready"), brand: onboardingBrand }),
	z.object({ status: z.literal("not_found") }),
	z.object({ status: z.literal("unavailable") }),
	z.object({ status: z.literal("limited") }),
	z.object({ status: z.literal("failed") }),
]);

export type BrandPreviewResponse = z.infer<typeof brandPreviewResponse>;

export function parseOnboardingBrand(value: unknown): OnboardingBrand {
	return onboardingBrand.parse(value);
}

export function parseBrandPreviewResponse(
	value: unknown,
): BrandPreviewResponse {
	return brandPreviewResponse.parse(value);
}
