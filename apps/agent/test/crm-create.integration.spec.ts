import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { ensureTestMember, ensureTestOrganization } from "@crm/db/testing";
import { addToCrm, crmAddition } from "../agent/lib/crm-create";

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

	it("creates the company and the contact, owned by the user, and queues their research", async () => {
		const result = await runInTenant(NORTHSTAR.id, () => addToCrm(sam, OWNER));

		expect(result.company?.created).toBe(true);
		expect(result.contact).toMatchObject({ name: "Sam Stehno", created: true });

		const [contact, tasks] = await runInTenant(NORTHSTAR.id, () =>
			Promise.all([
				db.contact.findUniqueOrThrow({
					where: { id: result.contact?.id ?? "" },
					select: {
						ownerId: true,
						companyId: true,
						title: true,
						linkedinUrl: true,
					},
				}),
				db.agentTask.findMany({
					where: {
						OR: [
							{ contactId: result.contact?.id },
							{ companyId: result.company?.id },
						],
					},
					select: { kind: true, reason: true },
				}),
			]),
		);
		expect(contact).toEqual({
			ownerId: OWNER,
			companyId: result.company?.id ?? null,
			title: "OEDP Production Engineer",
			linkedinUrl: "https://www.linkedin.com/in/sam-stehno",
		});
		expect(tasks.map((task) => `${task.kind}:${task.reason}`).sort()).toEqual([
			"agent-event:company.created",
			"agent-event:contact.created",
			"brand:Added from a CRM chat",
			"company-profile:Added from a CRM chat",
			"identify:Added from a CRM chat",
		]);
	});

	it("links to the records already there instead of adding them twice", async () => {
		const first = await runInTenant(NORTHSTAR.id, () => addToCrm(sam, OWNER));

		expect(first.company?.created).toBe(false);
		expect(first.contact?.created).toBe(false);
		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.contact.count({
					where: { linkedinUrl: "https://www.linkedin.com/in/sam-stehno" },
				}),
			),
		).toBe(1);
	});

	it("does not treat another workspace's record as a duplicate", async () => {
		const result = await runInTenant(HARBOR.id, () => addToCrm(sam, OWNER));

		expect(result.company?.created).toBe(true);
		expect(result.contact?.created).toBe(true);
	});

	it("refuses an owner who is not a member of the workspace", async () => {
		const stranger = crmAddition.parse({
			company: { name: `Stranger Co ${suffix}` },
		});

		await expect(
			runInTenant(NORTHSTAR.id, () => addToCrm(stranger, STRANGER)),
		).rejects.toThrow();
		expect(
			await runInTenant(NORTHSTAR.id, () =>
				db.company.count({ where: { name: `Stranger Co ${suffix}` } }),
			),
		).toBe(0);
	});

	it("refuses an addition that names nobody", async () => {
		await expect(
			runInTenant(NORTHSTAR.id, () => addToCrm(crmAddition.parse({}), OWNER)),
		).rejects.toThrow("Name a person, a company, or both.");
	});
});
