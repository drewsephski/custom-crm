import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { auth } from "@crm/auth/auth";
import { WORKSPACE_HEADER } from "@crm/auth/workspace-header";
import { db } from "@crm/db";
import { runAsSystem, runInTenant, runUnscoped } from "@crm/db/tenancy";
import { ensureTestPipeline, testStageIds } from "@crm/db/testing";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createAuthMiddleware } from "better-auth/api";
import { applySetCookies } from "better-auth/cookies";
import request from "supertest";
import { z } from "zod";

const suffix = `${process.env.TEST_RUN_ID ?? "iso"}-${Date.now().toString(36)}`;
const idOf = (label: string) => `iso-${suffix}-${label}`;

const NORTHSTAR = {
	id: idOf("northstar"),
	slug: idOf("northstar"),
	name: "Northstar Digital",
};
const HARBOR = {
	id: idOf("harbor"),
	slug: idOf("harbor"),
	name: "Harbor Marketing",
};

const USERS = {
	northstarOwner: idOf("ns-owner"),
	northstarMember: idOf("ns-member"),
	harborOwner: idOf("hb-owner"),
	shared: idOf("shared"),
	outsider: idOf("outsider"),
};

const SESSION_MS = 60 * 60 * 1000;

type Fixtures = {
	northstarCompany: string;
	northstarContact: string;
	harborCompany: string;
	harborContact: string;
};

let app: INestApplication;
let fixtures: Fixtures;
const cookies = new Map<string, string>();

const trpcData = z.object({ result: z.object({ data: z.json() }) });
const trpcError = z.object({
	error: z.object({
		message: z.string(),
		data: z.object({ code: z.string() }),
	}),
});

async function sessionCookie(userId: string): Promise<string> {
	const context = await auth.$context;
	const token = idOf(`${userId}-token`);

	await db.session.create({
		data: {
			id: idOf(`${userId}-session`),
			token,
			userId,
			expiresAt: new Date(Date.now() + SESSION_MS),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});

	const cookie = context.authCookies.sessionToken;
	const serialize = createAuthMiddleware(async (ctx) =>
		ctx.setSignedCookie(cookie.name, token, context.secret, cookie.attributes),
	);
	const headers = new Headers();
	applySetCookies(headers, [await serialize({ headers: new Headers() })]);
	return headers.get("cookie") ?? "";
}

function cookieOf(user: string): string {
	const cookie = cookies.get(user);
	if (!cookie) throw new Error(`No session for ${user}`);
	return cookie;
}

async function query(
	user: string,
	path: string,
	input: Record<string, string>,
	workspace: string | null,
) {
	const call = request(app.getHttpServer())
		.get(`/api/trpc/${path}`)
		.query({ input: JSON.stringify(input ?? {}) })
		.set("cookie", cookieOf(user));
	if (workspace) call.set(WORKSPACE_HEADER, workspace);
	return call;
}

async function mutate(
	user: string,
	path: string,
	input: Record<string, string>,
	workspace: string | null,
) {
	const call = request(app.getHttpServer())
		.post(`/api/trpc/${path}`)
		.set("cookie", cookieOf(user))
		.set("content-type", "application/json")
		.send(JSON.stringify(input ?? {}));
	if (workspace) call.set(WORKSPACE_HEADER, workspace);
	return call;
}

function dataOf(response: request.Response) {
	return trpcData.parse(response.body).result.data;
}

function errorCodeOf(response: request.Response): string {
	return trpcError.parse(response.body).error.data.code;
}

const listRows = z.object({ rows: z.array(z.object({ id: z.string() })) });

async function seed(): Promise<Fixtures> {
	await runAsSystem("seed isolation workspaces", async () => {
		for (const org of [NORTHSTAR, HARBOR]) {
			await db.organization.create({
				data: { ...org, createdAt: new Date() },
			});
			await db.appSetting.create({ data: { organizationId: org.id } });
		}

		for (const id of Object.values(USERS)) {
			await db.user.create({
				data: {
					id,
					name: id,
					email: `${id}@example.test`,
					emailVerified: true,
				},
			});
		}

		const memberships: Array<[string, string, string]> = [
			[NORTHSTAR.id, USERS.northstarOwner, "owner"],
			[NORTHSTAR.id, USERS.northstarMember, "member"],
			[NORTHSTAR.id, USERS.shared, "member"],
			[HARBOR.id, USERS.harborOwner, "owner"],
			[HARBOR.id, USERS.shared, "member"],
		];
		for (const [organizationId, userId, role] of memberships) {
			await db.member.create({
				data: {
					id: idOf(`${organizationId}-${userId}`),
					organizationId,
					userId,
					role,
					createdAt: new Date(),
				},
			});
		}
	});

	await ensureTestPipeline(NORTHSTAR.id);
	await ensureTestPipeline(HARBOR.id);

	const northstar = await runInTenant(NORTHSTAR.id, async () => {
		const company = await db.company.create({
			data: { name: "Lakeside Dental", domain: `lakeside-${suffix}.test` },
		});
		const contact = await db.contact.create({
			data: {
				firstName: "Maya",
				email: `maya@lakeside-${suffix}.test`,
				companyId: company.id,
			},
		});
		await db.fieldDefinition.create({
			data: {
				entity: "COMPANY",
				key: "service_interest",
				label: "Service interest",
				type: "TEXT",
				position: 0,
			},
		});
		await db.savedView.create({
			data: {
				entity: "COMPANY",
				name: "Hot leads",
				shared: true,
				filters: {},
				ownerId: USERS.northstarOwner,
			},
		});
		return { company: company.id, contact: contact.id };
	});

	const harbor = await runInTenant(HARBOR.id, async () => {
		const company = await db.company.create({
			data: { name: "Harbor Client", domain: `lakeside-${suffix}.test` },
		});
		const contact = await db.contact.create({
			data: {
				firstName: "Owen",
				email: `maya@lakeside-${suffix}.test`,
				companyId: company.id,
			},
		});
		await db.fieldDefinition.create({
			data: {
				entity: "COMPANY",
				key: "service_interest",
				label: "Harbor service",
				type: "TEXT",
				position: 0,
			},
		});
		return { company: company.id, contact: contact.id };
	});

	return {
		northstarCompany: northstar.company,
		northstarContact: northstar.contact,
		harborCompany: harbor.company,
		harborContact: harbor.contact,
	};
}

beforeAll(async () => {
	fixtures = await seed();

	for (const id of Object.values(USERS)) {
		cookies.set(id, await sessionCookie(id));
	}

	const { AppModule } = await import("../src/app.module");
	const moduleFixture = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	app = moduleFixture.createNestApplication({ bodyParser: false });
	await app.init();
});

afterAll(async () => {
	await app?.close();
	await runAsSystem("remove isolation workspaces", async () => {
		await db.organization.deleteMany({
			where: { id: { in: [NORTHSTAR.id, HARBOR.id] } },
		});
		await db.organization.deleteMany({
			where: { slug: { startsWith: `iso-${suffix}-created` } },
		});
		await db.user.deleteMany({ where: { id: { in: Object.values(USERS) } } });
	});
});

describe("the database boundary", () => {
	it("shows each workspace only its own rows", async () => {
		const seen = await runInTenant(NORTHSTAR.id, () =>
			db.company.findMany({
				where: {
					id: { in: [fixtures.northstarCompany, fixtures.harborCompany] },
				},
				select: { id: true },
			}),
		);
		expect(seen.map((row) => row.id)).toEqual([fixtures.northstarCompany]);
	});

	it("does not reveal a row from another workspace by its id", async () => {
		const found = await runInTenant(NORTHSTAR.id, () =>
			db.contact.findUnique({ where: { id: fixtures.harborContact } }),
		);
		expect(found).toBeNull();
	});

	it("keeps batched lookups from two workspaces apart", async () => {
		const [northstar, harbor] = await Promise.all([
			runInTenant(NORTHSTAR.id, () =>
				db.contact.findUnique({ where: { id: fixtures.harborContact } }),
			),
			runInTenant(HARBOR.id, () =>
				db.contact.findUnique({ where: { id: fixtures.harborContact } }),
			),
		]);
		expect(northstar).toBeNull();
		expect(harbor?.id).toBe(fixtures.harborContact);
	});

	it("refuses to change a row in another workspace", async () => {
		const { count } = await runInTenant(NORTHSTAR.id, () =>
			db.contact.updateMany({
				where: { id: fixtures.harborContact },
				data: { firstName: "Hijacked" },
			}),
		);
		expect(count).toBe(0);

		const raw = await runInTenant(
			NORTHSTAR.id,
			() =>
				db.$executeRaw`UPDATE "contact" SET "firstName" = 'Hijacked' WHERE id = ${fixtures.harborContact}`,
		);
		expect(raw).toBe(0);
	});

	it("filters raw SQL too", async () => {
		const rows = await runInTenant(
			NORTHSTAR.id,
			() =>
				db.$queryRaw<
					{ id: string }[]
				>`SELECT id FROM "contact" WHERE id IN (${fixtures.northstarContact}, ${fixtures.harborContact})`,
		);
		expect(rows.map((row) => row.id)).toEqual([fixtures.northstarContact]);
	});

	it("refuses a reference into another workspace", async () => {
		await expect(
			runInTenant(NORTHSTAR.id, () =>
				db.deal.create({
					data: {
						name: "Stolen company",
						companyId: fixtures.harborCompany,
						ownerId: USERS.northstarOwner,
					},
				}),
			),
		).rejects.toThrow();
	});

	it("refuses to write a row into another workspace", async () => {
		await expect(
			runInTenant(NORTHSTAR.id, () =>
				db.company.create({
					data: { name: "Planted", organizationId: HARBOR.id },
				}),
			),
		).rejects.toThrow();
	});

	it("fails closed when no workspace is named", async () => {
		const rows = await runUnscoped(() =>
			db.contact.findMany({
				where: {
					id: { in: [fixtures.northstarContact, fixtures.harborContact] },
				},
			}),
		);
		expect(rows).toEqual([]);

		await expect(
			runUnscoped(() => db.company.create({ data: { name: "Orphan" } })),
		).rejects.toThrow();
	});

	it("allows the same email and domain in two workspaces", async () => {
		const [northstar, harbor] = await Promise.all([
			runInTenant(NORTHSTAR.id, () =>
				db.contact.findUnique({ where: { id: fixtures.northstarContact } }),
			),
			runInTenant(HARBOR.id, () =>
				db.contact.findUnique({ where: { id: fixtures.harborContact } }),
			),
		]);
		expect(northstar?.email).toBe(harbor?.email ?? "missing");
	});

	it("keeps custom fields and saved views per workspace", async () => {
		const [northstarFields, harborFields, harborViews] = await Promise.all([
			runInTenant(NORTHSTAR.id, () =>
				db.fieldDefinition.findMany({ select: { label: true } }),
			),
			runInTenant(HARBOR.id, () =>
				db.fieldDefinition.findMany({ select: { label: true } }),
			),
			runInTenant(HARBOR.id, () => db.savedView.findMany()),
		]);
		expect(northstarFields.map((row) => row.label)).toEqual([
			"Service interest",
		]);
		expect(harborFields.map((row) => row.label)).toEqual(["Harbor service"]);
		expect(harborViews).toEqual([]);
	});

	it("keeps integration credentials per workspace", async () => {
		const registration = await runAsSystem("register an MCP client", () =>
			db.mcpClientRegistration.create({
				data: {
					platformSlug: `iso-${suffix}`,
					metadataFingerprint: `iso-${suffix}`,
					issuer: "https://issuer.example.test",
					clientId: "client",
				},
			}),
		);
		await runInTenant(NORTHSTAR.id, () =>
			db.mcpConnection.create({
				data: {
					platformSlug: `iso-${suffix}`,
					accessMode: "READ_ONLY",
					encryptedAccessToken: "sealed-token",
					registrationId: registration.id,
					connectedById: USERS.northstarOwner,
				},
			}),
		);

		const harborSees = await runInTenant(HARBOR.id, () =>
			db.mcpConnection.findMany({ where: { platformSlug: `iso-${suffix}` } }),
		);
		expect(harborSees).toEqual([]);

		await runAsSystem("remove the MCP client", async () => {
			await db.mcpConnection.deleteMany({
				where: { platformSlug: `iso-${suffix}` },
			});
			await db.mcpClientRegistration.delete({ where: { id: registration.id } });
		});
	});

	it("keeps a queued agent task in the workspace that queued it", async () => {
		const task = await runInTenant(HARBOR.id, () =>
			db.agentTask.create({
				data: {
					kind: "identify",
					reason: "isolation",
					contactId: fixtures.harborContact,
					dueAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
				},
			}),
		);
		expect(task.organizationId).toBe(HARBOR.id);

		const fromNorthstar = await runInTenant(NORTHSTAR.id, () =>
			db.agentTask.findUnique({ where: { id: task.id } }),
		);
		expect(fromNorthstar).toBeNull();
	});
});

describe("the API boundary", () => {
	it("lists only the requested workspace's records", async () => {
		const response = await query(
			USERS.northstarOwner,
			"companies.list",
			{},
			NORTHSTAR.slug,
		);
		expect(response.status).toBe(200);
		const ids = listRows.parse(dataOf(response)).rows.map((row) => row.id);
		expect(ids).toContain(fixtures.northstarCompany);
		expect(ids).not.toContain(fixtures.harborCompany);
	});

	it("answers a known id from another workspace as not found", async () => {
		const response = await query(
			USERS.northstarOwner,
			"contacts.byId",
			{ id: fixtures.harborContact },
			NORTHSTAR.slug,
		);
		expect(response.status).toBe(404);
	});

	it("refuses a workspace the caller does not belong to", async () => {
		const response = await query(
			USERS.harborOwner,
			"companies.list",
			{},
			NORTHSTAR.slug,
		);
		expect(response.status).toBe(403);
		expect(errorCodeOf(response)).toBe("FORBIDDEN");
	});

	it("scopes search to the requested workspace", async () => {
		const response = await query(
			USERS.northstarOwner,
			"search.quick",
			{ q: "Owen" },
			NORTHSTAR.slug,
		);
		expect(response.status).toBe(200);
		expect(JSON.stringify(dataOf(response))).not.toContain(
			fixtures.harborContact,
		);
	});

	it("scopes the dashboard to the requested workspace", async () => {
		const northstar = await query(
			USERS.northstarOwner,
			"dashboard.summary",
			{},
			NORTHSTAR.slug,
		);
		const harbor = await query(
			USERS.harborOwner,
			"dashboard.summary",
			{},
			HARBOR.slug,
		);
		expect(northstar.status).toBe(200);
		expect(harbor.status).toBe(200);
		expect(JSON.stringify(dataOf(northstar))).not.toContain(
			fixtures.harborCompany,
		);
	});

	it("lets a person in two workspaces see each one separately", async () => {
		const inNorthstar = await query(
			USERS.shared,
			"companies.list",
			{},
			NORTHSTAR.slug,
		);
		const inHarbor = await query(
			USERS.shared,
			"companies.list",
			{},
			HARBOR.slug,
		);
		const northstarIds = listRows
			.parse(dataOf(inNorthstar))
			.rows.map((row) => row.id);
		const harborIds = listRows
			.parse(dataOf(inHarbor))
			.rows.map((row) => row.id);
		expect(northstarIds).toContain(fixtures.northstarCompany);
		expect(northstarIds).not.toContain(fixtures.harborCompany);
		expect(harborIds).toContain(fixtures.harborCompany);
		expect(harborIds).not.toContain(fixtures.northstarCompany);
	});

	it("switches the default workspace only to one the person belongs to", async () => {
		const switched = await mutate(
			USERS.shared,
			"workspaces.activate",
			{ slug: HARBOR.slug },
			null,
		);
		expect(switched.status).toBe(200);

		const fallback = await query(USERS.shared, "workspace.get", {}, null);
		expect(z.object({ id: z.string() }).parse(dataOf(fallback)).id).toBe(
			HARBOR.id,
		);

		const refused = await mutate(
			USERS.northstarMember,
			"workspaces.activate",
			{ slug: HARBOR.slug },
			null,
		);
		expect(refused.status).toBe(403);
	});

	it("keeps owner-only actions from a member", async () => {
		const invite = await mutate(
			USERS.northstarMember,
			"workspace.invite",
			{ email: `new-${suffix}@example.test`, role: "member" },
			NORTHSTAR.slug,
		);
		expect(invite.status).toBe(403);

		const rename = await mutate(
			USERS.northstarMember,
			"workspace.update",
			{ name: "Taken over", website: "example.com" },
			NORTHSTAR.slug,
		);
		expect(rename.status).toBe(403);
	});

	it("never leaves a workspace without an owner", async () => {
		const ownerMember = idOf(`${NORTHSTAR.id}-${USERS.northstarOwner}`);
		const demote = await mutate(
			USERS.northstarOwner,
			"workspace.setMemberRole",
			{ memberId: ownerMember, role: "member" },
			NORTHSTAR.slug,
		);
		expect(demote.status).toBe(403);

		const leave = await mutate(
			USERS.northstarOwner,
			"workspace.removeMember",
			{ memberId: ownerMember },
			NORTHSTAR.slug,
		);
		expect(leave.status).toBe(403);
	});

	it("gives a new account no workspace until it creates or joins one", async () => {
		const response = await query(USERS.outsider, "workspace.get", {}, null);
		expect(response.status).toBe(412);
		const list = await query(USERS.outsider, "workspaces.list", {}, null);
		expect(dataOf(list)).toEqual({ workspaces: [], activeSlug: null });
	});

	it("makes the creator of a workspace its owner", async () => {
		const created = await mutate(
			USERS.outsider,
			"workspaces.create",
			{ name: `iso-${suffix}-created` },
			null,
		);
		expect(created.status).toBe(200);
		expect(z.object({ role: z.string() }).parse(dataOf(created)).role).toBe(
			"owner",
		);
	});
});

describe("invitations", () => {
	it("joins with the invited role, and only for the invited address", async () => {
		const invite = await mutate(
			USERS.harborOwner,
			"workspace.invite",
			{ email: `${USERS.northstarMember}@example.test`, role: "admin" },
			HARBOR.slug,
		);
		expect(invite.status).toBe(200);
		const invitationId = z.object({ id: z.string() }).parse(dataOf(invite)).id;

		const stolen = await mutate(
			USERS.outsider,
			"workspaces.acceptInvitation",
			{ invitationId },
			null,
		);
		expect(stolen.status).toBe(404);

		const accepted = await mutate(
			USERS.northstarMember,
			"workspaces.acceptInvitation",
			{ invitationId },
			null,
		);
		expect(accepted.status).toBe(200);
		expect(z.object({ role: z.string() }).parse(dataOf(accepted)).role).toBe(
			"admin",
		);

		const replay = await mutate(
			USERS.northstarMember,
			"workspaces.acceptInvitation",
			{ invitationId },
			null,
		);
		expect(replay.status).toBe(400);
	});

	it("does not let an admin invite an owner", async () => {
		const promote = await mutate(
			USERS.northstarMember,
			"workspace.invite",
			{ email: `owner-${suffix}@example.test`, role: "owner" },
			HARBOR.slug,
		);
		expect(promote.status).toBe(403);
	});

	it("drops the role an invitation carries when the inviter lost the right to grant it", async () => {
		const invite = await mutate(
			USERS.northstarMember,
			"workspace.invite",
			{ email: `${USERS.outsider}@example.test`, role: "admin" },
			HARBOR.slug,
		);
		expect(invite.status).toBe(200);
		const invitationId = z.object({ id: z.string() }).parse(dataOf(invite)).id;

		await runAsSystem("demote the inviter", () =>
			db.member.updateMany({
				where: { organizationId: HARBOR.id, userId: USERS.northstarMember },
				data: { role: "member" },
			}),
		);

		const accepted = await mutate(
			USERS.outsider,
			"workspaces.acceptInvitation",
			{ invitationId },
			null,
		);
		expect(accepted.status).toBe(403);
	});
});

describe("pipelines at the API boundary", () => {
	const pipelineOutput = z.object({
		stages: z.array(
			z.object({ id: z.string(), key: z.string(), isDefault: z.boolean() }),
		),
	});
	const dealOutput = z.object({ id: z.string() });
	const stageOutput = z.object({
		stage: z.object({ id: z.string(), key: z.string(), outcome: z.string() }),
		changed: z.boolean(),
	});
	const boardOutput = z.object({
		columns: z.array(
			z.object({
				stage: z.object({ id: z.string() }),
				deals: z.array(z.object({ id: z.string() })),
			}),
		),
	});
	let northstarDeal = "";

	it("answers each workspace with its own stages", async () => {
		const [northstar, harbor] = await Promise.all([
			query(USERS.shared, "pipeline.active", {}, NORTHSTAR.slug),
			query(USERS.shared, "pipeline.active", {}, HARBOR.slug),
		]);
		const northstarIds = pipelineOutput
			.parse(dataOf(northstar))
			.stages.map((stage) => stage.id);
		const harborIds = pipelineOutput
			.parse(dataOf(harbor))
			.stages.map((stage) => stage.id);

		expect(northstarIds.length).toBeGreaterThan(2);
		expect(northstarIds.some((id) => harborIds.includes(id))).toBe(false);
	});

	it("creates a deal in the workspace default stage and moves it", async () => {
		const stages = await testStageIds(NORTHSTAR.id);
		const created = await mutate(
			USERS.northstarOwner,
			"deals.create",
			{
				name: "Lakeside website",
				companyId: fixtures.northstarCompany,
				ownerId: USERS.northstarOwner,
			},
			NORTHSTAR.slug,
		);
		expect(created.status).toBe(200);
		northstarDeal = dealOutput.parse(dataOf(created)).id;

		const moved = await mutate(
			USERS.northstarOwner,
			"deals.setStage",
			{ id: northstarDeal, stageId: stages.proposal_sent ?? "" },
			NORTHSTAR.slug,
		);
		expect(moved.status).toBe(200);
		expect(stageOutput.parse(dataOf(moved))).toMatchObject({
			stage: { id: stages.proposal_sent, key: "proposal_sent" },
			changed: true,
		});

		const stored = await runInTenant(NORTHSTAR.id, () =>
			db.deal.findUniqueOrThrow({
				where: { id: northstarDeal },
				select: { stageId: true },
			}),
		);
		expect(stored.stageId).toBe(stages.proposal_sent ?? "");
	});

	it("asks for a reason before a deal is lost, then closes it", async () => {
		const stages = await testStageIds(NORTHSTAR.id);
		const refused = await mutate(
			USERS.northstarOwner,
			"deals.setStage",
			{ id: northstarDeal, stageId: stages.lost ?? "" },
			NORTHSTAR.slug,
		);
		expect(refused.status).toBe(400);

		const closed = await mutate(
			USERS.northstarOwner,
			"deals.setStage",
			{
				id: northstarDeal,
				stageId: stages.lost ?? "",
				closedReason: "Budget pulled",
			},
			NORTHSTAR.slug,
		);
		expect(closed.status).toBe(200);
		expect(stageOutput.parse(dataOf(closed)).stage.outcome).toBe("LOST");

		const stored = await runInTenant(NORTHSTAR.id, () =>
			db.deal.findUniqueOrThrow({
				where: { id: northstarDeal },
				select: { closedAt: true, closedReason: true },
			}),
		);
		expect(stored.closedAt).not.toBeNull();
		expect(stored.closedReason).toBe("Budget pulled");
	});

	it("refuses another workspace's stage id", async () => {
		const harborStages = await testStageIds(HARBOR.id);
		const moved = await mutate(
			USERS.northstarOwner,
			"deals.setStage",
			{ id: northstarDeal, stageId: harborStages.qualified ?? "" },
			NORTHSTAR.slug,
		);
		expect(moved.status).toBe(400);

		const created = await mutate(
			USERS.northstarOwner,
			"deals.create",
			{
				name: "Borrowed stage",
				companyId: fixtures.northstarCompany,
				ownerId: USERS.northstarOwner,
				stageId: harborStages.qualified ?? "",
			},
			NORTHSTAR.slug,
		);
		expect(created.status).toBe(400);
	});

	it("keeps one workspace's deals off the other's board", async () => {
		const [northstar, harbor] = await Promise.all([
			query(USERS.shared, "deals.board", {}, NORTHSTAR.slug),
			query(USERS.shared, "deals.board", {}, HARBOR.slug),
		]);
		const idsOn = (response: request.Response) =>
			boardOutput
				.parse(dataOf(response))
				.columns.flatMap((column) => column.deals.map((deal) => deal.id));

		expect(idsOn(northstar)).toContain(northstarDeal);
		expect(idsOn(harbor)).not.toContain(northstarDeal);

		const foreign = await mutate(
			USERS.harborOwner,
			"deals.setStage",
			{
				id: northstarDeal,
				stageId: (await testStageIds(HARBOR.id)).qualified ?? "",
			},
			HARBOR.slug,
		);
		expect(foreign.status).toBe(404);
	});
});
