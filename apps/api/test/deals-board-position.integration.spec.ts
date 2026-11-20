import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import {
	type BusinessProfile,
	parseWorkspaceConfig,
	templateConfig,
	type WorkspaceConfig,
} from "@crm/validation/workspace-config";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import type { AiCapabilityService } from "../src/agent/ai-capability.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { dealBoardInput } from "../src/deals/deals.contracts";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { PipelineService } from "../src/pipeline/pipeline.service";
import { WorkspaceConfigService } from "../src/workspace-config/workspace-config.service";

const suffix = `${process.env.TEST_RUN_ID ?? "board"}-${Date.now().toString(36)}`;
const AGENCY = `board-${suffix}-agency`;
const OWNER = `board-${suffix}-owner`;
const CONCURRENT_MOVES = 6;

const PROFILE: BusinessProfile = {
	agencyName: "Northstar Digital",
	website: "northstar.example",
	agencyType: "mixed",
	description:
		"We build websites and AI automations for local businesses on fixed project fees.",
	services: ["Web development", "AI automation"],
	engagement: "one-time",
};

function fullConfig(): WorkspaceConfig {
	return parseWorkspaceConfig({
		...templateConfig(PROFILE),
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
		views: [],
	});
}

const agent = {
	withCrmEvents: (work: Parameters<AgentTriggerService["withCrmEvents"]>[0]) =>
		db.$transaction((tx) => work(tx, async () => undefined)),
	workspaceConfigRequested: async () => undefined,
} as unknown as AgentTriggerService;

const pipelines = new PipelineService(db);
const deals = new DealsService(
	db,
	agent,
	new ActivityStampService(db),
	new ConversionService(db),
	new FieldsService(db, { fieldBackfill: async () => undefined } as never),
	pipelines,
);
const configs = new WorkspaceConfigService(
	db,
	agent,
	{ canGenerate: () => false } as AiCapabilityService,
	pipelines,
);

const inAgency = <T>(run: () => Promise<T>) => runInTenant(AGENCY, run);

let companyId = "";

async function configure(
	config: WorkspaceConfig,
	stageMapping: Record<string, string> = {},
) {
	return inAgency(async () => {
		const [proposal] = await configs.propose(OWNER, PROFILE);
		if (!proposal) throw new Error("No proposal.");
		await configs.edit(OWNER, proposal.id, config);
		return configs.apply(OWNER, { versionId: proposal.id, stageMapping });
	});
}

async function stageId(key: string) {
	const pipeline = await inAgency(() => pipelines.active());
	const stage = pipeline.stages.find((candidate) => candidate.key === key);
	if (!stage) throw new Error(`No stage ${key}.`);
	return stage.id;
}

async function createDeal(name: string, stageKey: string) {
	const stage = await stageId(stageKey);
	return (
		await inAgency(() =>
			deals.create({
				name,
				companyId,
				ownerId: OWNER,
				stageId: stage,
			}),
		)
	).id;
}

async function columnOf(key: string) {
	const board = await inAgency(() => deals.board(dealBoardInput.parse({})));
	const column = board.columns.find((entry) => entry.stage.key === key);
	if (!column) throw new Error(`No column ${key}.`);
	return column.deals.map((deal) => deal.id);
}

async function positionsOf(key: string) {
	const stage = await stageId(key);
	const rows = await inAgency(() =>
		db.deal.findMany({
			where: { stageId: stage },
			select: { boardPosition: true },
		}),
	);
	return rows.map((row) => row.boardPosition);
}

beforeAll(async () => {
	await runAsSystem("seed the board agency", async () => {
		await db.organization.create({
			data: { id: AGENCY, name: AGENCY, slug: AGENCY, createdAt: new Date() },
		});
		await db.appSetting.create({ data: { organizationId: AGENCY } });
		await db.user.create({
			data: { id: OWNER, name: OWNER, email: `${OWNER}@example.test` },
		});
		await db.member.create({
			data: {
				id: `${OWNER}-m`,
				organizationId: AGENCY,
				userId: OWNER,
				role: "owner",
				createdAt: new Date(),
			},
		});
	});

	companyId = (
		await inAgency(() =>
			db.company.create({
				data: { name: "Lakeside Dental" },
				select: { id: true },
			}),
		)
	).id;

	await configure(fullConfig());
});

afterAll(async () => {
	await runAsSystem("remove the board agency", async () => {
		await db.organization.deleteMany({ where: { id: AGENCY } });
		await db.user.deleteMany({ where: { id: OWNER } });
	});
});

describe("two reps place deals in one stage at the same moment", () => {
	it("gives every concurrent move into a stage its own position", async () => {
		const discovery = await stageId("discovery");
		const moving: string[] = [];
		for (let index = 0; index < CONCURRENT_MOVES; index += 1) {
			moving.push(await createDeal(`Inquiry ${index}`, "inquiry"));
		}

		const moved = await inAgency(() =>
			Promise.all(
				moving.map((id) => deals.setStage({ id, stageId: discovery }, OWNER)),
			),
		);

		expect(moved.every((result) => result.changed)).toBe(true);
		const positions = await positionsOf("discovery");
		expect(positions).toHaveLength(CONCURRENT_MOVES);
		expect(new Set(positions).size).toBe(CONCURRENT_MOVES);
		expect((await columnOf("discovery")).sort()).toEqual([...moving].sort());
	});

	it("gives every concurrent new deal in a stage its own position", async () => {
		const negotiation = await stageId("negotiation");

		await inAgency(() =>
			Promise.all(
				Array.from({ length: CONCURRENT_MOVES }, (_, index) =>
					deals.create({
						name: `Negotiation ${index}`,
						companyId,
						ownerId: OWNER,
						stageId: negotiation,
					}),
				),
			),
		);

		const positions = await positionsOf("negotiation");
		expect(positions).toHaveLength(CONCURRENT_MOVES);
		expect(new Set(positions).size).toBe(CONCURRENT_MOVES);
	});

	it("keeps positions distinct when concurrent drops share one anchor", async () => {
		const discovery = await stageId("discovery");
		const column = await columnOf("discovery");
		const [anchor, ...rest] = column;
		if (!anchor) throw new Error("The discovery column is empty.");

		await inAgency(() =>
			Promise.all(
				rest.map((id) =>
					deals.setStage(
						{
							id,
							stageId: discovery,
							placement: { afterId: anchor, beforeId: null },
						},
						OWNER,
					),
				),
			),
		);

		const positions = await positionsOf("discovery");
		expect(new Set(positions).size).toBe(CONCURRENT_MOVES);
		const after = await columnOf("discovery");
		expect(after[0]).toBe(anchor);
		expect([...after].sort()).toEqual([...column].sort());
	});

	it("finishes opposite moves between two stages without a deadlock", async () => {
		const discovery = await stageId("discovery");
		const negotiation = await stageId("negotiation");
		const fromDiscovery = (await columnOf("discovery")).slice(0, 2);
		const fromNegotiation = (await columnOf("negotiation")).slice(0, 2);

		await inAgency(() =>
			Promise.all([
				...fromDiscovery.map((id) =>
					deals.setStage({ id, stageId: negotiation }, OWNER),
				),
				...fromNegotiation.map((id) =>
					deals.setStage({ id, stageId: discovery }, OWNER),
				),
			]),
		);

		const discoveryNow = await columnOf("discovery");
		const negotiationNow = await columnOf("negotiation");
		expect(discoveryNow).toEqual(expect.arrayContaining(fromNegotiation));
		expect(negotiationNow).toEqual(expect.arrayContaining(fromDiscovery));
		expect(new Set(await positionsOf("discovery")).size).toBe(
			discoveryNow.length,
		);
		expect(new Set(await positionsOf("negotiation")).size).toBe(
			negotiationNow.length,
		);
	});

	it("moves one deal twice when two reps move it at the same moment", async () => {
		const discovery = await stageId("discovery");
		const proposal = await stageId("proposal");
		const contested = await createDeal("Contested", "inquiry");

		const results = await inAgency(() =>
			Promise.all([
				deals.setStage({ id: contested, stageId: discovery }, OWNER),
				deals.setStage({ id: contested, stageId: proposal }, OWNER),
			]),
		);

		expect(results.map((result) => result.changed)).toEqual([true, true]);
		const stored = await inAgency(() =>
			db.deal.findUniqueOrThrow({
				where: { id: contested },
				select: { stageId: true },
			}),
		);
		expect([discovery, proposal]).toContain(stored.stageId);
		const history = await inAgency(() =>
			db.activity.count({
				where: { dealId: contested, type: "STAGE_CHANGE" },
			}),
		);
		expect(history).toBe(2);
	});
});

describe("a deal dropped into a lost stage", () => {
	it("lands at the placement the rep chose", async () => {
		const lost = await stageId("lost");
		const lose = (id: string, placement?: Placement) =>
			inAgency(() =>
				deals.setStage(
					{ id, stageId: lost, closedReason: "No budget", placement },
					OWNER,
				),
			);

		const first = await createDeal("Lost first", "inquiry");
		const second = await createDeal("Lost second", "inquiry");
		const third = await createDeal("Lost third", "inquiry");
		const between = await createDeal("Lost between", "inquiry");
		const last = await createDeal("Lost last", "inquiry");

		await lose(third);
		await lose(second);
		await lose(first);
		expect(await columnOf("lost")).toEqual([first, second, third]);

		await lose(between, { afterId: first, beforeId: null });
		expect(await columnOf("lost")).toEqual([first, between, second, third]);

		await lose(last, { afterId: third, beforeId: null });
		expect(await columnOf("lost")).toEqual([
			first,
			between,
			second,
			third,
			last,
		]);

		const stored = await inAgency(() =>
			db.deal.findUniqueOrThrow({
				where: { id: between },
				select: { closedReason: true, closedAt: true },
			}),
		);
		expect(stored.closedReason).toBe("No budget");
		expect(stored.closedAt).not.toBeNull();
	});

	it("lands before the card the rep dropped it on", async () => {
		const lost = await stageId("lost");
		const column = await columnOf("lost");
		const [top, target] = column;
		if (!top || !target) throw new Error("The lost column is too short.");
		const dropped = await createDeal("Lost before", "inquiry");

		await inAgency(() =>
			deals.setStage(
				{
					id: dropped,
					stageId: lost,
					closedReason: "Went with an incumbent",
					placement: { afterId: null, beforeId: target },
				},
				OWNER,
			),
		);

		expect(await columnOf("lost")).toEqual([top, dropped, ...column.slice(1)]);
	});
});

describe("merging stages that hold deals", () => {
	it("puts the moved deals after the target's deals, in their own order", async () => {
		const discovery = await stageId("discovery");
		const negotiation = await stageId("negotiation");
		await createDeal("Proposal one", "proposal");
		await createDeal("Proposal two", "proposal");

		const before = {
			proposal: await columnOf("proposal"),
			discovery: await columnOf("discovery"),
			negotiation: await columnOf("negotiation"),
		};
		expect(before.proposal.length).toBeGreaterThan(1);
		expect(before.discovery.length).toBeGreaterThan(1);
		expect(before.negotiation.length).toBeGreaterThan(1);

		const config = fullConfig();
		const merged = parseWorkspaceConfig({
			...config,
			pipeline: config.pipeline.filter(
				(stage) => stage.key !== "discovery" && stage.key !== "negotiation",
			),
		});
		const startedAt = Date.now();
		const applied = await configure(merged, {
			[discovery]: "proposal",
			[negotiation]: "proposal",
		});

		expect(applied.stagesRemoved).toBe(2);
		expect(applied.dealsMoved).toBe(
			before.discovery.length + before.negotiation.length,
		);

		const expected = [
			...before.proposal,
			...before.discovery,
			...before.negotiation,
		];
		expect(await columnOf("proposal")).toEqual(expected);

		const positions = await positionsOf("proposal");
		expect(new Set(positions).size).toBe(expected.length);

		const moved = await inAgency(() =>
			db.deal.findMany({
				where: { id: { in: [...before.discovery, ...before.negotiation] } },
				select: { updatedAt: true },
			}),
		);
		const tolerance = 60_000;
		for (const deal of moved) {
			expect(
				Math.abs(deal.updatedAt.getTime() - startedAt),
			).toBeLessThanOrEqual(tolerance);
		}
	});
});

type Placement = { afterId: string | null; beforeId: string | null };
