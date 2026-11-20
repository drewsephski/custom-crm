import { z } from "zod";

const hasExactlyOneRecord = (input: {
	companyId?: string;
	contactId?: string;
}) => [input.companyId, input.contactId].filter(Boolean).length === 1;

export const researchForRecordInput = z
	.object({
		companyId: z.string().min(1).optional(),
		contactId: z.string().min(1).optional(),
	})
	.refine(hasExactlyOneRecord, {
		message: "Choose exactly one company or contact.",
	});

export const RESEARCH_PROVIDERS = ["context.dev", "perplexity"] as const;

export type ResearchProvider = (typeof RESEARCH_PROVIDERS)[number];

export const RESEARCH_TASKS = [
	"brand",
	"person-enrich",
	"people-search",
	"web-search",
	"web-extract",
	"answer",
] as const;

export type ResearchTask = (typeof RESEARCH_TASKS)[number];

export const RESEARCH_RESULT_LIMITS = {
	sources: 20,
	findings: 40,
	label: 120,
	value: 4_000,
	url: 2_048,
	error: 500,
} as const;

const L = RESEARCH_RESULT_LIMITS;

export const researchSource = z.object({
	url: z.url({ protocol: /^https?$/ }).max(L.url),
	title: z.string().trim().max(L.label).nullable().default(null),
});

export type ResearchSource = z.infer<typeof researchSource>;

export const researchSources = z.array(researchSource).max(L.sources);

export const RESEARCH_FINDING_STATES = [
	"verified",
	"suggested",
	"accepted",
	"dismissed",
	"unknown",
] as const;

export type ResearchFindingState = (typeof RESEARCH_FINDING_STATES)[number];

export const researchFinding = z.object({
	field: z.string().trim().min(1).max(L.label),
	label: z.string().trim().min(1).max(L.label),
	value: z.string().trim().max(L.value).nullable(),
	state: z.enum(RESEARCH_FINDING_STATES),
	current: z.string().trim().max(L.value).nullable().default(null),
	sourceUrl: z
		.url({ protocol: /^https?$/ })
		.max(L.url)
		.nullable()
		.default(null),
});

export type ResearchFinding = z.infer<typeof researchFinding>;

export const researchFindings = z.object({
	summary: z.string().trim().max(L.value).nullable().default(null),
	items: z.array(researchFinding).max(L.findings).default([]),
});

export type ResearchFindings = z.infer<typeof researchFindings>;

export const researchMatch = z.object({
	score: z.number().min(0).max(100).nullable().default(null),
	matchedOn: z.array(z.string().trim().min(1).max(L.label)).max(10).default([]),
	candidates: z.number().int().min(0).default(0),
});

export type ResearchMatch = z.infer<typeof researchMatch>;

export function parseResearchSources(value: unknown): ResearchSource[] {
	return researchSources.parse(value);
}

export function parseResearchFindings(value: unknown): ResearchFindings {
	return researchFindings.parse(value);
}

export function parseResearchMatch(value: unknown): ResearchMatch {
	return researchMatch.parse(value);
}

export const LIVE_CHANNEL = "crm_live";

export const LIVE_TOPICS = ["company", "contact", "task", "research"] as const;

export type LiveTopic = (typeof LIVE_TOPICS)[number];

export const liveNotification = z.object({
	organizationId: z.string().min(1),
	topic: z.enum(LIVE_TOPICS),
	id: z.string().min(1),
	companyId: z.string().min(1).optional(),
	contactId: z.string().min(1).optional(),
});

export type LiveNotification = z.infer<typeof liveNotification>;

export const liveEvent = liveNotification.omit({ organizationId: true });

export type LiveEvent = z.infer<typeof liveEvent>;
