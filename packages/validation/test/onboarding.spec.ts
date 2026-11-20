import { describe, expect, it } from "bun:test";
import {
	addStage,
	BUSINESS_TYPES,
	type BusinessTypeKey,
	canAddStage,
	canRemoveStage,
	EMPTY_ONBOARDING_DETAILS,
	GOALS,
	type GoalKey,
	onboardingProfile,
	PIPELINE_PRESETS,
	pipelineProblem,
	presetChoices,
	presetConfig,
	presetStages,
	publicDomain,
	reachableSteps,
	recommendedPresets,
	removeStage,
	renameStage,
	reorderStages,
	resumeStep,
	stageKeyFor,
	withPipeline,
} from "../src/onboarding";
import {
	parseBusinessProfile,
	parseWorkspaceConfig,
} from "../src/workspace-config";

const TYPE_KEYS = BUSINESS_TYPES.map((type) => type.key);
const PRESET_KEYS = PIPELINE_PRESETS.map((preset) => preset.key);
const ALL_GOALS = GOALS.map((goal) => goal.key);
const GOAL_SETS: GoalKey[][] = [
	[],
	...ALL_GOALS.map((goal) => [goal]),
	ALL_GOALS,
];

describe("pipeline presets", () => {
	it("gives a valid configuration for every preset, business type and goal set", () => {
		for (const preset of PRESET_KEYS) {
			for (const businessType of TYPE_KEYS) {
				for (const goals of GOAL_SETS) {
					const config = presetConfig(preset, { businessType, goals });

					expect(parseWorkspaceConfig(config)).toEqual(config);
					expect(pipelineProblem(config.pipeline)).toBeNull();
				}
			}
		}
	});

	it("gives a valid business profile for every business type", () => {
		for (const businessType of TYPE_KEYS) {
			for (const goals of GOAL_SETS) {
				const profile = onboardingProfile({
					businessName: "Acme",
					website: null,
					businessType,
					goals,
					details: EMPTY_ONBOARDING_DETAILS,
				});

				expect(parseBusinessProfile(profile)).toEqual(profile);
			}
		}
	});

	it("keeps the stages the brief names", () => {
		expect(presetStages("local_service_jobs").map((s) => s.label)).toEqual([
			"New Lead",
			"Contacted",
			"Estimate Sent",
			"Scheduled",
			"Won",
			"Lost",
		]);
		expect(presetStages("b2b_sales").map((s) => s.label)).toEqual([
			"Lead",
			"Qualified",
			"Demo",
			"Proposal",
			"Negotiation",
			"Closed Won",
			"Closed Lost",
		]);
		expect(presetStages("saas_sales").map((s) => s.label)).toContain("Trial");
		expect(presetStages("agency_projects").map((s) => s.key)).toEqual([
			"new_inquiry",
			"qualified",
			"discovery",
			"proposal_sent",
			"negotiation",
			"won",
			"lost",
		]);
	});

	it("adds follow-up rules only for the follow-up goal", () => {
		const without = presetConfig("b2b_sales", {
			businessType: "b2b_sales",
			goals: ["track_deals"],
		});
		const withGoal = presetConfig("b2b_sales", {
			businessType: "b2b_sales",
			goals: ["follow_ups"],
		});

		expect(without.followUps).toEqual([]);
		expect(withGoal.followUps.map((rule) => rule.trigger)).toEqual([
			"lead_uncontacted",
			"proposal_sent",
			"deal_won",
		]);
	});

	it("adds an unassigned-leads view only for the team goal", () => {
		const names = (goals: GoalKey[]) =>
			presetConfig("simple", { businessType: "other", goals }).views.map(
				(view) => view.name,
			);

		expect(names(["organize"])).not.toContain("Unassigned leads");
		expect(names(["team"])).toContain("Unassigned leads");
	});
});

describe("recommendation", () => {
	it("is deterministic", () => {
		for (const businessType of TYPE_KEYS) {
			for (const goals of GOAL_SETS) {
				expect(recommendedPresets(businessType, goals)).toEqual(
					recommendedPresets(businessType, [...goals].reverse()),
				);
			}
		}
	});

	it("returns two or three known presets and no duplicate", () => {
		for (const businessType of TYPE_KEYS) {
			const keys = recommendedPresets(businessType, []);

			expect(keys.length).toBeGreaterThanOrEqual(2);
			expect(keys.length).toBeLessThanOrEqual(3);
			expect(new Set(keys).size).toBe(keys.length);
			for (const key of keys) expect(PRESET_KEYS).toContain(key);
		}
	});

	it("matches the business type", () => {
		const first = (type: BusinessTypeKey, goals: GoalKey[] = []) =>
			recommendedPresets(type, goals)[0];

		expect(first("agency")).toBe("agency_projects");
		expect(first("local_service")).toBe("local_service_jobs");
		expect(first("consulting")).toBe("consulting_engagements");
		expect(first("b2b_sales")).toBe("b2b_sales");
		expect(first("saas")).toBe("saas_sales");
		expect(first("other")).toBe("simple");
		expect(first("other", ["team"])).toBe("b2b_sales");
	});

	it("flags the first choice and keeps a selected preset visible", () => {
		const choices = presetChoices(
			{ businessType: "agency", goals: [] },
			"saas_sales",
		);

		expect(choices.map((choice) => choice.recommended)).toEqual([
			true,
			false,
			false,
			false,
		]);
		expect(choices.at(-1)?.key).toBe("saas_sales");
	});
});

describe("pipeline editing", () => {
	const stages = presetStages("simple");

	it("adds an open stage before the closed stages", () => {
		const next = addStage(stages, "Site Visit");

		expect(next.map((stage) => stage.key)).toEqual([
			"new_lead",
			"contacted",
			"proposal",
			"site_visit",
			"won",
			"lost",
		]);
		expect(next[3]?.outcome).toBe("open");
		expect(pipelineProblem(next)).toBeNull();
	});

	it("gives a new stage a key no other stage has", () => {
		expect(stageKeyFor("Proposal", ["proposal"])).toBe("proposal_2");
		expect(stageKeyFor("Proposal", ["proposal", "proposal_2"])).toBe(
			"proposal_3",
		);
		expect(stageKeyFor("!!!", [])).toBe("stage");
		expect(stageKeyFor("2nd Call", [])).toBe("nd_call");
	});

	it("keeps the key on a rename", () => {
		const next = renameStage(stages, "proposal", "Quote");

		expect(next.find((stage) => stage.key === "proposal")?.label).toBe("Quote");
	});

	it("refuses to remove the last stage of an outcome", () => {
		expect(canRemoveStage(stages, "won")).toBe(false);
		expect(canRemoveStage(stages, "lost")).toBe(false);
		expect(canRemoveStage(stages, "contacted")).toBe(true);
		expect(removeStage(stages, "won")).toEqual(stages);
		expect(removeStage(stages, "contacted")).toHaveLength(4);
	});

	it("refuses to go below three stages or above twelve", () => {
		const three = removeStage(removeStage(stages, "contacted"), "proposal");

		expect(three).toHaveLength(3);
		expect(canRemoveStage(three, "new_lead")).toBe(false);

		let many = stages;
		for (let index = 0; index < 10; index++) {
			many = addStage(many, `Extra ${index}`);
		}

		expect(many).toHaveLength(12);
		expect(canAddStage(many)).toBe(false);
	});

	it("reorders by key and ignores an incomplete order", () => {
		const keys = stages.map((stage) => stage.key).reverse();

		expect(reorderStages(stages, keys).map((stage) => stage.key)).toEqual(keys);
		expect(reorderStages(stages, ["won"])).toEqual(stages);
	});

	it("names the problem in plain words", () => {
		expect(pipelineProblem(renameStage(stages, "won", " "))).toBe(
			"Give every stage a name.",
		);
		expect(
			pipelineProblem(stages.filter((stage) => stage.outcome !== "lost")),
		).toBe("The pipeline needs at least one lost stage.");
		expect(pipelineProblem(renameStage(stages, "won", "lost"))).toBe(
			"Two stages have the same name. Give each stage its own name.",
		);
	});

	it("drops a view of a removed stage", () => {
		const config = presetConfig("simple", {
			businessType: "other",
			goals: ["track_deals"],
		});
		const edited = withPipeline(config, removeStage(stages, "proposal"));

		expect(config.views.map((view) => view.name)).toContain("Proposals out");
		expect(edited.views.map((view) => view.name)).not.toContain(
			"Proposals out",
		);
		expect(edited.pipeline.map((stage) => stage.key)).not.toContain("proposal");
	});
});

describe("publicDomain", () => {
	it("returns the bare domain", () => {
		expect(publicDomain("https://www.Acme-Plumbing.com/about?x=1")).toBe(
			"acme-plumbing.com",
		);
		expect(publicDomain("  shop.acme.co.uk ")).toBe("shop.acme.co.uk");
	});

	it("refuses addresses that are not public websites", () => {
		for (const value of [
			"",
			"localhost",
			"http://localhost:3000",
			"127.0.0.1",
			"http://2130706433",
			"10.0.0.8",
			"[::1]",
			"printer.local",
			"db.internal",
			"intranet.corp",
			"acme.test",
			"acme.example",
			"ftp://acme.com",
			"user:pass@acme.com",
			"acme.com:8080",
			"acme",
			"-acme.com",
			"not a website",
		]) {
			expect(publicDomain(value)).toBeNull();
		}
	});
});

describe("step order", () => {
	const none = {
		businessType: null,
		goals: [],
		businessName: null,
		hasConfig: false,
	};

	it("opens one step for each answer", () => {
		expect(reachableSteps(none)).toEqual(["business-type"]);
		expect(reachableSteps({ ...none, businessType: "saas" })).toEqual([
			"business-type",
			"goals",
		]);
		expect(
			reachableSteps({ ...none, businessType: "saas", goals: ["research"] }),
		).toEqual(["business-type", "goals", "business"]);
		expect(
			reachableSteps({
				businessType: "saas",
				goals: ["research"],
				businessName: "Acme",
				hasConfig: true,
			}),
		).toEqual(["business-type", "goals", "business", "customize", "finish"]);
	});

	it("ignores an answer that is not in the taxonomy", () => {
		expect(reachableSteps({ ...none, businessType: "bakery" })).toEqual([
			"business-type",
		]);
		expect(
			reachableSteps({ ...none, businessType: "saas", goals: ["fly"] }),
		).toEqual(["business-type", "goals"]);
	});

	it("resumes on the stored step, or on the last step the answers allow", () => {
		expect(resumeStep("goals", { ...none, businessType: "saas" })).toBe(
			"goals",
		);
		expect(resumeStep("finish", { ...none, businessType: "saas" })).toBe(
			"goals",
		);
		expect(resumeStep("nonsense", none)).toBe("business-type");
	});
});
