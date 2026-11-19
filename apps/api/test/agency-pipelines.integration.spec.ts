import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { parseStageChangeMeta } from "@crm/validation/pipeline";
import type { SavedViewFilters } from "@crm/validation/saved-view";
import {
	type BusinessProfile,
	parseWorkspaceConfig,
	templateConfig,
	type WorkspaceConfig,
} from "@crm/validation/workspace-config";
import type {
	AgentTriggerService,
	CrmEventInput,
} from "../src/agent/agent-trigger.service";
import type { AiCapabilityService } from "../src/agent/ai-capability.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { DashboardService } from "../src/dashboard/dashboard.service";
import { dealBoardInput, dealListInput } from "../src/deals/deals.contracts";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { PipelineService } from "../src/pipeline/pipeline.service";
import { SavedViewsService } from "../src/saved-views/saved-views.service";
import { WorkspaceConfigService } from "../src/workspace-config/workspace-config.service";

const suffix = `${process.env.TEST_RUN_ID ?? "pipe"}-${Date.now().toString(36)}`;
const NORTHSTAR = `pipe-${suffix}-northstar`;
const HARBOR = `pipe-${suffix}-harbor`;
const NORTHSTAR_OWNER = `pipe-${suffix}-ns-owner`;
const HARBOR_OWNER = `pipe-${suffix}-hb-owner`;

const NORTHSTAR_PROFILE: BusinessProfile = {
	agencyName: "Northstar Digital",
	website: "northstar.example",
	agencyType: "mixed",
	description:
		"We build websites and AI automations for local businesses on fixed project fees.",
	services: ["Web development", "AI automation"],
	engagement: "one-time",
};

const HARBOR_PROFILE: BusinessProfile = {
	agencyName: "Harbor Marketing",
	website: "harbor.example",
	agencyType: "marketing",
	description:
		"We run paid media and content for regional brands on monthly retainers.",
	services: ["Paid media retainer", "Content retainer"],
	engagement: "recurring",
};

function northstarConfig(): WorkspaceConfig {
	return parseWorkspaceConfig({
		...templateConfig(NORTHSTAR_PROFILE),
		pipeline: [
			{ key: "inquiry", label: "Inquiry", outcome: "open", probability: 10 },
			{
				key: "discovery",
				label: "Discovery",
				outcome: "open",
				probability: 30,
			},
			{ key: "proposal", label: "Proposal", outcome: "open", probability: 55 },
			{
				key: "negotiation",
				label: "Negotiation",
				outcome: "open",
				probability: 80,
			},
			{ key: "won", label: "Won", outcome: "won", probability: 100 },
			{ key: "lost", label: "Lost", outcome: "lost", probability: 0 },
		],
		views: [
			{
				entity: "DEAL",
				name: "Open pipeline",
				description: "Every deal still in play.",
				filter: { status: "open" },
			},
			{
				entity: "DEAL",
				name: "Proposals awaiting response",
				description: "Deals with a proposal out.",
				filter: { stages: ["proposal"] },
			},
			{
				entity: "CONTACT",
				name: "New or unassigned leads",
				description: "People nobody owns yet.",
				filter: { unassigned: true },
			},
		],
	});
}

function harborConfig(): WorkspaceConfig {
	return parseWorkspaceConfig({
		...templateConfig(HARBOR_PROFILE),
		pipeline: [
			{ key: "lead", label: "Lead", outcome: "open", probability: 5 },
			{ key: "audit", label: "Audit", outcome: "open", probability: 25 },
			{
				key: "retainer_proposal",
				label: "Retainer Proposal",
				outcome: "open",
				probability: 60,
			},
			{
				key: "active_retainer",
				label: "Active Retainer",
				outcome: "won",
				probability: 100,
			},
			{ key: "declined", label: "Declined", outcome: "lost", probability: 0 },
		],
		fields: [
			{
				entity: "DEAL",
				key: "monthly_ad_budget",
				label: "Monthly Ad Budget",
				type: "NUMBER",
			},
			{
				entity: "DEAL",
				key: "channel",
				label: "Channel",
				type: "SELECT",
				options: ["Paid search", "Paid social", "Content"],
			},
		],
		views: [
			{
				entity: "DEAL",
				name: "Open pipeline",
				description: "Every deal still in play.",
				filter: { status: "open" },
			},
			{
				entity: "DEAL",
				name: "Proposals awaiting response",
				description: "Retainer proposals with no answer.",
				filter: { stages: ["retainer_proposal"] },
			},
		],
	});
}

const emitted: CrmEventInput[] = [];

const agent = {
	withCrmEvents: (work: Parameters<AgentTriggerService["withCrmEvents"]>[0]) =>
		db.$transaction((tx) =>
			work(tx, async (input) => {
				emitted.push(input);
			}),
		),
	workspaceConfigRequested: async () => undefined,
} as unknown as AgentTriggerService;

const pipelines = new PipelineService(db);
const conversion = new ConversionService(db);
const deals = new DealsService(
	db,
	agent,
	new ActivityStampService(db),
	conversion,
	new FieldsService(db, { fieldBackfill: async () => undefined } as never),
	pipelines,
);
const dashboard = new DashboardService(db, conversion, pipelines);
const savedViews = new SavedViewsService(db);
const configs = new WorkspaceConfigService(
	db,
	agent,
	{ canGenerate: () => false } as AiCapabilityService,
	pipelines,
);

const inNorthstar = <T>(run: () => Promise<T>) => runInTenant(NORTHSTAR, run);
const inHarbor = <T>(run: () => Promise<T>) => runInTenant(HARBOR, run);

const companies = { northstar: "", harbor: "" };

async function configure(
	organizationId: string,
	ownerId: string,
	profile: BusinessProfile,
	config: WorkspaceConfig,
	stageMapping: Record<string, string> = {},
) {
	return runInTenant(organizationId, async () => {
		const [proposal] = await configs.propose(ownerId, profile);
		if (!proposal) throw new Error("No proposal.");
		await configs.edit(ownerId, proposal.id, config);
		return configs.apply(ownerId, { versionId: proposal.id, stageMapping });
	});
}

async function stagesOf(organizationId: string) {
	const pipeline = await runInTenant(organizationId, () => pipelines.active());
	const byKey = new Map(pipeline.stages.map((stage) => [stage.key, stage]));
	return {
		pipeline,
		id: (key: string) => {
			const stage = byKey.get(key);
			if (!stage) throw new Error(`No stage ${key}.`);
			return stage.id;
		},
	};
}

function listInputOf(view: SavedViewFilters) {
	return dealListInput.parse({
		q: view.q,
		sort: view.sort,
		dir: view.dir,
		archived: view.archived,
		status: view.filters.status?.[0] ?? "all",
		stage: view.filters.stage ?? [],
		owner: view.filters.owner ?? [],
		pageSize: 100,
	});
}

beforeAll(async () => {
	await runAsSystem("seed pipeline agencies", async () => {
		for (const id of [NORTHSTAR, HARBOR]) {
			await db.organization.create({
				data: { id, name: id, slug: id, createdAt: new Date() },
			});
			await db.appSetting.create({ data: { organizationId: id } });
		}
		for (const id of [NORTHSTAR_OWNER, HARBOR_OWNER]) {
			await db.user.create({
				data: { id, name: id, email: `${id}@example.test` },
			});
		}
		await db.member.createMany({
			data: [
				{
					id: `${NORTHSTAR_OWNER}-m`,
					organizationId: NORTHSTAR,
					userId: NORTHSTAR_OWNER,
					role: "owner",
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

	companies.northstar = (
		await inNorthstar(() =>
			db.company.create({
				data: { name: "Lakeside Dental" },
				select: { id: true },
			}),
		)
	).id;
	companies.harbor = (
		await inHarbor(() =>
			db.company.create({
				data: { name: "Tidewater Outfitters" },
				select: { id: true },
			}),
		)
	).id;

	await configure(
		NORTHSTAR,
		NORTHSTAR_OWNER,
		NORTHSTAR_PROFILE,
		northstarConfig(),
	);
	await configure(HARBOR, HARBOR_OWNER, HARBOR_PROFILE, harborConfig());
});

afterAll(async () => {
	await runAsSystem("remove pipeline agencies", async () => {
		await db.organization.deleteMany({
			where: { id: { in: [NORTHSTAR, HARBOR] } },
		});
		await db.user.deleteMany({
			where: { id: { in: [NORTHSTAR_OWNER, HARBOR_OWNER] } },
		});
	});
});

describe("an approved configuration becomes the agency's pipeline", () => {
	it("gives each agency the stages its owner approved, in order", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		const harbor = await stagesOf(HARBOR);

		expect(northstar.pipeline.stages.map((stage) => stage.label)).toEqual([
			"Inquiry",
			"Discovery",
			"Proposal",
			"Negotiation",
			"Won",
			"Lost",
		]);
		expect(harbor.pipeline.stages.map((stage) => stage.label)).toEqual([
			"Lead",
			"Audit",
			"Retainer Proposal",
			"Active Retainer",
			"Declined",
		]);
		expect(
			northstar.pipeline.stages.find((stage) => stage.isDefault)?.key,
		).toBe("inquiry");
		expect(harbor.pipeline.stages.find((stage) => stage.isDefault)?.key).toBe(
			"lead",
		);
		expect(
			harbor.pipeline.stages.map((stage) => [stage.key, stage.outcome]),
		).toContainEqual(["active_retainer", "WON"]);
	});

	it("keeps one agency's stages and fields out of the other", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		const harbor = await stagesOf(HARBOR);
		const northstarIds = new Set(
			northstar.pipeline.stages.map((stage) => stage.id),
		);

		expect(
			harbor.pipeline.stages.some((stage) => northstarIds.has(stage.id)),
		).toBe(false);

		const seenFromHarbor = await inHarbor(() =>
			db.pipelineStage.findMany({
				where: { id: { in: [...northstarIds] } },
				select: { id: true },
			}),
		);
		expect(seenFromHarbor).toEqual([]);

		const [harborFields, northstarFields] = await Promise.all([
			inHarbor(() => db.fieldDefinition.findMany({ select: { key: true } })),
			inNorthstar(() => db.fieldDefinition.findMany({ select: { key: true } })),
		]);
		expect(harborFields.map((field) => field.key).sort()).toEqual([
			"channel",
			"monthly_ad_budget",
		]);
		expect(northstarFields.map((field) => field.key)).not.toContain(
			"monthly_ad_budget",
		);
	});

	it("reports the pipeline as in step with the approved configuration", async () => {
		const state = await inNorthstar(() => configs.state(NORTHSTAR_OWNER));
		expect(state.pipelineInSync).toBe(true);
	});
});

describe("deals move through the agency's own stages", () => {
	const ids = { first: "", second: "", third: "", harbor: "" };

	it("starts a new deal in the agency's default stage", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		const harbor = await stagesOf(HARBOR);

		ids.first = (
			await inNorthstar(() =>
				deals.create({
					name: "Lakeside website",
					companyId: companies.northstar,
					ownerId: NORTHSTAR_OWNER,
					amountCents: 1_200_000,
					currency: "USD",
				}),
			)
		).id;
		ids.harbor = (
			await inHarbor(() =>
				deals.create({
					name: "Tidewater retainer",
					companyId: companies.harbor,
					ownerId: HARBOR_OWNER,
					amountCents: 400_000,
					currency: "USD",
				}),
			)
		).id;

		const [northstarDeal, harborDeal] = await Promise.all([
			inNorthstar(() => deals.byId(ids.first)),
			inHarbor(() => deals.byId(ids.harbor)),
		]);
		expect(northstarDeal.stage.id).toBe(northstar.id("inquiry"));
		expect(northstarDeal.stage.label).toBe("Inquiry");
		expect(harborDeal.stage.id).toBe(harbor.id("lead"));

		const rawDefault = await inNorthstar(() =>
			db.deal.create({
				data: {
					name: "Lakeside automation",
					companyId: companies.northstar,
					ownerId: NORTHSTAR_OWNER,
				},
				select: { id: true, stageId: true },
			}),
		);
		ids.second = rawDefault.id;
		expect(rawDefault.stageId).toBe(northstar.id("inquiry"));
	});

	it("shows each agency only its own board", async () => {
		const [northstarBoard, harborBoard] = await Promise.all([
			inNorthstar(() => deals.board(dealBoardInput.parse({}))),
			inHarbor(() => deals.board(dealBoardInput.parse({}))),
		]);

		const northstarDeals = northstarBoard.columns.flatMap((column) =>
			column.deals.map((deal) => deal.id),
		);
		const harborDeals = harborBoard.columns.flatMap((column) =>
			column.deals.map((deal) => deal.id),
		);

		expect(northstarDeals.sort()).toEqual([ids.first, ids.second].sort());
		expect(harborDeals).toEqual([ids.harbor]);
		expect(northstarBoard.columns.map((column) => column.stage.label)).toEqual([
			"Inquiry",
			"Discovery",
			"Proposal",
			"Negotiation",
			"Won",
			"Lost",
		]);
		expect(northstarBoard.columns[0]?.count).toBe(2);
		expect(northstarBoard.columns[0]?.valueCents).toBe(1_200_000);
	});

	it("persists a move to another stage, with its history", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		emitted.length = 0;

		const moved = await inNorthstar(() =>
			deals.setStage(
				{ id: ids.first, stageId: northstar.id("proposal") },
				NORTHSTAR_OWNER,
			),
		);
		expect(moved.changed).toBe(true);
		expect(moved.stage.key).toBe("proposal");

		const stored = await inNorthstar(() =>
			db.deal.findUniqueOrThrow({
				where: { id: ids.first },
				select: { stageId: true, closedAt: true },
			}),
		);
		expect(stored).toEqual({
			stageId: northstar.id("proposal"),
			closedAt: null,
		});

		const [activity] = await inNorthstar(() =>
			db.activity.findMany({
				where: { dealId: ids.first, type: "STAGE_CHANGE" },
				select: { meta: true },
			}),
		);
		const meta = parseStageChangeMeta(activity?.meta);
		expect(meta.from?.label).toBe("Inquiry");
		expect(meta.to.label).toBe("Proposal");
		expect(meta.to.id).toBe(northstar.id("proposal"));

		expect(emitted.map((event) => event.type)).toEqual(["deal.stage.changed"]);
		expect(emitted[0]?.data).toMatchObject({
			from: "Inquiry",
			to: "Proposal",
			toKey: "proposal",
			outcome: "OPEN",
		});
	});

	it("persists the order of deals inside a stage", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		ids.third = (
			await inNorthstar(() =>
				deals.create({
					name: "Lakeside booking flow",
					companyId: companies.northstar,
					ownerId: NORTHSTAR_OWNER,
					stageId: northstar.id("proposal"),
				}),
			)
		).id;

		const column = async () =>
			(await inNorthstar(() => deals.board(dealBoardInput.parse({})))).columns
				.find((entry) => entry.stage.key === "proposal")
				?.deals.map((deal) => deal.id);

		expect(await column()).toEqual([ids.third, ids.first]);

		const reordered = await inNorthstar(() =>
			deals.setStage(
				{
					id: ids.third,
					stageId: northstar.id("proposal"),
					placement: { afterId: ids.first, beforeId: null },
				},
				NORTHSTAR_OWNER,
			),
		);
		expect(reordered.changed).toBe(false);
		expect(await column()).toEqual([ids.first, ids.third]);

		await inNorthstar(() =>
			deals.setStage(
				{
					id: ids.second,
					stageId: northstar.id("proposal"),
					placement: { afterId: ids.first, beforeId: null },
				},
				NORTHSTAR_OWNER,
			),
		);
		expect(await column()).toEqual([ids.first, ids.second, ids.third]);

		for (let turn = 0; turn < 40; turn += 1) {
			const [moving, anchor] =
				turn % 2 === 0 ? [ids.third, ids.first] : [ids.second, ids.first];
			await inNorthstar(() =>
				deals.setStage(
					{
						id: moving,
						stageId: northstar.id("proposal"),
						placement: { afterId: anchor, beforeId: null },
					},
					NORTHSTAR_OWNER,
				),
			);
		}
		expect(await column()).toEqual([ids.first, ids.second, ids.third]);
	});

	it("keeps the won and lost lifecycle", async () => {
		const northstar = await stagesOf(NORTHSTAR);

		await expect(
			inNorthstar(() =>
				deals.setStage(
					{ id: ids.second, stageId: northstar.id("lost") },
					NORTHSTAR_OWNER,
				),
			),
		).rejects.toThrow("teaches nobody anything");

		emitted.length = 0;
		await inNorthstar(() =>
			deals.setStage(
				{
					id: ids.second,
					stageId: northstar.id("lost"),
					closedReason: "Chose an in-house build",
				},
				NORTHSTAR_OWNER,
			),
		);
		await inNorthstar(() =>
			deals.setStage(
				{ id: ids.first, stageId: northstar.id("won") },
				NORTHSTAR_OWNER,
			),
		);

		const [lost, won] = await inNorthstar(() =>
			Promise.all([
				db.deal.findUniqueOrThrow({
					where: { id: ids.second },
					select: { closedAt: true, closedReason: true },
				}),
				db.deal.findUniqueOrThrow({
					where: { id: ids.first },
					select: { closedAt: true, closedReason: true },
				}),
			]),
		);
		expect(lost.closedAt).not.toBeNull();
		expect(lost.closedReason).toBe("Chose an in-house build");
		expect(won.closedAt).not.toBeNull();
		expect(won.closedReason).toBeNull();
		expect(emitted.map((event) => event.type)).toEqual([
			"deal.stage.changed",
			"deal.closed",
			"deal.stage.changed",
			"deal.closed",
		]);

		emitted.length = 0;
		await inNorthstar(() =>
			deals.setStage(
				{ id: ids.second, stageId: northstar.id("negotiation") },
				NORTHSTAR_OWNER,
			),
		);
		const reopened = await inNorthstar(() =>
			db.deal.findUniqueOrThrow({
				where: { id: ids.second },
				select: { closedAt: true, closedReason: true },
			}),
		);
		expect(reopened).toEqual({ closedAt: null, closedReason: null });
		expect(emitted.map((event) => event.type)).toEqual([
			"deal.stage.changed",
			"deal.opened",
		]);
	});

	it("refuses a stage that belongs to another agency", async () => {
		const harbor = await stagesOf(HARBOR);
		const foreign = harbor.id("audit");

		await expect(
			inNorthstar(() =>
				deals.setStage({ id: ids.third, stageId: foreign }, NORTHSTAR_OWNER),
			),
		).rejects.toThrow("not in this workspace's pipeline");

		await expect(
			inNorthstar(() =>
				deals.create({
					name: "Borrowed stage",
					companyId: companies.northstar,
					ownerId: NORTHSTAR_OWNER,
					stageId: foreign,
				}),
			),
		).rejects.toThrow("not in this workspace's pipeline");

		await expect(
			inNorthstar(() =>
				deals.bulkSetStage(
					{ ids: [ids.third], stageId: foreign },
					NORTHSTAR_OWNER,
				),
			),
		).rejects.toThrow("not in this workspace's pipeline");

		await expect(
			inNorthstar(() =>
				db.deal.update({
					where: { id: ids.third },
					data: { stageId: foreign },
				}),
			),
		).rejects.toThrow();

		await expect(
			runAsSystem("plant a cross-tenant stage", () =>
				db.deal.update({
					where: { id: ids.third },
					data: { stageId: foreign },
				}),
			),
		).rejects.toThrow();

		const untouched = await inNorthstar(() =>
			db.deal.findUniqueOrThrow({
				where: { id: ids.third },
				select: { stage: { select: { key: true } } },
			}),
		);
		expect(untouched.stage.key).toBe("proposal");
	});

	it("reads the dashboard from stage outcomes", async () => {
		const summary = await inNorthstar(() =>
			dashboard.summary(NORTHSTAR_OWNER, { scope: "me" }),
		);

		expect(summary.pipeline.stages.map((bucket) => bucket.stage.label)).toEqual(
			["Inquiry", "Discovery", "Proposal", "Negotiation"],
		);
		expect(
			Object.fromEntries(
				summary.pipeline.stages.map((bucket) => [
					bucket.stage.key,
					bucket.count,
				]),
			),
		).toEqual({ inquiry: 0, discovery: 0, proposal: 1, negotiation: 1 });
		expect(summary.pipeline.totalDeals).toBe(2);
		expect(summary.wonThisMonth).toEqual({ count: 1, valueCents: 1_200_000 });
		expect(summary.performance.wins).toBe(1);
		expect(summary.performance.losses).toBe(0);

		const harborSummary = await inHarbor(() =>
			dashboard.summary(HARBOR_OWNER, { scope: "me" }),
		);
		expect(
			harborSummary.pipeline.stages.map((bucket) => bucket.stage.label),
		).toEqual(["Lead", "Audit", "Retainer Proposal"]);
		expect(harborSummary.wonThisMonth.count).toBe(0);
		expect(harborSummary.pipeline.totalCents).toBe(400_000);
	});

	it("filters generated saved views by outcome and by stage id", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		const views = await inNorthstar(() =>
			savedViews.list("DEAL", NORTHSTAR_OWNER),
		);
		const open = views.find((view) => view.name === "Open pipeline");
		const proposals = views.find(
			(view) => view.name === "Proposals awaiting response",
		);
		if (!open || !proposals) throw new Error("Generated views are missing.");

		expect(open.filters.filters).toEqual({ status: ["open"] });
		expect(proposals.filters.filters).toEqual({
			stage: [northstar.id("proposal")],
		});

		const [openRows, proposalRows] = await inNorthstar(() =>
			Promise.all([
				deals.list(listInputOf(open.filters)),
				deals.list(listInputOf(proposals.filters)),
			]),
		);
		expect(openRows.rows.map((row) => row.id).sort()).toEqual(
			[ids.second, ids.third].sort(),
		);
		expect(proposalRows.rows.map((row) => row.id)).toEqual([ids.third]);

		const [leads] = await inNorthstar(() =>
			savedViews.list("CONTACT", NORTHSTAR_OWNER),
		);
		expect(leads?.name).toBe("New or unassigned leads");
		expect(leads?.filters.filters).toEqual({ owner: ["unassigned"] });

		const harborViews = await inHarbor(() =>
			savedViews.list("DEAL", HARBOR_OWNER),
		);
		const harbor = await stagesOf(HARBOR);
		expect(
			harborViews.find((view) => view.name === "Proposals awaiting response")
				?.filters.filters,
		).toEqual({ stage: [harbor.id("retainer_proposal")] });
	});

	it("lets the owner change a generated view and keeps the change", async () => {
		const northstar = await stagesOf(NORTHSTAR);
		const views = await inNorthstar(() =>
			savedViews.list("DEAL", NORTHSTAR_OWNER),
		);
		const proposals = views.find(
			(view) => view.name === "Proposals awaiting response",
		);
		if (!proposals) throw new Error("Generated view is missing.");

		const widened = {
			...proposals.filters,
			filters: {
				stage: [northstar.id("proposal"), northstar.id("negotiation")],
			},
		};
		await inNorthstar(() =>
			savedViews.update(proposals.id, { filters: widened }, NORTHSTAR_OWNER),
		);

		const again = await configure(
			NORTHSTAR,
			NORTHSTAR_OWNER,
			NORTHSTAR_PROFILE,
			northstarConfig(),
		);
		expect(again.viewsCreated).toBe(0);
		expect(again.viewsUpdated).toBe(0);

		const kept = (
			await inNorthstar(() => savedViews.list("DEAL", NORTHSTAR_OWNER))
		).find((view) => view.id === proposals.id);
		expect(kept?.filters.filters.stage).toEqual([
			northstar.id("proposal"),
			northstar.id("negotiation"),
		]);
	});
});

describe("reconfiguring a pipeline that holds deals", () => {
	it("renames a stage without moving a deal", async () => {
		const before = await stagesOf(NORTHSTAR);
		const config = northstarConfig();
		const renamed = parseWorkspaceConfig({
			...config,
			pipeline: config.pipeline.map((stage) =>
				stage.key === "proposal" ? { ...stage, label: "Proposal sent" } : stage,
			),
		});

		const result = await configure(
			NORTHSTAR,
			NORTHSTAR_OWNER,
			NORTHSTAR_PROFILE,
			renamed,
		);
		expect(result.stagesUpdated).toBe(1);
		expect(result.stagesCreated).toBe(0);
		expect(result.stagesRemoved).toBe(0);
		expect(result.dealsMoved).toBe(0);

		const after = await stagesOf(NORTHSTAR);
		expect(after.id("proposal")).toBe(before.id("proposal"));
		expect(
			after.pipeline.stages.find((stage) => stage.key === "proposal")?.label,
		).toBe("Proposal sent");

		const inStage = await inNorthstar(() =>
			db.deal.count({ where: { stageId: before.id("proposal") } }),
		);
		expect(inStage).toBe(1);
	});

	it("previews a removal and refuses it without a mapping", async () => {
		const before = await stagesOf(NORTHSTAR);
		const config = northstarConfig();
		const merged = parseWorkspaceConfig({
			...config,
			pipeline: config.pipeline.filter((stage) => stage.key !== "negotiation"),
			views: config.views,
		});

		const version = await inNorthstar(async () => {
			const [proposal] = await configs.propose(
				NORTHSTAR_OWNER,
				NORTHSTAR_PROFILE,
			);
			if (!proposal) throw new Error("No proposal.");
			await configs.edit(NORTHSTAR_OWNER, proposal.id, merged);
			return proposal.id;
		});

		const plan = await inNorthstar(() => configs.pipelinePlan(version));
		expect(plan.inSync).toBe(false);
		expect(plan.removed).toEqual([
			{
				stageId: before.id("negotiation"),
				key: "negotiation",
				label: "Negotiation",
				outcome: "OPEN",
				dealCount: 1,
				targets: [
					{ key: "inquiry", label: "Inquiry" },
					{ key: "discovery", label: "Discovery" },
					{ key: "proposal", label: "Proposal" },
				],
			},
		]);

		await expect(
			inNorthstar(() =>
				configs.apply(NORTHSTAR_OWNER, {
					versionId: version,
					stageMapping: {},
				}),
			),
		).rejects.toThrow("Choose the stage they move to");

		await expect(
			inNorthstar(() =>
				configs.apply(NORTHSTAR_OWNER, {
					versionId: version,
					stageMapping: { [before.id("negotiation")]: "won" },
				}),
			),
		).rejects.toThrow("only to another open stage");

		const untouched = await stagesOf(NORTHSTAR);
		expect(untouched.pipeline.stages).toHaveLength(6);
		expect(
			untouched.pipeline.stages.find((stage) => stage.key === "proposal")
				?.label,
		).toBe("Proposal sent");

		const dealsBefore = await inNorthstar(() => db.deal.count());
		const applied = await inNorthstar(() =>
			configs.apply(NORTHSTAR_OWNER, {
				versionId: version,
				stageMapping: { [before.id("negotiation")]: "proposal" },
			}),
		);
		expect(applied.stagesRemoved).toBe(1);
		expect(applied.dealsMoved).toBe(1);
		expect(await inNorthstar(() => db.deal.count())).toBe(dealsBefore);

		const after = await stagesOf(NORTHSTAR);
		expect(after.pipeline.stages.map((stage) => stage.key)).toEqual([
			"inquiry",
			"discovery",
			"proposal",
			"won",
			"lost",
		]);

		const moved = await inNorthstar(() =>
			db.deal.findMany({
				where: { stageId: after.id("proposal") },
				select: { id: true, closedAt: true },
			}),
		);
		expect(moved).toHaveLength(2);
		expect(moved.every((deal) => deal.closedAt === null)).toBe(true);

		const history = await inNorthstar(() =>
			db.activity.findMany({
				where: { type: "STAGE_CHANGE", body: "The pipeline was reconfigured." },
				select: { meta: true },
			}),
		);
		expect(history).toHaveLength(1);
		const meta = parseStageChangeMeta(history[0]?.meta);
		expect(meta.reason).toBe("reconfigured");
		expect(meta.from?.label).toBe("Negotiation");
		expect(meta.to.key).toBe("proposal");

		const view = (
			await inNorthstar(() => savedViews.list("DEAL", NORTHSTAR_OWNER))
		).find((entry) => entry.name === "Proposals awaiting response");
		expect(view?.filters.filters.stage).toEqual([after.id("proposal")]);
	});

	it("does nothing when the same configuration is applied again", async () => {
		const state = await inNorthstar(() => configs.state(NORTHSTAR_OWNER));
		if (!state.applied) throw new Error("Nothing is applied.");
		const before = await stagesOf(NORTHSTAR);

		const again = await inNorthstar(() =>
			configs.apply(NORTHSTAR_OWNER, {
				versionId: state.applied?.id ?? "",
				stageMapping: {},
			}),
		);
		expect(again.alreadyApplied).toBe(true);
		expect(again.stagesCreated + again.stagesRemoved + again.dealsMoved).toBe(
			0,
		);

		const after = await stagesOf(NORTHSTAR);
		expect(after.pipeline.stages.map((stage) => stage.id)).toEqual(
			before.pipeline.stages.map((stage) => stage.id),
		);
	});

	it("will not turn a stage that holds won deals into an open one", async () => {
		const config = northstarConfig();
		const flipped = parseWorkspaceConfig({
			...config,
			pipeline: [
				...config.pipeline
					.filter((stage) => stage.key !== "negotiation")
					.map((stage) =>
						stage.key === "won"
							? { ...stage, outcome: "open", probability: 90 }
							: stage,
					),
				{ key: "signed", label: "Signed", outcome: "won", probability: 100 },
			],
		});

		await expect(
			configure(NORTHSTAR, NORTHSTAR_OWNER, NORTHSTAR_PROFILE, flipped),
		).rejects.toThrow("cannot become open");

		const won = await inNorthstar(() =>
			db.deal.count({ where: { stage: { outcome: "WON" } } }),
		);
		expect(won).toBe(1);
	});

	it("never leaves another agency's pipeline changed", async () => {
		const harbor = await stagesOf(HARBOR);
		expect(harbor.pipeline.stages.map((stage) => stage.key)).toEqual([
			"lead",
			"audit",
			"retainer_proposal",
			"active_retainer",
			"declined",
		]);
		const harborDeals = await inHarbor(() =>
			db.deal.findMany({ select: { stage: { select: { key: true } } } }),
		);
		expect(harborDeals).toEqual([{ stage: { key: "lead" } }]);
	});
});

describe("what the database itself refuses", () => {
	it("refuses a configuration that cannot win or lose", () => {
		const config = northstarConfig();
		expect(() =>
			parseWorkspaceConfig({
				...config,
				pipeline: config.pipeline.filter((stage) => stage.outcome !== "lost"),
			}),
		).toThrow();
	});

	it("refuses a view that names a stage outside the pipeline", () => {
		const config = northstarConfig();
		expect(() =>
			parseWorkspaceConfig({
				...config,
				views: [
					{
						entity: "DEAL",
						name: "Ghost",
						description: "",
						filter: { stages: ["contract_sent"] },
					},
				],
			}),
		).toThrow("not in the pipeline");
	});

	it("refuses to delete the only lost stage", async () => {
		const harbor = await stagesOf(HARBOR);
		await expect(
			inHarbor(() =>
				db.pipelineStage.delete({ where: { id: harbor.id("declined") } }),
			),
		).rejects.toThrow();

		const still = await stagesOf(HARBOR);
		expect(still.pipeline.stages.map((stage) => stage.key)).toContain(
			"declined",
		);
	});

	it("keeps the connection pool usable after commits are refused", async () => {
		const harbor = await stagesOf(HARBOR);
		const refusals = 12;

		for (let attempt = 0; attempt < refusals; attempt += 1) {
			await expect(
				inHarbor(() =>
					db.pipelineStage.delete({ where: { id: harbor.id("declined") } }),
				),
			).rejects.toThrow();
		}

		const count = await Promise.race([
			inHarbor(() => db.pipelineStage.count()),
			new Promise<"exhausted">((resolve) =>
				setTimeout(() => resolve("exhausted"), 3_000),
			),
		]);
		expect(count).toBe(5);
	});

	it("refuses to delete a stage that holds deals", async () => {
		const harbor = await stagesOf(HARBOR);
		await expect(
			inHarbor(() =>
				db.pipelineStage.delete({ where: { id: harbor.id("lead") } }),
			),
		).rejects.toThrow();
	});

	it("refuses a second default stage and a closed default", async () => {
		const harbor = await stagesOf(HARBOR);
		await expect(
			inHarbor(() =>
				db.pipelineStage.update({
					where: { id: harbor.id("audit") },
					data: { isDefault: true },
				}),
			),
		).rejects.toThrow();
		await expect(
			inHarbor(() =>
				db.$transaction(async (tx) => {
					await tx.pipelineStage.update({
						where: { id: harbor.id("lead") },
						data: { isDefault: false },
					});
					await tx.pipelineStage.update({
						where: { id: harbor.id("declined") },
						data: { isDefault: true },
					});
				}),
			),
		).rejects.toThrow();
	});

	it("refuses a second active pipeline for one agency", async () => {
		await expect(
			inHarbor(() =>
				db.pipeline.create({ data: { name: "Second", isActive: true } }),
			),
		).rejects.toThrow();
	});
});
