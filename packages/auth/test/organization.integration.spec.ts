import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem } from "@crm/db/tenancy";
import {
	activeOrganizationForNewSession,
	canChangeRoleOf,
	canGrantRole,
	canRemoveMember,
	defaultOrganizationFor,
	membershipOf,
} from "../src/organization";

const suffix = process.env.TEST_RUN_ID ?? "organization-spec";
const idOf = (label: string) => `org-spec-${suffix}-${label}`;

const FIRST_ORG = idOf("first");
const SECOND_ORG = idOf("second");
const STRANGER_ORG = idOf("stranger");
const MEMBER = idOf("member");
const NEWCOMER = idOf("newcomer");

async function createOrganization(id: string, createdAt: Date) {
	await db.organization.create({
		data: { id, name: id, slug: id, createdAt },
	});
}

async function createUser(id: string) {
	await db.user.create({
		data: { id, name: id, email: `${id}@example.test` },
	});
}

async function clean() {
	await runAsSystem("clean organization spec rows", async () => {
		await db.member.deleteMany({
			where: { organizationId: { in: [FIRST_ORG, SECOND_ORG, STRANGER_ORG] } },
		});
		await db.organization.deleteMany({
			where: { id: { in: [FIRST_ORG, SECOND_ORG, STRANGER_ORG] } },
		});
		await db.user.deleteMany({ where: { id: { in: [MEMBER, NEWCOMER] } } });
	});
}

beforeAll(async () => {
	await clean();
	await runAsSystem("seed organization spec rows", async () => {
		await createOrganization(FIRST_ORG, new Date(2026, 0, 1));
		await createOrganization(SECOND_ORG, new Date(2026, 0, 2));
		await createOrganization(STRANGER_ORG, new Date(2026, 0, 3));
		await createUser(MEMBER);
		await createUser(NEWCOMER);
		await db.member.createMany({
			data: [
				{
					id: idOf("m-second"),
					organizationId: SECOND_ORG,
					userId: MEMBER,
					role: "member",
					createdAt: new Date(2026, 1, 2),
				},
				{
					id: idOf("m-first"),
					organizationId: FIRST_ORG,
					userId: MEMBER,
					role: "admin",
					createdAt: new Date(2026, 1, 1),
				},
			],
		});
	});
});

afterAll(clean);

describe("a new account", () => {
	it("joins no workspace on its own", async () => {
		expect(await activeOrganizationForNewSession(NEWCOMER)).toBeNull();
		expect(await db.member.count({ where: { userId: NEWCOMER } })).toBe(0);
	});
});

describe("the default workspace", () => {
	it("is the one the person joined first", async () => {
		expect(await defaultOrganizationFor(MEMBER)).toBe(FIRST_ORG);
	});

	it("reads the role from that one workspace only", async () => {
		expect((await membershipOf(MEMBER, FIRST_ORG))?.role).toBe("admin");
		expect((await membershipOf(MEMBER, SECOND_ORG))?.role).toBe("member");
		expect(await membershipOf(MEMBER, STRANGER_ORG)).toBeNull();
	});
});

describe("granting roles", () => {
	it("never grants more than the person granting holds", () => {
		expect(canGrantRole("owner", "owner")).toBe(true);
		expect(canGrantRole("admin", "admin")).toBe(true);
		expect(canGrantRole("admin", "owner")).toBe(false);
		expect(canGrantRole("member", "member")).toBe(false);
		expect(canGrantRole(null, "member")).toBe(false);
	});

	it("keeps owners in an owner's hands", () => {
		expect(canChangeRoleOf("admin", "owner", "member")).toBe(false);
		expect(canChangeRoleOf("admin", "member", "owner")).toBe(false);
		expect(canChangeRoleOf("admin", "member", "admin")).toBe(true);
		expect(canChangeRoleOf("owner", "owner", "member")).toBe(true);
		expect(canChangeRoleOf("member", "member", "admin")).toBe(false);
	});

	it("lets only an owner remove an owner", () => {
		expect(canRemoveMember("admin", "owner")).toBe(false);
		expect(canRemoveMember("owner", "owner")).toBe(true);
		expect(canRemoveMember("admin", "member")).toBe(true);
		expect(canRemoveMember("member", "member")).toBe(false);
	});
});
