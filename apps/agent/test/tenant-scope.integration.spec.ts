import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { taskAuth } from "../agent/lib/dispatch";
import { claimDue } from "../agent/lib/tasks";
import {
	inSessionTenant,
	MissingOrganizationError,
	ORGANIZATION_ATTRIBUTE,
} from "../agent/lib/tenant-scope";

const suffix = `${process.env.TEST_RUN_ID ?? "agent-iso"}-${Date.now().toString(36)}`;
const NORTHSTAR = `agent-iso-${suffix}-northstar`;
const HARBOR = `agent-iso-${suffix}-harbor`;
const KIND = `isolation-${suffix}`;

let leased: Awaited<ReturnType<typeof claimDue>> = [];

let northstarContact = "";
let harborContact = "";

function session(attributes: Record<string, string>) {
	return {
		session: {
			auth: { current: { attributes }, initiator: null },
		},
	};
}

beforeAll(async () => {
	await runAsSystem("seed agent isolation workspaces", async () => {
		for (const id of [NORTHSTAR, HARBOR]) {
			await db.organization.create({
				data: { id, name: id, slug: id, createdAt: new Date() },
			});
		}
	});

	northstarContact = (
		await runInTenant(NORTHSTAR, () =>
			db.contact.create({ data: { firstName: "Maya" } }),
		)
	).id;
	harborContact = (
		await runInTenant(HARBOR, () =>
			db.contact.create({ data: { firstName: "Owen" } }),
		)
	).id;

	for (const [organizationId, contactId] of [
		[NORTHSTAR, northstarContact],
		[HARBOR, harborContact],
	] as const) {
		await runInTenant(organizationId, () =>
			db.agentTask.create({
				data: {
					kind: KIND,
					reason: "isolation",
					contactId,
					priority: 1_000_000,
					dueAt: new Date(Date.now() - 1000),
				},
			}),
		);
	}
});

afterAll(async () => {
	await runAsSystem("remove agent isolation workspaces", () =>
		db.organization.deleteMany({ where: { id: { in: [NORTHSTAR, HARBOR] } } }),
	);
});

describe("an agent session", () => {
	it("may not touch CRM data unless it names a workspace", async () => {
		await expect(
			inSessionTenant(session({}), () => db.contact.findMany()),
		).rejects.toBeInstanceOf(MissingOrganizationError);
	});

	it("sees only the workspace it names", async () => {
		const seen = await inSessionTenant(
			session({ [ORGANIZATION_ATTRIBUTE]: NORTHSTAR }),
			() =>
				db.contact.findMany({
					where: { id: { in: [northstarContact, harborContact] } },
					select: { id: true },
				}),
		);
		expect(seen.map((row) => row.id)).toEqual([northstarContact]);
	});

	it("cannot reach another workspace's record by its id", async () => {
		const found = await inSessionTenant(
			session({ [ORGANIZATION_ATTRIBUTE]: NORTHSTAR }),
			() => db.contact.findUnique({ where: { id: harborContact } }),
		);
		expect(found).toBeNull();
	});
});

describe("the dispatch queue", () => {
	it("leases each task with the workspace it belongs to, and keeps it after a retry", async () => {
		const first = (await claimDue(50, { only: [KIND] }, 1)).filter(
			(task) => task.kind === KIND,
		);
		expect(
			Object.fromEntries(
				first.map((task) => [task.contactId, task.organizationId]),
			),
		).toEqual({ [northstarContact]: NORTHSTAR, [harborContact]: HARBOR });

		await new Promise((resolve) => setTimeout(resolve, 5));

		const retried = (await claimDue(50, { only: [KIND] }, 60_000)).filter(
			(task) => task.kind === KIND,
		);
		leased = retried;
		expect(retried.map((task) => task.attempts).sort()).toEqual([2, 2]);
		expect(
			Object.fromEntries(
				retried.map((task) => [task.contactId, task.organizationId]),
			),
		).toEqual({ [northstarContact]: NORTHSTAR, [harborContact]: HARBOR });
	});

	it("hands the task's workspace to the session it starts", async () => {
		const task = leased.find((entry) => entry.contactId === harborContact);
		if (!task) throw new Error("The Harbor task was not leased.");

		expect(taskAuth(task).attributes[ORGANIZATION_ATTRIBUTE]).toBe(HARBOR);
	});
});
