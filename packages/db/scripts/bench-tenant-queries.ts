import { db } from "../src/client";
import { runAsSystem, runInTenant } from "../src/tenancy";
import { ensureTestPipeline, testStageIds } from "../src/testing";

const ORG = "bench-tenant-queries";
const OTHER = "bench-tenant-other";
const OWNER = "bench-tenant-owner";
const iterations = Number(process.env.BENCH_ITERATIONS ?? "40");
const sizes = { companies: 2_000, contacts: 10_000, deals: 4_000 };

async function seed() {
	await runAsSystem("seed the tenant query benchmark", async () => {
		const ready = await db.deal.count({ where: { organizationId: ORG } });
		if (ready === sizes.deals) return;
		await db.organization.deleteMany({ where: { id: { in: [ORG, OTHER] } } });
		for (const id of [ORG, OTHER]) {
			await db.organization.create({
				data: { id, name: id, slug: id, createdAt: new Date() },
			});
		}
		await db.user.upsert({
			where: { id: OWNER },
			create: { id: OWNER, name: OWNER, email: `${OWNER}@example.test` },
			update: {},
		});
		for (const organizationId of [ORG, OTHER]) {
			await db.member.create({
				data: {
					id: `${organizationId}-owner`,
					organizationId,
					userId: OWNER,
					role: "owner",
					createdAt: new Date(),
				},
			});
			await ensureTestPipeline(organizationId);
			const stageId = (await testStageIds(organizationId)).qualified ?? "";
			const companies = Array.from({ length: sizes.companies }, (_, i) => ({
				id: `${organizationId}-co-${i}`,
				organizationId,
				name: `Company ${i}`,
				domain: `co-${i}-${organizationId}.test`,
				ownerId: i % 3 === 0 ? OWNER : null,
			}));
			await db.company.createMany({ data: companies });
			await db.contact.createMany({
				data: Array.from({ length: sizes.contacts }, (_, i) => ({
					organizationId,
					firstName: `Person ${i}`,
					email: `p${i}@co-${i % sizes.companies}-${organizationId}.test`,
					companyId: `${organizationId}-co-${i % sizes.companies}`,
					ownerId: i % 2 === 0 ? OWNER : null,
				})),
			});
			await db.deal.createMany({
				data: Array.from({ length: sizes.deals }, (_, i) => ({
					organizationId,
					name: `Deal ${i}`,
					companyId: `${organizationId}-co-${i % sizes.companies}`,
					ownerId: OWNER,
					stageId,
					boardPosition: i,
					amount: 1_000 + i,
					lastActivityAt: new Date(Date.now() - i * 60_000),
				})),
			});
		}
	});
}

const contactsPage = () =>
	db.contact.findMany({
		where: { archivedAt: null },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: 50,
		select: {
			id: true,
			firstName: true,
			lastName: true,
			email: true,
			company: { select: { id: true, name: true } },
			owner: { select: { id: true, name: true } },
		},
	});

const dealsList = () =>
	Promise.all([
		db.deal.findMany({
			where: { archivedAt: null },
			orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
			take: 50,
			select: {
				id: true,
				name: true,
				amount: true,
				stage: { select: { id: true, label: true } },
				company: { select: { id: true, name: true } },
				owner: { select: { id: true, name: true } },
			},
		}),
		db.deal.count({ where: { archivedAt: null } }),
		db.deal.groupBy({
			by: ["ownerId"],
			where: { archivedAt: null },
			_count: { _all: true },
		}),
		db.deal.groupBy({
			by: ["stageId"],
			where: { archivedAt: null },
			_count: { _all: true },
		}),
	]);

const dealsListBatched = () =>
	db.$transaction([
		db.deal.findMany({
			where: { archivedAt: null },
			orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
			take: 50,
			select: {
				id: true,
				name: true,
				amount: true,
				stage: { select: { id: true, label: true } },
				company: { select: { id: true, name: true } },
				owner: { select: { id: true, name: true } },
			},
		}),
		db.deal.count({ where: { archivedAt: null } }),
		db.deal.groupBy({
			by: ["ownerId"],
			where: { archivedAt: null },
			orderBy: { ownerId: "asc" },
			_count: { _all: true },
		}),
		db.deal.groupBy({
			by: ["stageId"],
			where: { archivedAt: null },
			orderBy: { stageId: "asc" },
			_count: { _all: true },
		}),
	]);

const companyLookup = () =>
	db.company.findUnique({ where: { id: `${ORG}-co-7` }, select: { id: true } });

async function measure(name: string, run: () => Promise<unknown>) {
	await runInTenant(ORG, run);
	const samples: number[] = [];
	for (let i = 0; i < iterations; i += 1) {
		const started = performance.now();
		await runInTenant(ORG, run);
		samples.push(performance.now() - started);
	}
	samples.sort((left, right) => left - right);
	const at = (q: number) =>
		samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
	return {
		name,
		p50: Number(at(0.5).toFixed(1)),
		p95: Number(at(0.95).toFixed(1)),
		mean: Number(
			(samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(
				1,
			),
		),
	};
}

async function concurrent(
	name: string,
	run: () => Promise<unknown>,
	width: number,
) {
	await runInTenant(ORG, run);
	const started = performance.now();
	await Promise.all(Array.from({ length: width }, () => runInTenant(ORG, run)));
	return {
		name,
		width,
		totalMs: Number((performance.now() - started).toFixed(1)),
	};
}

await seed();
const visible = await runInTenant(ORG, () => db.deal.count());
const leaked = await runInTenant(ORG, () =>
	db.deal.count({ where: { organizationId: OTHER } }),
);
if (visible !== sizes.deals || leaked !== 0) {
	throw new Error(
		`Row-level security check failed: ${visible} visible, ${leaked} leaked.`,
	);
}

const rows = [
	await measure("findUnique by id", companyLookup),
	await measure("contacts page (50 rows, 2 joins)", contactsPage),
	await measure("deals list: 4 queries in parallel", dealsList),
	await measure("deals list: 4 queries in one transaction", dealsListBatched),
];
console.table(rows);
console.table([
	await concurrent("deals list x20 concurrent (parallel)", dealsList, 20),
	await concurrent(
		"deals list x20 concurrent (one transaction)",
		dealsListBatched,
		20,
	),
]);
console.log(JSON.stringify({ label: process.env.BENCH_LABEL ?? "run", rows }));
await db.$disconnect();
