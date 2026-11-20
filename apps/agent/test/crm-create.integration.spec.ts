import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { ensureTestMember, ensureTestOrganization } from "@crm/db/testing";
import { fieldBackfillPayload } from "@crm/validation/field-backfill";
import {
	addToCrm,
	type CrmAddition,
	crmAddition,
} from "../agent/lib/crm-create";

const suffix = Date.now().toString(36);
const NORTHSTAR = {
	id: `crm-add-north-${suffix}`,
	name: "Northstar",
	slug: `crm-add-north-${suffix}`,
};
const HARBOR = {
	id: `crm-add-harbor-${suffix}`,
	name: "Harbor",
	slug: `crm-add-harbor-${suffix}`,
};
const OWNER = `crm-add-owner-${suffix}`;
const STRANGER = `crm-add-stranger-${suffix}`;

const sam = crmAddition.parse({
	person: {
		firstName: "Sam",
		lastName: "Stehno",
		title: "OEDP Production Engineer",
		linkedinUrl: "https://www.linkedin.com/in/Sam-Stehno/",
	},
	company: { name: "Oxy", domain: "https://www.oxy.com/about" },
});

let dispatches = 0;

function add(
	organization: { id: string },
	addition: CrmAddition,
	ownerId: string = OWNER,
) {
	return runInTenant(organization.id, () =>
		addToCrm(addition, ownerId, () => {
			dispatches += 1;
		}),
	);
}

function person(firstName: string, linkedinUrl: string) {
	return crmAddition.parse({ person: { firstName, linkedinUrl } });
}

async function seedContact(firstName: string, linkedinUrl: string) {
	const row = await runInTenant(NORTHSTAR.id, () =>
		db.contact.create({
			data: { firstName, linkedinUrl, ownerId: OWNER },
			select: { id: true },
		}),
	);
	return row.id;
}

function tasksFor(
	organization: { id: string },
	result: Awaited<ReturnType<typeof add>>,
) {
	return runInTenant(organization.id, () =>
		db.agentTask.findMany({
			where: {
				OR: [
					{ contactId: result.contact?.id ?? "" },
					{ companyId: result.company?.id ?? "" },
				],
			},
			select: {
				kind: true,
				reason: true,
				priority: true,
				budget: true,
				payload: true,
				contactId: true,
				companyId: true,
			},
		}),
	);
}

beforeAll(async () => {
	await runAsSystem("seed the add-to-CRM spec", async () => {
		for (const id of [OWNER, STRANGER]) {
			await db.user.create({
				data: { id, name: id, email: `${id}@example.test` },
			});
		}
	});
	for (const organization of [NORTHSTAR, HARBOR]) {
		await ensureTestOrganization(organization);
		await ensureTestMember(OWNER, organization.id);
	}
	await runInTenant(NORTHSTAR.id, () =>
		db.fieldDefinition.createMany({
			data: [
				{
					entity: "COMPANY",
					key: "segment",
					label: "Segment",
					type: "TEXT",
					position: 0,
				},
				{
					entity: "COMPANY",
					key: "typed_by_a_rep",
					label: "Typed by a rep",
					type: "TEXT",
					agentFilled: false,
					position: 1,
				},
				{
					entity: "CONTACT",
					key: "seniority",
					label: "Seniority",
					type: "TEXT",
					position: 0,
				},
				{
					entity: "CONTACT",
					key: "retired",
					label: "Retired",
					type: "TEXT",
					archivedAt: new Date(),
					position: 1,
				},
				{
					entity: "DEAL",
					key: "deal_only",
					label: "Deal only",
					type: "TEXT",
					position: 0,
				},
			],
		}),
	);
});

afterAll(async () => {
	await runAsSystem("clean the add-to-CRM spec", async () => {
		await db.organization.deleteMany({
			where: { id: { in: [NORTHSTAR.id, HARBOR.id] } },
		});
		await db.user.deleteMany({ where: { id: { in: [OWNER, STRANGER] } } });
	});
});

describe("adding a researched person from chat", () => {
	it("normalises the LinkedIn URL and the company domain", () => {
		expect(sam.person?.linkedinUrl).toBe(
			"https://www.linkedin.com/in/sam-stehno",
		);
		expect(sam.company?.domain).toBe("oxy.com");
	});

	it("reads one profile address from every way a URL is written", () => {
		for (const written of [
			"linkedin.com/in/Sam-Stehno/?trk=x",
			"http://LinkedIn.com/in/sam-stehno",
			"https://uk.linkedin.com/in/Sam-Stehno#experience",
			"https://www.linkedin.com/in/sam%2Dstehno/",
		]) {
			expect(person("Sam", written).person?.linkedinUrl).toBe(
				"https://www.linkedin.com/in/sam-stehno",
			);
		}
		expect(
			crmAddition.safeParse({
				person: {
					firstName: "Sam",
					linkedinUrl: "https://notlinkedin.com/in/sam-stehno",
				},
			}).success,
		).toBe(false);
	});

	it("creates the company and the contact, owned by the user, and queues their research", async () => {
		const before = dispatches;
		const result = await add(NORTHSTAR, sam);

		expect(result.company?.created).toBe(true);
		expect(result.contact).toMatchObject({ name: "Sam Stehno", created: true });
		expect(dispatches).toBe(before + 1);

		const [contact, company, tasks] = await Promise.all([
			runInTenant(NORTHSTAR.id, () =>
				db.contact.findUniqueOrThrow({
					where: { id: result.contact?.id ?? "" },
					select: {
						ownerId: true,
						companyId: true,
						title: true,
						linkedinUrl: true,
					},
				}),
			),
			runInTenant(NORTHSTAR.id, () =>
				db.company.findUniqueOrThrow({
					where: { id: result.company?.id ?? "" },
					select: { domain: true, website: true, ownerId: true },
				}),
			),
			tasksFor(NORTHSTAR, result),
		]);
		expect(contact).toEqual({
			ownerId: OWNER,
			companyId: result.company?.id ?? null,
			title: "OEDP Production Engineer",
			linkedinUrl: "https://www.linkedin.com/in/sam-stehno",
		});
		expect(company).toEqual({
			domain: "oxy.com",
			website: "https://oxy.com",
			ownerId: OWNER,
		});
		expect(tasks.map((task) => `${task.kind}:${task.reason}`).sort()).toEqual([
			"agent-event:company.created",
			"agent-event:contact.created",
			"brand:Added from a CRM chat",
			"company-profile:Added from a CRM chat",
			"field-backfill:Added from a CRM chat",
			"field-backfill:Added from a CRM chat",
			"identify:Added from a CRM chat",
		]);
	});

	it("queues a custom-field backfill for each new record, with only the agent-filled keys", async () => {
		const result = await add(
			NORTHSTAR,
			crmAddition.parse({
				person: { firstName: "Field", lastName: "Backfill" },
				company: { name: `Field Backfill Co ${suffix}` },
			}),
		);

		const backfills = (await tasksFor(NORTHSTAR, result)).filter(
			(task) => task.kind === "field-backfill",
		);

		expect(
			backfills
				.map((task) => ({
					contactId: task.contactId,
					companyId: task.companyId,
					priority: task.priority,
					budget: task.budget,
					payload: fieldBackfillPayload.parse(task.payload),
				}))
				.sort((left, right) =>
					left.payload.entity.localeCompare(right.payload.entity),
				),
		).toEqual([
			{
				contactId: null,
				companyId: result.company?.id ?? null,
				priority: PRIORITY.fieldBackfill,
				budget: 8,
				payload: { entity: "COMPANY", keys: ["segment"] },
			},
			{
				contactId: result.contact?.id ?? null,
				companyId: null,
				priority: PRIORITY.fieldBackfill,
				budget: 8,
				payload: { entity: "CONTACT", keys: ["seniority"] },
			},
		]);
	});

	it("links to the records already there instead of adding them twice", async () => {
		const before = dispatches;
		const first = await add(NORTHSTAR, sam);

		expect(first.company?.created).toBe(false);
		expect(first.contact?.created).toBe(false);
		expect(dispatches).toBe(before);
		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.contact.count({
					where: { linkedinUrl: "https://www.linkedin.com/in/sam-stehno" },
				}),
			),
		).toBe(1);
		expect(
			(await tasksFor(NORTHSTAR, first)).filter(
				(task) => task.kind === "identify",
			),
		).toHaveLength(1);
	});

	it("finds a contact whose stored LinkedIn URL was typed by a rep", async () => {
		const stored = {
			dana: await seedContact("Dana", "linkedin.com/in/Dana-Okafor/?trk=x"),
			jorn: await seedContact(
				"Jørn",
				"https://uk.linkedin.com/in/J%C3%B8rn-Aas/",
			),
			priya: await seedContact("Priya", "http://LinkedIn.com/in/Priya-Raman"),
			wei: await seedContact(
				"Wei",
				"https://www.linkedin.com/in/wei-%E9%99%88/",
			),
		};

		const asked = {
			dana: "https://www.linkedin.com/in/dana-okafor",
			jorn: "https://www.linkedin.com/in/jørn-aas",
			priya: "https://www.linkedin.com/in/PRIYA-RAMAN/",
			wei: "https://cn.linkedin.com/in/wei-陈?originalSubdomain=cn",
		};

		for (const name of ["dana", "jorn", "priya", "wei"] as const) {
			const result = await add(NORTHSTAR, person(name, asked[name]));

			expect(result.contact).toMatchObject({
				id: stored[name],
				created: false,
			});
		}

		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.contact.count({
					where: { id: { in: Object.values(stored) } },
				}),
			),
		).toBe(4);
		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.contact.count({
					where: { firstName: { in: ["dana", "jorn", "priya", "wei"] } },
				}),
			),
		).toBe(0);
	});

	it("does not take a longer profile address for the same person", async () => {
		const longer = await seedContact(
			"Dana Two",
			"https://www.linkedin.com/in/dana-okafor-2",
		);

		const same = await add(
			NORTHSTAR,
			person("Dana Two", "linkedin.com/in/dana-okafor-2/"),
		);
		const other = await add(
			NORTHSTAR,
			person("Dana Three", "https://www.linkedin.com/in/dana-okafor-3"),
		);

		expect(same.contact).toMatchObject({ id: longer, created: false });
		expect(other.contact?.created).toBe(true);
	});

	it("does not treat another workspace's record as a duplicate", async () => {
		const result = await add(HARBOR, sam);

		expect(result.company?.created).toBe(true);
		expect(result.contact?.created).toBe(true);
		expect(
			(await tasksFor(HARBOR, result)).map((task) => task.kind).sort(),
		).toEqual([
			"agent-event",
			"agent-event",
			"brand",
			"company-profile",
			"identify",
		]);
	});

	it("keeps the record when the dispatch request fails", async () => {
		const name = `Dispatch Down Co ${suffix}`;

		const result = await runInTenant(NORTHSTAR.id, () =>
			addToCrm(crmAddition.parse({ company: { name } }), OWNER, () => {
				throw new Error("The agent is not reachable.");
			}),
		);

		expect(result.company?.created).toBe(true);
		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.company.count({ where: { name } }),
			),
		).toBe(1);
	});

	it("refuses an owner who is not a member of the workspace", async () => {
		const before = dispatches;
		const stranger = crmAddition.parse({
			company: { name: `Stranger Co ${suffix}` },
		});

		await expect(add(NORTHSTAR, stranger, STRANGER)).rejects.toThrow();
		expect(dispatches).toBe(before);
		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.company.count({ where: { name: `Stranger Co ${suffix}` } }),
			),
		).toBe(0);
	});

	it("refuses an addition that names nobody", async () => {
		await expect(add(NORTHSTAR, crmAddition.parse({}))).rejects.toThrow(
			"Name a person, a company, or both.",
		);
	});
});
