import { DEFAULT_PIPELINE_STAGES } from "@crm/db/pipeline-defaults";
import { z } from "zod";
import { parse } from "./index";
import {
	type AgencyType,
	type BusinessProfile,
	type configField,
	type EngagementModel,
	parseBusinessProfile,
	parseWorkspaceConfig,
	pipelineStage,
	WORKSPACE_CONFIG_LIMITS,
	type WorkspaceConfig,
} from "./workspace-config";

export const ONBOARDING_LIMITS = {
	name: 120,
	website: 255,
	domain: 253,
	label: 120,
	description: WORKSPACE_CONFIG_LIMITS.description,
	url: 2_048,
	stageKey: 48,
	presetChoices: 3,
	profileDescriptionMin: 10,
	addedStageCeiling: 95,
} as const;

const L = ONBOARDING_LIMITS;

export const ONBOARDING_STEPS = [
	"business-type",
	"goals",
	"business",
	"customize",
	"finish",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingStep = z.enum(ONBOARDING_STEPS);

export type OnboardingStage = WorkspaceConfig["pipeline"][number];

type FieldSeed = z.input<typeof configField>;

type DashboardWidget = WorkspaceConfig["dashboard"][number];

export const GOALS = [
	{
		key: "organize",
		label: "Organize contacts and companies",
		description: "One place for every person and account.",
	},
	{
		key: "track_deals",
		label: "Track leads and close deals",
		description: "A pipeline that shows what is in play.",
	},
	{
		key: "research",
		label: "Research prospects automatically",
		description: "An agent reads the web before you reach out.",
	},
	{
		key: "follow_ups",
		label: "Automate follow-ups",
		description: "A reminder when a lead or a proposal goes quiet.",
	},
	{
		key: "team",
		label: "Manage a sales team",
		description: "Give every lead an owner and see who needs help.",
	},
] as const;

export type GoalKey = (typeof GOALS)[number]["key"];

export const goalKey = z.enum(GOALS.map((goal) => goal.key));

const AGENCY_STAGES: OnboardingStage[] = DEFAULT_PIPELINE_STAGES.map(
	(stage) => ({
		key: stage.key,
		label: stage.label,
		outcome:
			stage.outcome === "OPEN"
				? "open"
				: stage.outcome === "WON"
					? "won"
					: "lost",
		probability: stage.probability,
	}),
);

type PresetFocus = {
	stage: string;
	view: string;
	description: string;
	followUp: { label: string; afterDays: number; action: string };
};

type PresetDefinition = {
	key: string;
	label: string;
	description: string;
	stages: readonly OnboardingStage[];
	focus: PresetFocus;
	fields: readonly FieldSeed[];
};

export const PIPELINE_PRESETS = [
	{
		key: "agency_projects",
		label: "Agency projects",
		description: "From first inquiry to a signed project.",
		stages: AGENCY_STAGES,
		focus: {
			stage: "proposal_sent",
			view: "Proposals out",
			description: "Deals waiting on a proposal answer.",
			followUp: {
				label: "Proposal follow-up",
				afterDays: 5,
				action: "Suggest a follow-up when a proposal has had no answer.",
			},
		},
		fields: [
			{
				entity: "DEAL",
				key: "expected_start",
				label: "Expected Start Date",
				type: "DATE",
			},
		],
	},
	{
		key: "local_service_jobs",
		label: "Service jobs",
		description: "From a new lead to a scheduled job.",
		stages: [
			{ key: "new_lead", label: "New Lead", outcome: "open", probability: 10 },
			{
				key: "contacted",
				label: "Contacted",
				outcome: "open",
				probability: 25,
			},
			{
				key: "estimate_sent",
				label: "Estimate Sent",
				outcome: "open",
				probability: 50,
			},
			{
				key: "scheduled",
				label: "Scheduled",
				outcome: "open",
				probability: 80,
			},
			{ key: "won", label: "Won", outcome: "won", probability: 100 },
			{ key: "lost", label: "Lost", outcome: "lost", probability: 0 },
		],
		focus: {
			stage: "estimate_sent",
			view: "Estimates out",
			description: "Jobs waiting on an estimate answer.",
			followUp: {
				label: "Estimate follow-up",
				afterDays: 3,
				action: "Suggest a follow-up when an estimate has had no answer.",
			},
		},
		fields: [
			{
				entity: "DEAL",
				key: "job_date",
				label: "Job Date",
				type: "DATE",
			},
			{
				entity: "DEAL",
				key: "service_address",
				label: "Service Address",
				type: "TEXT",
			},
		],
	},
	{
		key: "consulting_engagements",
		label: "Consulting engagements",
		description: "From an inquiry to a signed engagement.",
		stages: [
			{ key: "inquiry", label: "Inquiry", outcome: "open", probability: 10 },
			{
				key: "discovery_call",
				label: "Discovery Call",
				outcome: "open",
				probability: 25,
			},
			{
				key: "proposal_sent",
				label: "Proposal Sent",
				outcome: "open",
				probability: 50,
			},
			{
				key: "contract_sent",
				label: "Contract Sent",
				outcome: "open",
				probability: 80,
			},
			{ key: "won", label: "Won", outcome: "won", probability: 100 },
			{ key: "lost", label: "Lost", outcome: "lost", probability: 0 },
		],
		focus: {
			stage: "proposal_sent",
			view: "Proposals out",
			description: "Engagements waiting on a proposal answer.",
			followUp: {
				label: "Proposal follow-up",
				afterDays: 5,
				action: "Suggest a follow-up when a proposal has had no answer.",
			},
		},
		fields: [
			{
				entity: "DEAL",
				key: "engagement_start",
				label: "Engagement Start Date",
				type: "DATE",
			},
		],
	},
	{
		key: "b2b_sales",
		label: "B2B sales",
		description: "A full sales cycle with a demo and a negotiation.",
		stages: [
			{ key: "lead", label: "Lead", outcome: "open", probability: 10 },
			{
				key: "qualified",
				label: "Qualified",
				outcome: "open",
				probability: 25,
			},
			{ key: "demo", label: "Demo", outcome: "open", probability: 40 },
			{ key: "proposal", label: "Proposal", outcome: "open", probability: 60 },
			{
				key: "negotiation",
				label: "Negotiation",
				outcome: "open",
				probability: 80,
			},
			{
				key: "closed_won",
				label: "Closed Won",
				outcome: "won",
				probability: 100,
			},
			{
				key: "closed_lost",
				label: "Closed Lost",
				outcome: "lost",
				probability: 0,
			},
		],
		focus: {
			stage: "proposal",
			view: "Proposals out",
			description: "Deals waiting on a proposal answer.",
			followUp: {
				label: "Proposal follow-up",
				afterDays: 4,
				action: "Suggest a follow-up when a proposal has had no answer.",
			},
		},
		fields: [
			{
				entity: "DEAL",
				key: "decision_maker",
				label: "Decision Maker",
				type: "TEXT",
			},
		],
	},
	{
		key: "saas_sales",
		label: "SaaS sales",
		description: "A sales cycle with a demo and a trial.",
		stages: [
			{ key: "lead", label: "Lead", outcome: "open", probability: 10 },
			{
				key: "qualified",
				label: "Qualified",
				outcome: "open",
				probability: 25,
			},
			{ key: "demo", label: "Demo", outcome: "open", probability: 40 },
			{ key: "trial", label: "Trial", outcome: "open", probability: 60 },
			{
				key: "negotiation",
				label: "Negotiation",
				outcome: "open",
				probability: 80,
			},
			{
				key: "closed_won",
				label: "Closed Won",
				outcome: "won",
				probability: 100,
			},
			{
				key: "closed_lost",
				label: "Closed Lost",
				outcome: "lost",
				probability: 0,
			},
		],
		focus: {
			stage: "trial",
			view: "In trial",
			description: "Accounts that are trying the product.",
			followUp: {
				label: "Trial follow-up",
				afterDays: 7,
				action: "Suggest a check-in when a trial has had no answer.",
			},
		},
		fields: [
			{
				entity: "DEAL",
				key: "trial_end",
				label: "Trial End Date",
				type: "DATE",
			},
			{ entity: "DEAL", key: "seats", label: "Seats", type: "NUMBER" },
		],
	},
	{
		key: "simple",
		label: "Simple pipeline",
		description: "Five stages that fit almost any business.",
		stages: [
			{ key: "new_lead", label: "New Lead", outcome: "open", probability: 10 },
			{
				key: "contacted",
				label: "Contacted",
				outcome: "open",
				probability: 30,
			},
			{ key: "proposal", label: "Proposal", outcome: "open", probability: 60 },
			{ key: "won", label: "Won", outcome: "won", probability: 100 },
			{ key: "lost", label: "Lost", outcome: "lost", probability: 0 },
		],
		focus: {
			stage: "proposal",
			view: "Proposals out",
			description: "Deals waiting on a proposal answer.",
			followUp: {
				label: "Proposal follow-up",
				afterDays: 5,
				action: "Suggest a follow-up when a proposal has had no answer.",
			},
		},
		fields: [],
	},
] as const satisfies readonly PresetDefinition[];

export type PresetKey = (typeof PIPELINE_PRESETS)[number]["key"];

export const presetKey = z.enum(PIPELINE_PRESETS.map((preset) => preset.key));

type BusinessTypeDefinition = {
	key: string;
	label: string;
	description: string;
	noun: string;
	agencyType: AgencyType;
	engagement: EngagementModel;
	services: readonly { label: string; recurring: boolean }[];
	checklist: readonly string[];
	presets: readonly PresetKey[];
	teamPresets?: readonly PresetKey[];
};

export const BUSINESS_TYPES = [
	{
		key: "agency",
		label: "Marketing / Creative Agency",
		description: "Client projects, campaigns and retainers.",
		noun: "marketing and creative agency",
		agencyType: "marketing",
		engagement: "both",
		services: [
			{ label: "Client projects", recurring: false },
			{ label: "Monthly retainer", recurring: true },
		],
		checklist: [
			"Schedule kickoff",
			"Collect brand assets",
			"Confirm scope",
			"Send first deliverable",
		],
		presets: ["agency_projects", "consulting_engagements", "simple"],
	},
	{
		key: "local_service",
		label: "Local Service Business",
		description: "Estimates, jobs and repeat customers.",
		noun: "local service business",
		agencyType: "mixed",
		engagement: "one-time",
		services: [
			{ label: "Service jobs", recurring: false },
			{ label: "Maintenance plan", recurring: true },
		],
		checklist: ["Confirm the job date", "Complete the job", "Ask for a review"],
		presets: ["local_service_jobs", "simple", "consulting_engagements"],
	},
	{
		key: "consulting",
		label: "Consulting / Professional Services",
		description: "Engagements, proposals and contracts.",
		noun: "consulting and professional services firm",
		agencyType: "mixed",
		engagement: "both",
		services: [
			{ label: "Consulting engagement", recurring: false },
			{ label: "Advisory retainer", recurring: true },
		],
		checklist: [
			"Schedule kickoff",
			"Confirm scope and goals",
			"Agree the first milestone",
		],
		presets: ["consulting_engagements", "agency_projects", "simple"],
	},
	{
		key: "b2b_sales",
		label: "B2B Sales Team",
		description: "Accounts, demos and negotiations.",
		noun: "B2B sales team",
		agencyType: "mixed",
		engagement: "both",
		services: [{ label: "Core product", recurring: false }],
		checklist: [
			"Hand over to the account owner",
			"Schedule kickoff",
			"Confirm success criteria",
		],
		presets: ["b2b_sales", "saas_sales", "simple"],
	},
	{
		key: "saas",
		label: "SaaS / Technology",
		description: "Demos, trials and subscriptions.",
		noun: "software and technology company",
		agencyType: "ai",
		engagement: "recurring",
		services: [{ label: "Subscription", recurring: true }],
		checklist: [
			"Create the customer account",
			"Schedule the first training",
			"Confirm success criteria",
		],
		presets: ["saas_sales", "b2b_sales", "simple"],
	},
	{
		key: "other",
		label: "Other",
		description: "Start simple and change it later.",
		noun: "business",
		agencyType: "mixed",
		engagement: "both",
		services: [{ label: "Products and services", recurring: false }],
		checklist: ["Welcome the customer", "Confirm what they bought"],
		presets: ["simple", "b2b_sales", "agency_projects"],
		teamPresets: ["b2b_sales", "simple", "agency_projects"],
	},
] as const satisfies readonly BusinessTypeDefinition[];

export type BusinessTypeKey = (typeof BUSINESS_TYPES)[number]["key"];

export const businessTypeKey = z.enum(BUSINESS_TYPES.map((type) => type.key));

export type OnboardingContext = {
	businessType: BusinessTypeKey;
	goals: readonly GoalKey[];
};

function businessTypeOf(key: BusinessTypeKey): BusinessTypeDefinition {
	const found = BUSINESS_TYPES.find((type) => type.key === key);
	if (!found) throw new Error(`Unknown business type "${key}".`);
	return found;
}

function presetOf(key: PresetKey): PresetDefinition {
	const found = PIPELINE_PRESETS.find((preset) => preset.key === key);
	if (!found) throw new Error(`Unknown pipeline preset "${key}".`);
	return found;
}

export function businessTypeLabel(key: BusinessTypeKey): string {
	return businessTypeOf(key).label;
}

export function goalLabel(key: GoalKey): string {
	return GOALS.find((goal) => goal.key === key)?.label ?? key;
}

export function knownGoals(values: readonly string[]): GoalKey[] {
	return GOALS.map((goal) => goal.key).filter((key) => values.includes(key));
}

export function knownBusinessType(
	value: string | null | undefined,
): BusinessTypeKey | null {
	return BUSINESS_TYPES.find((type) => type.key === value)?.key ?? null;
}

export function knownPreset(
	value: string | null | undefined,
): PresetKey | null {
	return PIPELINE_PRESETS.find((preset) => preset.key === value)?.key ?? null;
}

export function presetStages(key: PresetKey): OnboardingStage[] {
	return presetOf(key).stages.map((stage) => ({ ...stage }));
}

export function recommendedPresets(
	businessType: BusinessTypeKey,
	goals: readonly GoalKey[],
): PresetKey[] {
	const type = businessTypeOf(businessType);
	const wantsTeam = goals.includes("team") || goals.includes("track_deals");
	const order = wantsTeam && type.teamPresets ? type.teamPresets : type.presets;
	return order.slice(0, L.presetChoices);
}

export type PresetChoice = {
	key: PresetKey;
	label: string;
	description: string;
	recommended: boolean;
	stages: OnboardingStage[];
};

export function presetChoices(
	context: OnboardingContext,
	selected: PresetKey | null = null,
): PresetChoice[] {
	const recommended = recommendedPresets(context.businessType, context.goals);
	const keys =
		selected && !recommended.includes(selected)
			? [...recommended, selected]
			: recommended;

	return keys.map((key, index) => {
		const preset = presetOf(key);
		return {
			key,
			label: preset.label,
			description: preset.description,
			recommended: index === 0,
			stages: presetStages(key),
		};
	});
}

const DASHBOARD_ORDER: readonly DashboardWidget[] = [
	"leads_needing_attention",
	"open_pipeline_value",
	"proposals_to_follow_up",
	"engagements_needing_attention",
	"next_actions",
];

function serviceKey(label: string, index: number): string {
	const slug = slugKey(label);
	return slug || `service_${index + 1}`;
}

function goalFields(
	goals: readonly GoalKey[],
	serviceLabels: string[],
): FieldSeed[] {
	const fields: FieldSeed[] = [
		{
			entity: "DEAL",
			key: "interested_in",
			label: "Interested In",
			type: "SELECT",
			options: serviceLabels,
		},
	];

	if (goals.includes("organize")) {
		fields.push(
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
				entity: "COMPANY",
				key: "relationship",
				label: "Relationship",
				type: "SELECT",
				options: ["Prospect", "Customer", "Partner", "Other"],
			},
		);
	}

	if (goals.includes("track_deals")) {
		fields.push(
			{
				entity: "DEAL",
				key: "estimated_budget",
				label: "Estimated Budget",
				type: "SELECT",
				options: ["Under $5k", "$5k–$15k", "$15k–$50k", "Over $50k"],
			},
			{ entity: "DEAL", key: "next_step", label: "Next Step", type: "TEXT" },
		);
	}

	if (goals.includes("research")) {
		fields.push({
			entity: "COMPANY",
			key: "customer_fit",
			label: "Customer Fit",
			type: "SELECT",
			options: ["Strong", "Possible", "Weak", "Unknown"],
		});
	}

	return fields;
}

export function presetConfig(
	key: PresetKey,
	context: OnboardingContext,
): WorkspaceConfig {
	const preset = presetOf(key);
	const type = businessTypeOf(context.businessType);
	const goals = knownGoals(context.goals);
	const has = (goal: GoalKey) => goals.includes(goal);

	const services = type.services.map((service, index) => ({
		key: serviceKey(service.label, index),
		label: service.label,
		recurring: service.recurring,
	}));

	const widgets = new Set<DashboardWidget>([
		"open_pipeline_value",
		"next_actions",
	]);
	if (has("track_deals") || has("team")) widgets.add("leads_needing_attention");
	if (has("track_deals") || has("follow_ups")) {
		widgets.add("proposals_to_follow_up");
	}
	if (has("follow_ups")) widgets.add("engagements_needing_attention");

	return parseWorkspaceConfig({
		pipeline: presetStages(key),
		fields: [
			...goalFields(
				goals,
				services.map((service) => service.label),
			),
			...preset.fields,
		],
		views: [
			{
				entity: "DEAL",
				name: "Open pipeline",
				description: "Every deal still in play.",
				filter: { status: "open" },
			},
			...(has("track_deals")
				? [
						{
							entity: "DEAL",
							name: preset.focus.view,
							description: preset.focus.description,
							filter: { stages: [preset.focus.stage] },
						},
						{
							entity: "DEAL",
							name: "Closed deals",
							description: "Every deal that is won or lost.",
							filter: { status: "closed" },
						},
					]
				: []),
			...(has("team")
				? [
						{
							entity: "CONTACT",
							name: "Unassigned leads",
							description: "People who have no owner yet.",
							filter: { unassigned: true },
						},
						{
							entity: "COMPANY",
							name: "Unassigned companies",
							description: "Accounts that have no owner yet.",
							filter: { unassigned: true },
						},
					]
				: []),
		],
		services,
		onboardingChecklist: [...type.checklist],
		followUps: has("follow_ups")
			? [
					{
						key: "uncontacted_lead",
						label: "Uncontacted lead",
						trigger: "lead_uncontacted",
						afterDays: 1,
						action: "Remind the owner to reply to a new lead.",
					},
					{
						key: "focus_follow_up",
						label: preset.focus.followUp.label,
						trigger: "proposal_sent",
						afterDays: preset.focus.followUp.afterDays,
						action: preset.focus.followUp.action,
					},
					{
						key: "won_onboarding",
						label: "Closed-won onboarding",
						trigger: "deal_won",
						afterDays: 0,
						action: "Offer to start the customer onboarding checklist.",
					},
				]
			: [],
		dashboard: DASHBOARD_ORDER.filter((widget) => widgets.has(widget)),
	});
}

export function withPipeline(
	config: WorkspaceConfig,
	pipeline: readonly OnboardingStage[],
): WorkspaceConfig {
	const keys = new Set(pipeline.map((stage) => stage.key));

	return parseWorkspaceConfig({
		...config,
		pipeline: pipeline.map((stage) => ({ ...stage })),
		views: config.views.flatMap((view) => {
			if (view.filter.stages.length === 0) return [view];
			const stages = view.filter.stages.filter((stage) => keys.has(stage));
			if (stages.length === 0 && !view.filter.status) return [];
			return [{ ...view, filter: { ...view.filter, stages } }];
		}),
	});
}

export const onboardingPipeline = z.array(pipelineStage);

export function pipelineProblem(
	stages: readonly OnboardingStage[],
): string | null {
	const { min, max } = WORKSPACE_CONFIG_LIMITS.stages;

	if (stages.some((stage) => stage.label.trim() === "")) {
		return "Give every stage a name.";
	}
	if (
		stages.some(
			(stage) => stage.label.trim().length > WORKSPACE_CONFIG_LIMITS.label,
		)
	) {
		return `A stage name can have ${WORKSPACE_CONFIG_LIMITS.label} characters at most.`;
	}
	if (stages.length < min) return `A pipeline needs at least ${min} stages.`;
	if (stages.length > max) return `A pipeline can have ${max} stages at most.`;

	for (const outcome of ["open", "won", "lost"] as const) {
		if (!stages.some((stage) => stage.outcome === outcome)) {
			return `The pipeline needs at least one ${outcome} stage.`;
		}
	}

	if (new Set(stages.map((stage) => stage.key)).size !== stages.length) {
		return "Two stages share one key. Remove one and add it again.";
	}

	const names = stages.map((stage) => stage.label.trim().toLowerCase());
	if (new Set(names).size !== names.length) {
		return "Two stages have the same name. Give each stage its own name.";
	}

	return null;
}

export function canRemoveStage(
	stages: readonly OnboardingStage[],
	key: string,
): boolean {
	const target = stages.find((stage) => stage.key === key);
	if (!target) return false;
	if (stages.length <= WORKSPACE_CONFIG_LIMITS.stages.min) return false;
	return stages.some(
		(stage) => stage.key !== key && stage.outcome === target.outcome,
	);
}

export function canAddStage(stages: readonly OnboardingStage[]): boolean {
	return stages.length < WORKSPACE_CONFIG_LIMITS.stages.max;
}

export function removeStage(
	stages: readonly OnboardingStage[],
	key: string,
): OnboardingStage[] {
	if (!canRemoveStage(stages, key)) return [...stages];
	return stages.filter((stage) => stage.key !== key);
}

export function renameStage(
	stages: readonly OnboardingStage[],
	key: string,
	label: string,
): OnboardingStage[] {
	return stages.map((stage) =>
		stage.key === key ? { ...stage, label } : stage,
	);
}

export function reorderStages(
	stages: readonly OnboardingStage[],
	keys: readonly string[],
): OnboardingStage[] {
	const byKey = new Map(stages.map((stage) => [stage.key, stage]));
	const ordered = keys.flatMap((key) => {
		const stage = byKey.get(key);
		return stage ? [stage] : [];
	});
	return ordered.length === stages.length ? ordered : [...stages];
}

function slugKey(label: string): string {
	const slug = label
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^[_0-9]+|_+$/g, "")
		.slice(0, L.stageKey - 4)
		.replace(/_+$/g, "");
	return /^[a-z][a-z0-9_]*$/.test(slug) ? slug : "";
}

export function stageKeyFor(label: string, taken: readonly string[]): string {
	const base = slugKey(label) || "stage";
	if (!taken.includes(base)) return base;

	let suffix = 2;
	while (taken.includes(`${base}_${suffix}`)) suffix += 1;
	return `${base}_${suffix}`;
}

export function addStage(
	stages: readonly OnboardingStage[],
	label: string,
): OnboardingStage[] {
	if (!canAddStage(stages)) return [...stages];

	const lastOpen = stages.map((stage) => stage.outcome).lastIndexOf("open");
	const previous = lastOpen === -1 ? 0 : (stages[lastOpen]?.probability ?? 0);
	const added: OnboardingStage = {
		key: stageKeyFor(
			label,
			stages.map((stage) => stage.key),
		),
		label,
		outcome: "open",
		probability: Math.min(
			Math.round((previous + 100) / 2),
			L.addedStageCeiling,
		),
	};

	return [
		...stages.slice(0, lastOpen + 1),
		added,
		...stages.slice(lastOpen + 1),
	];
}

const RESERVED_TLDS: ReadonlySet<string> = new Set([
	"arpa",
	"corp",
	"example",
	"home",
	"internal",
	"intranet",
	"invalid",
	"lan",
	"local",
	"localdomain",
	"localhost",
	"onion",
	"test",
]);

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const PUBLIC_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function publicDomain(input: string | null | undefined): string | null {
	const trimmed = input?.trim().toLowerCase();
	if (!trimmed || trimmed.length > L.website) return null;

	const scheme = /^([a-z][a-z0-9+.-]*):\/\//.exec(trimmed)?.[1];
	if (scheme && scheme !== "http" && scheme !== "https") return null;

	let url: URL;
	try {
		url = new URL(scheme ? trimmed : `https://${trimmed}`);
	} catch {
		return null;
	}

	if (url.username || url.password || url.port) return null;

	const host = url.hostname.replace(/\.$/, "").replace(/^www\./, "");
	if (host.length > L.domain) return null;

	const labels = host.split(".");
	const tld = labels.at(-1) ?? "";
	if (labels.length < 2) return null;
	if (!labels.every((label) => DOMAIN_LABEL.test(label))) return null;
	if (!PUBLIC_TLD.test(tld) || RESERVED_TLDS.has(tld)) return null;

	return host;
}

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullable()
		.transform((value) => value || null);

export const onboardingDetails = z.object({
	description: optionalText(L.description),
	industry: optionalText(L.label),
	location: optionalText(L.label),
	logoUrl: z
		.url({ protocol: /^https?$/ })
		.max(L.url)
		.nullable(),
});

export type OnboardingDetails = z.infer<typeof onboardingDetails>;

export const EMPTY_ONBOARDING_DETAILS: OnboardingDetails = {
	description: null,
	industry: null,
	location: null,
	logoUrl: null,
};

export function parseOnboardingDetails(value: unknown): OnboardingDetails {
	return parse(onboardingDetails, value, "onboarding details");
}

export type OnboardingProgress = {
	businessType: string | null;
	goals: readonly string[];
	businessName: string | null;
	hasConfig: boolean;
};

export function reachableSteps(progress: OnboardingProgress): OnboardingStep[] {
	const steps: OnboardingStep[] = ["business-type"];
	if (!knownBusinessType(progress.businessType)) return steps;

	steps.push("goals");
	if (knownGoals(progress.goals).length === 0) return steps;

	steps.push("business");
	if (!progress.businessName?.trim()) return steps;

	steps.push("customize");
	if (!progress.hasConfig) return steps;

	steps.push("finish");
	return steps;
}

export function knownStep(value: string): OnboardingStep {
	return ONBOARDING_STEPS.find((step) => step === value) ?? "business-type";
}

export function resumeStep(
	stored: string,
	progress: OnboardingProgress,
): OnboardingStep {
	const reachable = reachableSteps(progress);
	const step = knownStep(stored);
	return reachable.includes(step)
		? step
		: (reachable.at(-1) ?? "business-type");
}

export function nextStep(step: OnboardingStep): OnboardingStep {
	const index = ONBOARDING_STEPS.indexOf(step);
	return ONBOARDING_STEPS[index + 1] ?? step;
}

export function previousStep(step: OnboardingStep): OnboardingStep {
	const index = ONBOARDING_STEPS.indexOf(step);
	return ONBOARDING_STEPS[index - 1] ?? step;
}

function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

function listed(items: string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function onboardingProfile(input: {
	businessName: string;
	website: string | null;
	businessType: BusinessTypeKey;
	goals: readonly GoalKey[];
	details: OnboardingDetails;
}): BusinessProfile {
	const type = businessTypeOf(input.businessType);
	const goals = knownGoals(input.goals).map((goal) =>
		lowerFirst(goalLabel(goal)),
	);
	const facts = [
		input.details.industry ? `Industry: ${input.details.industry}.` : "",
		input.details.location ? `Location: ${input.details.location}.` : "",
	].filter(Boolean);
	const summary = [
		`${input.businessName} is a ${type.noun}.`,
		goals.length > 0 ? `It uses this CRM to ${listed(goals)}.` : "",
		...facts,
	]
		.filter(Boolean)
		.join(" ");
	const written = input.details.description ?? "";

	return parseBusinessProfile({
		agencyName: input.businessName,
		website: input.website,
		agencyType: type.agencyType,
		description: (written.length >= L.profileDescriptionMin
			? written
			: summary
		).slice(0, L.description),
		services: type.services.map((service) => service.label),
		engagement: type.engagement,
	});
}
