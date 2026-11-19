import { z } from "zod";
import { parse } from "./index";

export const AGENCY_TYPES = ["web", "marketing", "ai", "mixed"] as const;

export type AgencyType = (typeof AGENCY_TYPES)[number];

export const ENGAGEMENT_MODELS = ["one-time", "recurring", "both"] as const;

export type EngagementModel = (typeof ENGAGEMENT_MODELS)[number];

export const WORKSPACE_CONFIG_LIMITS = {
	stages: { min: 3, max: 12 },
	fields: { max: 20 },
	options: { max: 20 },
	views: { max: 10 },
	checklist: { max: 15 },
	followUps: { max: 10 },
	services: { max: 15 },
	label: 60,
	text: 280,
	description: 1_200,
} as const;

const L = WORKSPACE_CONFIG_LIMITS;

const label = z.string().trim().min(1).max(L.label);

const key = z
	.string()
	.trim()
	.min(1)
	.max(48)
	.regex(/^[a-z][a-z0-9_]*$/, "Keys are lower case letters, digits and _.");

export const businessProfile = z.object({
	agencyName: z.string().trim().min(1).max(120),
	website: z.string().trim().max(255).nullable(),
	agencyType: z.enum(AGENCY_TYPES),
	description: z.string().trim().min(10).max(L.description),
	services: z.array(label).min(1).max(L.services.max),
	engagement: z.enum(ENGAGEMENT_MODELS),
});

export type BusinessProfile = z.infer<typeof businessProfile>;

export const pipelineStage = z.object({
	key,
	label,
	outcome: z.enum(["open", "won", "lost"]),
	probability: z.number().int().min(0).max(100),
});

export const configField = z
	.object({
		entity: z.enum(["COMPANY", "CONTACT", "DEAL"]),
		key,
		label,
		type: z.enum(["TEXT", "LONG_TEXT", "NUMBER", "DATE", "SELECT", "URL"]),
		options: z.array(label).max(L.options.max).default([]),
	})
	.refine((field) => field.type !== "SELECT" || field.options.length > 0, {
		message: "A choice field needs at least one option.",
	});

export const configView = z.object({
	entity: z.enum(["COMPANY", "CONTACT", "DEAL"]),
	name: label,
	description: z.string().trim().max(L.text),
});

export const configService = z.object({
	key,
	label,
	recurring: z.boolean(),
});

export const configFollowUp = z.object({
	key,
	label,
	trigger: z.enum([
		"lead_uncontacted",
		"proposal_sent",
		"deal_won",
		"renewal_due",
	]),
	afterDays: z.number().int().min(0).max(365),
	action: z.string().trim().min(1).max(L.text),
});

export const workspaceConfig = z
	.object({
		pipeline: z.array(pipelineStage).min(L.stages.min).max(L.stages.max),
		fields: z.array(configField).max(L.fields.max),
		views: z.array(configView).max(L.views.max),
		services: z.array(configService).min(1).max(L.services.max),
		onboardingChecklist: z.array(label).min(1).max(L.checklist.max),
		followUps: z.array(configFollowUp).max(L.followUps.max),
		dashboard: z.array(
			z.enum([
				"leads_needing_attention",
				"open_pipeline_value",
				"proposals_to_follow_up",
				"engagements_needing_attention",
				"next_actions",
			]),
		),
	})
	.superRefine((config, ctx) => {
		const outcomes = new Set(config.pipeline.map((stage) => stage.outcome));
		for (const outcome of ["open", "won", "lost"] as const) {
			if (!outcomes.has(outcome)) {
				ctx.addIssue({
					code: "custom",
					path: ["pipeline"],
					message: `The pipeline needs at least one ${outcome} stage.`,
				});
			}
		}
		const unique = (values: string[], path: string) => {
			if (new Set(values).size !== values.length) {
				ctx.addIssue({
					code: "custom",
					path: [path],
					message: `Each ${path} key must be unique.`,
				});
			}
		};
		unique(
			config.pipeline.map((stage) => stage.key),
			"pipeline",
		);
		unique(
			config.fields.map((field) => `${field.entity}:${field.key}`),
			"fields",
		);
		unique(
			config.services.map((service) => service.key),
			"services",
		);
	});

export type WorkspaceConfig = z.infer<typeof workspaceConfig>;

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
	return parse(workspaceConfig, value, "workspace configuration");
}

export function parseBusinessProfile(value: unknown): BusinessProfile {
	return parse(businessProfile, value, "business profile");
}

const BASE_PIPELINE: WorkspaceConfig["pipeline"] = [
	{ key: "new_inquiry", label: "New Inquiry", outcome: "open", probability: 5 },
	{ key: "qualified", label: "Qualified", outcome: "open", probability: 20 },
	{ key: "discovery", label: "Discovery", outcome: "open", probability: 35 },
	{
		key: "proposal_sent",
		label: "Proposal Sent",
		outcome: "open",
		probability: 55,
	},
	{
		key: "negotiation",
		label: "Negotiation",
		outcome: "open",
		probability: 75,
	},
	{ key: "won", label: "Won", outcome: "won", probability: 100 },
	{ key: "lost", label: "Lost", outcome: "lost", probability: 0 },
];

const SERVICES = {
	web: [
		{ key: "website_build", label: "Website development", recurring: false },
		{ key: "seo", label: "SEO", recurring: true },
		{ key: "maintenance", label: "Monthly maintenance", recurring: true },
		{ key: "branding", label: "Branding", recurring: false },
	],
	marketing: [
		{ key: "paid_ads", label: "Paid advertising management", recurring: true },
		{ key: "seo", label: "SEO", recurring: true },
		{ key: "content", label: "Content marketing", recurring: true },
		{ key: "branding", label: "Branding", recurring: false },
	],
	ai: [
		{ key: "ai_automation", label: "AI automation", recurring: false },
		{ key: "consulting", label: "Consulting", recurring: false },
		{ key: "ai_support", label: "Automation support plan", recurring: true },
	],
	mixed: [
		{ key: "website_build", label: "Website development", recurring: false },
		{ key: "ai_automation", label: "AI automation", recurring: false },
		{ key: "seo", label: "SEO", recurring: true },
		{ key: "maintenance", label: "Monthly maintenance", recurring: true },
		{ key: "consulting", label: "Consulting", recurring: false },
	],
} as const satisfies Record<AgencyType, WorkspaceConfig["services"]>;

const CHECKLISTS = {
	web: [
		"Schedule kickoff",
		"Collect branding assets",
		"Confirm scope",
		"Start development",
		"Request client review",
		"Complete launch",
	],
	marketing: [
		"Schedule kickoff",
		"Get account access",
		"Agree goals and KPIs",
		"Launch first campaign",
		"Send first report",
	],
	ai: [
		"Schedule kickoff",
		"Map the current process",
		"Confirm scope",
		"Build the automation",
		"Request client review",
		"Hand over and train",
	],
	mixed: [
		"Schedule kickoff",
		"Collect branding assets",
		"Confirm scope",
		"Start development",
		"Request client review",
		"Complete launch",
	],
} as const satisfies Record<AgencyType, readonly string[]>;

export function templateConfig(profile: BusinessProfile): WorkspaceConfig {
	const services = SERVICES[profile.agencyType];
	const recurring = profile.engagement !== "one-time";
	const checklist: string[] = [...CHECKLISTS[profile.agencyType]];
	if (recurring) checklist.push("Begin ongoing support");

	return parseWorkspaceConfig({
		pipeline: BASE_PIPELINE,
		fields: [
			{
				entity: "DEAL",
				key: "service_interest",
				label: "Service Interested In",
				type: "SELECT",
				options: services.map((service) => service.label),
			},
			{
				entity: "DEAL",
				key: "estimated_budget",
				label: "Estimated Budget",
				type: "SELECT",
				options: ["Under $5k", "$5k–$15k", "$15k–$50k", "Over $50k"],
			},
			{
				entity: "CONTACT",
				key: "lead_source",
				label: "Lead Source",
				type: "SELECT",
				options: [
					"Website form",
					"Referral",
					"Email",
					"Social",
					"Event",
					"Other",
				],
			},
			{
				entity: "DEAL",
				key: "proposal_date",
				label: "Proposal Date",
				type: "DATE",
			},
			{
				entity: "DEAL",
				key: "project_value",
				label: "Project Value",
				type: "NUMBER",
			},
			{
				entity: "DEAL",
				key: "expected_start",
				label: "Expected Start Date",
				type: "DATE",
			},
			...(recurring
				? [
						{
							entity: "DEAL" as const,
							key: "monthly_retainer",
							label: "Monthly Retainer",
							type: "NUMBER" as const,
						},
					]
				: []),
		],
		views: [
			{
				entity: "DEAL",
				name: "Open pipeline",
				description: "Every deal still in play.",
			},
			{
				entity: "DEAL",
				name: "Proposals out",
				description: "Deals waiting on a proposal answer.",
			},
			{
				entity: "CONTACT",
				name: "New leads",
				description: "People who reached out and have no owner yet.",
			},
		],
		services,
		onboardingChecklist: checklist,
		followUps: [
			{
				key: "uncontacted_lead",
				label: "Uncontacted lead",
				trigger: "lead_uncontacted",
				afterDays: 1,
				action: "Remind the owner to reply to a new lead.",
			},
			{
				key: "proposal_follow_up",
				label: "Proposal follow-up",
				trigger: "proposal_sent",
				afterDays: 5,
				action: "Suggest a follow-up when a proposal has had no answer.",
			},
			{
				key: "won_onboarding",
				label: "Closed-won onboarding",
				trigger: "deal_won",
				afterDays: 0,
				action: "Offer to start the client onboarding checklist.",
			},
			...(recurring
				? [
						{
							key: "renewal_review",
							label: "Renewal review",
							trigger: "renewal_due" as const,
							afterDays: 30,
							action: "Remind the owner to review a retainer before it renews.",
						},
					]
				: []),
		],
		dashboard: [
			"leads_needing_attention",
			"open_pipeline_value",
			"proposals_to_follow_up",
			"engagements_needing_attention",
			"next_actions",
		],
	});
}
