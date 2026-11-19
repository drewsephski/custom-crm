import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import {
	type BusinessProfile,
	parseWorkspaceConfig,
	templateConfig,
} from "@crm/validation/workspace-config";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import type { AiCapabilityService } from "../src/agent/ai-capability.service";
import { PipelineService } from "../src/pipeline/pipeline.service";
import { WorkspaceConfigService } from "../src/workspace-config/workspace-config.service";

const suffix = `${process.env.TEST_RUN_ID ?? "config"}-${Date.now().toString(36)}`;
const NORTHSTAR = `config-${suffix}-northstar`;
const HARBOR = `config-${suffix}-harbor`;
const OWNER = `config-${suffix}-owner`;
const MEMBER = `config-${suffix}-member`;
const HARBOR_OWNER = `config-${suffix}-harbor-owner`;

const PROFILE: BusinessProfile = {
	agencyName: "Northstar Digital",
	website: "northstar.example",
	agencyType: "mixed",
	description:
		"We build websites and AI automations for local businesses. We charge upfront project fees and monthly maintenance plans.",
	services: ["Website development", "AI automation", "Monthly maintenance"],
	engagement: "both",
};

const requested: string[] = [];

function service(canGenerate: boolean) {
	const agent = {
		workspaceConfigRequested: async (versionId: string) => {
			requested.push(versionId);
		},
	} as unknown as AgentTriggerService;
	const ai = { canGenerate: () => canGenerate } as AiCapabilityService;
	return new WorkspaceConfigService(db, agent, ai, new PipelineService(db));
}

beforeAll(async () => {
	await runAsSystem("seed configuration workspaces", async () => {
		for (const id of [NORTHSTAR, HARBOR]) {
			await db.organization.create({
				data: { id, name: id, slug: id, createdAt: new Date() },
			});
		}
		for (const id of [OWNER, MEMBER, HARBOR_OWNER]) {
			await db.user.create({
				data: { id, name: id, email: `${id}@example.test` },
			});
		}
		await db.member.createMany({
			data: [
				{
					id: `${OWNER}-m`,
					organizationId: NORTHSTAR,
					userId: OWNER,
					role: "owner",
					createdAt: new Date(),
				},
				{
					id: `${MEMBER}-m`,
					organizationId: NORTHSTAR,
					userId: MEMBER,
					role: "member",
					createdAt: new Date(),
				},
				{
					id: `${HARBOR_OWNER}-m`,
					organizationId: HARBOR,
					userId: HARBOR_OWNER,
					role: "owner",
					createdAt: new Date(),
				},
			],
		});
	});
});

afterAll(async () => {
	await runAsSystem("remove configuration workspaces", async () => {
		await db.organization.deleteMany({
			where: { id: { in: [NORTHSTAR, HARBOR] } },
		});
		await db.user.deleteMany({
			where: { id: { in: [OWNER, MEMBER, HARBOR_OWNER] } },
		});
	});
});

describe("the agency template", () => {
	it("follows the business description", () => {
		const config = templateConfig(PROFILE);

		expect(config.pipeline.map((stage) => stage.label)).toEqual([
			"New Inquiry",
			"Qualified",
			"Discovery",
			"Proposal Sent",
			"Negotiation",
			"Won",
			"Lost",
		]);
		expect(config.fields.map((field) => field.label)).toEqual(
			expect.arrayContaining([
				"Service Interested In",
				"Estimated Budget",
				"Lead Source",
				"Proposal Date",
				"Project Value",
				"Expected Start Date",
				"Monthly Retainer",
			]),
		);
		expect(config.onboardingChecklist).toContain("Begin ongoing support");
		expect(config.followUps.map((rule) => rule.trigger)).toContain(
			"renewal_due",
		);
	});

	it("leaves out recurring work for one-time engagements", () => {
		const config = templateConfig({ ...PROFILE, engagement: "one-time" });

		expect(config.fields.map((field) => field.key)).not.toContain(
			"monthly_retainer",
		);
		expect(config.onboardingChecklist).not.toContain("Begin ongoing support");
	});

	it("refuses a pipeline that cannot close", () => {
		const config = templateConfig(PROFILE);

		expect(() =>
			parseWorkspaceConfig({
				...config,
				pipeline: config.pipeline.filter((stage) => stage.outcome === "open"),
			}),
		).toThrow();
	});
});

describe("proposing and applying a configuration", () => {
	let proposalId = "";

	it("proposes a template and leaves the live workspace alone", async () => {
		const [template] = await runInTenant(NORTHSTAR, () =>
			service(false).propose(OWNER, PROFILE),
		);
		if (!template) throw new Error("No proposal.");
		proposalId = template.id;

		expect(template.status).toBe("PROPOSED");
		expect(template.source).toBe("TEMPLATE");

		const fields = await runInTenant(NORTHSTAR, () =>
			db.fieldDefinition.count({ where: { key: "service_interest" } }),
		);
		expect(fields).toBe(0);
	});

	it("keeps the edits a person makes before approving", async () => {
		const edited = templateConfig(PROFILE);
		edited.pipeline[0] = {
			...edited.pipeline[0],
			label: "Fresh lead",
		} as (typeof edited.pipeline)[0];

		const saved = await runInTenant(NORTHSTAR, () =>
			service(false).edit(OWNER, proposalId, edited),
		);
		expect(saved.config?.pipeline[0]?.label).toBe("Fresh lead");
	});

	it("does not let a member apply it", async () => {
		await expect(
			runInTenant(NORTHSTAR, () =>
				service(false).apply(MEMBER, {
					versionId: proposalId,
					stageMapping: {},
				}),
			),
		).rejects.toThrow("Only an owner or an admin");
	});

	it("creates working fields and views when applied", async () => {
		const result = await runInTenant(NORTHSTAR, () =>
			service(false).apply(OWNER, { versionId: proposalId, stageMapping: {} }),
		);

		expect(result.alreadyApplied).toBe(false);
		expect(result.fieldsCreated).toBe(7);
		expect(result.viewsCreated).toBe(3);

		const field = await runInTenant(NORTHSTAR, () =>
			db.fieldDefinition.findFirst({
				where: { key: "service_interest", entity: "DEAL" },
				include: { options: true },
			}),
		);
		expect(field?.options.map((option) => option.label)).toContain(
			"AI automation",
		);
	});

	it("creates nothing twice when the same apply arrives again", async () => {
		const again = await runInTenant(NORTHSTAR, () =>
			service(false).apply(OWNER, { versionId: proposalId, stageMapping: {} }),
		);
		expect(again.alreadyApplied).toBe(true);

		const [fields, views] = await runInTenant(NORTHSTAR, () =>
			Promise.all([
				db.fieldDefinition.count({ where: { key: "service_interest" } }),
				db.savedView.count({ where: { name: "Open pipeline" } }),
			]),
		);
		expect(fields).toBe(1);
		expect(views).toBe(1);
	});

	it("reconfigures without deleting what is already there", async () => {
		const [next] = await runInTenant(NORTHSTAR, () =>
			service(false).propose(OWNER, { ...PROFILE, engagement: "one-time" }),
		);
		if (!next) throw new Error("No proposal.");

		const result = await runInTenant(NORTHSTAR, () =>
			service(false).apply(OWNER, { versionId: next.id, stageMapping: {} }),
		);
		expect(result.fieldsCreated).toBe(0);
		expect(result.fieldsKept).toBe(6);

		const state = await runInTenant(NORTHSTAR, () =>
			service(false).state(OWNER),
		);
		expect(state.applied?.id).toBe(next.id);

		const retainer = await runInTenant(NORTHSTAR, () =>
			db.fieldDefinition.count({ where: { key: "monthly_retainer" } }),
		);
		expect(retainer).toBe(1);
	});

	it("asks the agent for an AI proposal only when a model can be reached", async () => {
		requested.length = 0;
		const versions = await runInTenant(NORTHSTAR, () =>
			service(true).propose(OWNER, PROFILE),
		);

		const generating = versions.find((version) => version.source === "AI");
		expect(generating?.status).toBe("GENERATING");
		expect(requested).toEqual([generating?.id ?? "missing"]);
	});

	it("keeps another agency's proposals out of reach", async () => {
		const state = await runInTenant(HARBOR, () =>
			service(false).state(HARBOR_OWNER),
		);
		expect(state.applied).toBeNull();
		expect(state.proposals).toEqual([]);

		await expect(
			runInTenant(HARBOR, () =>
				service(false).apply(HARBOR_OWNER, {
					versionId: proposalId,
					stageMapping: {},
				}),
			),
		).rejects.toThrow("does not exist");
	});
});
