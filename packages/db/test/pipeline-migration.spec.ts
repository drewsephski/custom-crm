import "@crm/env/load";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";

const MIGRATIONS = join(dirname(import.meta.dirname), "prisma", "migrations");
const TARGET = "20261119140000_pipelines";
const LEGACY_STAGES = [
	"DEMO_BOOKED",
	"QUALIFIED_TO_BUY",
	"UNQUALIFIED_TO_BUY",
	"DECISION_MAKER_BOUGHT_IN",
	"CONTRACT_SENT",
	"CLOSED_WON",
	"CLOSED_LOST",
] as const;

const APPROVED_PIPELINE = [
	{ key: "lead", label: "Lead", outcome: "open", probability: 10 },
	{ key: "audit", label: "Audit", outcome: "open", probability: 40 },
	{ key: "retainer", label: "Retainer", outcome: "won", probability: 100 },
	{ key: "declined", label: "Declined", outcome: "lost", probability: 0 },
];

const source = process.env.TEST_DATABASE_URL;
const database = `crm_pipeline_migration_${process.pid}_test`;

function urlFor(name: string): string {
	const url = new URL(source ?? "postgresql://localhost/postgres");
	url.pathname = `/${name}`;
	url.search = "";
	return url.toString();
}

function migrationsThrough(last: string): string[] {
	return readdirSync(MIGRATIONS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.filter((name) => name <= last);
}

function sqlOf(migration: string): string {
	return readFileSync(join(MIGRATIONS, migration, "migration.sql"), "utf8");
}

let admin: pg.Client | null = null;
let client: pg.Client | null = null;

function connection(): pg.Client {
	if (!client) throw new Error("The migration database is not connected.");
	return client;
}

async function rows<Row extends pg.QueryResultRow>(
	sql: string,
	values: unknown[] = [],
): Promise<Row[]> {
	return (await connection().query<Row>(sql, values)).rows;
}

async function seedLegacy(): Promise<void> {
	const db = connection();
	const now = new Date("2026-10-01T12:00:00.000Z");

	for (const id of ["legacy", "approved", "approved-busy", "malformed"]) {
		await db.query(
			`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, $1, $1, $2)`,
			[id, now],
		);
		await db.query(
			`INSERT INTO "company" (id, name, "organizationId", "updatedAt") VALUES ($1, $2, $3, $4)`,
			[`company-${id}`, `Company ${id}`, id, now],
		);
	}
	await db.query(
		`INSERT INTO "user" (id, name, email, "updatedAt") VALUES ('owner', 'Owner', 'owner@example.test', $1)`,
		[now],
	);

	for (const [index, stage] of LEGACY_STAGES.entries()) {
		const closed = ["CLOSED_WON", "CLOSED_LOST", "UNQUALIFIED_TO_BUY"].includes(
			stage,
		);
		await db.query(
			`INSERT INTO "deal" (id, name, "companyId", "ownerId", "organizationId", stage, amount, currency, "baseAmount", "baseCurrency", "closedAt", "closedReason", "stageChangedAt", "createdAt", "updatedAt")
			 VALUES ($1, $1, 'company-legacy', 'owner', 'legacy', $2::"DealStage", $3, 'USD', $3, 'USD', $4, $5, $6, $7, $6)`,
			[
				`deal-${stage}`,
				stage,
				(index + 1) * 1000,
				closed ? now : null,
				stage === "CLOSED_LOST" ? "Budget pulled" : null,
				now,
				new Date(now.getTime() - index * 86_400_000),
			],
		);
	}
	await db.query(
		`INSERT INTO "deal" (id, name, "companyId", "ownerId", "organizationId", "createdAt", "updatedAt")
		 VALUES ('deal-second-demo', 'Second demo', 'company-legacy', 'owner', 'legacy', $1, $1)`,
		[new Date(now.getTime() + 86_400_000)],
	);
	await db.query(
		`INSERT INTO "deal" (id, name, "companyId", "ownerId", "organizationId", stage, "updatedAt")
		 VALUES ('deal-busy', 'Busy', 'company-approved-busy', 'owner', 'approved-busy', 'CONTRACT_SENT', $1)`,
		[now],
	);

	await db.query(
		`INSERT INTO "activity" (id, type, subject, "companyId", "dealId", "createdById", "organizationId", meta, "updatedAt")
		 VALUES
		 ('change-1', 'STAGE_CHANGE', 'Stage changed', 'company-legacy', 'deal-CLOSED_WON', 'owner', 'legacy', $1, $3),
		 ('change-odd', 'STAGE_CHANGE', 'Stage changed', 'company-legacy', 'deal-CLOSED_WON', 'owner', 'legacy', $2, $3),
		 ('note-1', 'NOTE', 'A note', 'company-legacy', 'deal-CLOSED_WON', 'owner', 'legacy', NULL, $3)`,
		[
			JSON.stringify({ from: "DEMO_BOOKED", to: "CLOSED_WON" }),
			JSON.stringify({ from: "SOMETHING_ELSE", to: "CLOSED_WON" }),
			now,
		],
	);

	await db.query(
		`INSERT INTO "savedView" (id, entity, name, shared, filters, "ownerId", "organizationId", "updatedAt")
		 VALUES
		 ('view-stage', 'DEAL', 'Late stage', true, $1, 'owner', 'legacy', $3),
		 ('view-plain', 'DEAL', 'Everything', true, $2, 'owner', 'legacy', $3)`,
		[
			JSON.stringify({
				q: "",
				sort: "",
				dir: "asc",
				archived: false,
				filters: { stage: ["CONTRACT_SENT", "CLOSED_WON"], status: ["all"] },
			}),
			JSON.stringify({}),
			now,
		],
	);

	const config = (pipeline: typeof APPROVED_PIPELINE) =>
		JSON.stringify({ pipeline });
	await db.query(
		`INSERT INTO "workspaceConfigVersion" (id, version, status, source, profile, config, "organizationId", "updatedAt")
		 VALUES
		 ('cfg-old', 1, 'SUPERSEDED', 'TEMPLATE', '{}', $1, 'approved', $4),
		 ('cfg-live', 2, 'APPLIED', 'TEMPLATE', '{}', $2, 'approved', $4),
		 ('cfg-busy', 1, 'APPLIED', 'TEMPLATE', '{}', $2, 'approved-busy', $4),
		 ('cfg-bad', 1, 'APPLIED', 'TEMPLATE', '{}', $3, 'malformed', $4)`,
		[
			config([{ key: "old", label: "Old", outcome: "open", probability: 1 }]),
			config(APPROVED_PIPELINE),
			config([
				{ key: "Bad Key", label: "", outcome: "open", probability: 400 },
				{ key: "won", label: "Won", outcome: "won", probability: 100 },
				{ key: "lost", label: "Lost", outcome: "lost", probability: 0 },
			]),
			now,
		],
	);
}

const describeWithDatabase = source ? describe : describe.skip;

describeWithDatabase("the pipelines migration on a legacy database", () => {
	let before: {
		id: string;
		stage: string;
		closedAt: Date | null;
		closedReason: string | null;
		baseAmount: string | null;
		updatedAt: Date;
	}[] = [];

	beforeAll(async () => {
		admin = new pg.Client({ connectionString: urlFor("postgres") });
		await admin.connect();
		await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
		await admin.query(`CREATE DATABASE "${database}"`);

		client = new pg.Client({ connectionString: urlFor(database) });
		await client.connect();

		for (const migration of migrationsThrough(TARGET)) {
			if (migration === TARGET) continue;
			await client.query(sqlOf(migration));
		}

		await seedLegacy();
		before = await rows(
			`SELECT id, stage::text AS stage, "closedAt", "closedReason", "baseAmount"::text AS "baseAmount", "updatedAt" FROM "deal" ORDER BY id`,
		);

		await client.query("BEGIN");
		await client.query(sqlOf(TARGET));
		await client.query("COMMIT");
	}, 120_000);

	afterAll(async () => {
		await client?.end();
		await admin?.query(`DROP DATABASE IF EXISTS "${database}"`);
		await admin?.end();
	});

	it("gives a legacy organization one stage per enum value", async () => {
		const stages = await rows<{
			key: string;
			label: string;
			outcome: string;
			isDefault: boolean;
			inWinRate: boolean;
			probability: number | null;
		}>(
			`SELECT s.key, s.label, s.outcome::text AS outcome, s."isDefault", s."inWinRate", s.probability
			 FROM "pipelineStage" s WHERE s."organizationId" = 'legacy' ORDER BY s.position`,
		);

		expect(stages.map((stage) => [stage.key, stage.outcome])).toEqual([
			["demo_booked", "OPEN"],
			["qualified_to_buy", "OPEN"],
			["decision_maker_bought_in", "OPEN"],
			["contract_sent", "OPEN"],
			["closed_won", "WON"],
			["closed_lost", "LOST"],
			["unqualified_to_buy", "LOST"],
		]);
		expect(stages.filter((stage) => stage.isDefault).map((s) => s.key)).toEqual(
			["demo_booked"],
		);
		expect(
			stages.filter((stage) => !stage.inWinRate).map((stage) => stage.key),
		).toEqual(["unqualified_to_buy"]);
		expect(stages.every((stage) => stage.probability === null)).toBe(true);
	});

	it("keeps every deal in the stage it was in, and changes nothing else", async () => {
		const after = await rows<{
			id: string;
			key: string;
			closedAt: Date | null;
			closedReason: string | null;
			baseAmount: string | null;
			updatedAt: Date;
		}>(
			`SELECT d.id, s.key, d."closedAt", d."closedReason", d."baseAmount"::text AS "baseAmount", d."updatedAt"
			 FROM "deal" d JOIN "pipelineStage" s ON s.id = d."stageId" ORDER BY d.id`,
		);

		expect(after).toHaveLength(before.length);
		expect(
			after.map((deal) => ({
				id: deal.id,
				stage: deal.key.toUpperCase(),
				closedAt: deal.closedAt,
				closedReason: deal.closedReason,
				baseAmount: deal.baseAmount,
				updatedAt: deal.updatedAt,
			})),
		).toEqual(before);
	});

	it("keeps a deal inside its own organization's pipeline", async () => {
		const crossed = await rows(
			`SELECT d.id FROM "deal" d JOIN "pipelineStage" s ON s.id = d."stageId"
			 WHERE s."organizationId" <> d."organizationId"`,
		);
		expect(crossed).toEqual([]);
	});

	it("orders a stage's deals newest first", async () => {
		const demo = await rows<{ id: string }>(
			`SELECT d.id FROM "deal" d JOIN "pipelineStage" s ON s.id = d."stageId"
			 WHERE s.key = 'demo_booked' AND d."organizationId" = 'legacy'
			 ORDER BY d."boardPosition"`,
		);
		expect(demo.map((deal) => deal.id)).toEqual([
			"deal-second-demo",
			"deal-DEMO_BOOKED",
		]);
	});

	it("rewrites stage history to the stage each value became", async () => {
		const [change] = await rows<{
			meta: Record<string, { key: string; label: string; id: string }>;
		}>(`SELECT meta FROM "activity" WHERE id = 'change-1'`);
		const [won] = await rows<{ id: string }>(
			`SELECT id FROM "pipelineStage" WHERE "organizationId" = 'legacy' AND key = 'closed_won'`,
		);

		expect(change?.meta.from).toMatchObject({
			key: "demo_booked",
			label: "Demo booked",
			outcome: "OPEN",
		});
		expect(change?.meta.to).toMatchObject({
			id: won?.id,
			key: "closed_won",
			outcome: "WON",
		});
	});

	it("leaves history it cannot read, and other activities, untouched", async () => {
		const untouched = await rows<{ id: string; meta: unknown }>(
			`SELECT id, meta FROM "activity" WHERE id IN ('change-odd', 'note-1') ORDER BY id`,
		);
		expect(untouched).toEqual([
			{ id: "change-odd", meta: { from: "SOMETHING_ELSE", to: "CLOSED_WON" } },
			{ id: "note-1", meta: null },
		]);
	});

	it("points saved-view stage filters at stage ids", async () => {
		const ids = await rows<{ key: string; id: string }>(
			`SELECT key, id FROM "pipelineStage" WHERE "organizationId" = 'legacy'`,
		);
		const idOf = (key: string) => ids.find((stage) => stage.key === key)?.id;
		const views = await rows<{
			id: string;
			filters: { filters?: Record<string, string[]> };
		}>(`SELECT id, filters FROM "savedView" ORDER BY id`);

		expect(
			views.find((view) => view.id === "view-stage")?.filters.filters,
		).toEqual({
			stage: [idOf("contract_sent"), idOf("closed_won")],
			status: ["all"],
		});
		expect(views.find((view) => view.id === "view-plain")?.filters).toEqual({});
	});

	it("gives an agency with an approved configuration and no deals that pipeline", async () => {
		const stages = await rows<{
			key: string;
			label: string;
			outcome: string;
			probability: number;
			isDefault: boolean;
		}>(
			`SELECT key, label, outcome::text AS outcome, probability, "isDefault"
			 FROM "pipelineStage" WHERE "organizationId" = 'approved' ORDER BY position`,
		);

		expect(stages).toEqual([
			{
				key: "lead",
				label: "Lead",
				outcome: "OPEN",
				probability: 10,
				isDefault: true,
			},
			{
				key: "audit",
				label: "Audit",
				outcome: "OPEN",
				probability: 40,
				isDefault: false,
			},
			{
				key: "retainer",
				label: "Retainer",
				outcome: "WON",
				probability: 100,
				isDefault: false,
			},
			{
				key: "declined",
				label: "Declined",
				outcome: "LOST",
				probability: 0,
				isDefault: false,
			},
		]);
	});

	it("keeps the legacy stages where deals exist or the stored pipeline is malformed", async () => {
		const keys = await rows<{ organizationId: string; keys: string[] }>(
			`SELECT "organizationId", array_agg(key ORDER BY position) AS keys
			 FROM "pipelineStage" WHERE "organizationId" IN ('approved-busy', 'malformed')
			 GROUP BY 1 ORDER BY 1`,
		);
		const legacy = [
			"demo_booked",
			"qualified_to_buy",
			"decision_maker_bought_in",
			"contract_sent",
			"closed_won",
			"closed_lost",
			"unqualified_to_buy",
		];

		expect(keys).toEqual([
			{ organizationId: "approved-busy", keys: legacy },
			{ organizationId: "malformed", keys: legacy },
		]);

		const [busy] = await rows<{ key: string }>(
			`SELECT s.key FROM "deal" d JOIN "pipelineStage" s ON s.id = d."stageId" WHERE d.id = 'deal-busy'`,
		);
		expect(busy?.key).toBe("contract_sent");
	});

	it("leaves exactly one active pipeline per organization, and no enum", async () => {
		const pipelines = await rows<{ organizationId: string; active: string }>(
			`SELECT "organizationId", count(*) FILTER (WHERE "isActive")::text AS active
			 FROM "pipeline" GROUP BY 1 ORDER BY 1`,
		);
		expect(pipelines.map((row) => row.active)).toEqual(["1", "1", "1", "1"]);

		const enumLeft = await rows(
			`SELECT 1 FROM pg_type WHERE typname = 'DealStage'`,
		);
		expect(enumLeft).toEqual([]);
	});
});
