import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import {
	rememberSlackInstall,
	replaceSlackConnection,
	SlackInstallExpiredError,
} from "../src/slack-grant";

const suffix = `${process.env.TEST_RUN_ID ?? "slack-ws"}-${Date.now().toString(36)}`;
const idOf = (label: string) => `slack-ws-${suffix}-${label}`;

const NORTHSTAR = idOf("northstar");
const HARBOR = idOf("harbor");
const SHARED_ADMIN = idOf("shared-admin");
const NORTHSTAR_OWNER = idOf("ns-owner");
const HARBOR_OWNER = idOf("hb-owner");
const USERS = [SHARED_ADMIN, NORTHSTAR_OWNER, HARBOR_OWNER];

type Install = {
	organizationId: string;
	slackUserId: string;
	teamId: string;
	botToken: string;
	userToken?: string;
};

async function remember(install: Install) {
	await rememberSlackInstall({
		ok: true,
		error: undefined,
		token_type: "bot",
		access_token: install.botToken,
		scope: "chat:write,channels:read",
		team: { id: install.teamId, name: install.teamId },
		authed_user: {
			id: install.slackUserId,
			access_token: install.userToken,
			scope: "channels:write",
		},
	});
}

async function link(install: Install) {
	const id = idOf(`account-${install.slackUserId}`);
	return db.account.upsert({
		where: { id },
		create: {
			id,
			accountId: install.slackUserId,
			providerId: "slack",
			userId: SHARED_ADMIN,
			accessToken: install.botToken,
			scope: "chat:write,channels:read",
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		update: { accessToken: install.botToken },
	});
}

async function finish(install: Install) {
	const account = await link(install);
	await runInTenant(install.organizationId, () =>
		replaceSlackConnection(account),
	);
	return account;
}

function connectionOf(organizationId: string) {
	return runInTenant(organizationId, () =>
		db.slackConnection.findMany({
			select: {
				organizationId: true,
				teamId: true,
				botToken: true,
				installedById: true,
			},
		}),
	);
}

function userTokenOf(organizationId: string) {
	return runInTenant(organizationId, async () =>
		(
			await db.slackWorkspaceGrant.findMany({ select: { userToken: true } })
		).map((grant) => grant.userToken),
	);
}

async function clean() {
	await runAsSystem("clean Slack workspace connection spec", async () => {
		await db.organization.deleteMany({
			where: { id: { in: [NORTHSTAR, HARBOR] } },
		});
		await db.account.deleteMany({ where: { userId: { in: USERS } } });
		await db.user.deleteMany({ where: { id: { in: USERS } } });
		await db.slackInstallation.deleteMany({
			where: { teamId: { startsWith: idOf("") } },
		});
	});
}

beforeAll(async () => {
	await clean();
	await runAsSystem("seed Slack workspace connection spec", async () => {
		for (const id of [NORTHSTAR, HARBOR]) {
			await db.organization.create({
				data: { id, name: id, slug: id, createdAt: new Date() },
			});
		}
		for (const id of USERS) {
			await db.user.create({
				data: { id, name: id, email: `${id}@example.test` },
			});
		}
		const memberships: Array<[string, string, string]> = [
			[NORTHSTAR, SHARED_ADMIN, "admin"],
			[NORTHSTAR, NORTHSTAR_OWNER, "owner"],
			[HARBOR, SHARED_ADMIN, "admin"],
			[HARBOR, HARBOR_OWNER, "owner"],
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
});

afterAll(clean);

describe("a Slack connection belongs to one workspace", () => {
	const northstarTeam = idOf("T-north");
	const harborTeam = idOf("T-harbor");

	it("keeps two agencies of one admin on their own Slack tokens", async () => {
		const northstar: Install = {
			organizationId: NORTHSTAR,
			slackUserId: idOf("U-north"),
			teamId: northstarTeam,
			botToken: `xoxb-${idOf("north")}`,
			userToken: `xoxp-${idOf("north")}`,
		};
		const harbor: Install = {
			organizationId: HARBOR,
			slackUserId: idOf("U-harbor"),
			teamId: harborTeam,
			botToken: `xoxb-${idOf("harbor")}`,
			userToken: `xoxp-${idOf("harbor")}`,
		};

		await remember(northstar);
		await remember(harbor);
		const account = await finish(northstar);
		await finish(harbor);

		expect(await connectionOf(NORTHSTAR)).toEqual([
			{
				organizationId: NORTHSTAR,
				teamId: northstarTeam,
				botToken: northstar.botToken,
				installedById: SHARED_ADMIN,
			},
		]);
		expect(await connectionOf(HARBOR)).toEqual([
			{
				organizationId: HARBOR,
				teamId: harborTeam,
				botToken: harbor.botToken,
				installedById: SHARED_ADMIN,
			},
		]);
		expect(await userTokenOf(NORTHSTAR)).toEqual([northstar.userToken]);
		expect(await userTokenOf(HARBOR)).toEqual([harbor.userToken]);

		const stored = await db.account.findUnique({
			where: { id: account.id },
			select: { accessToken: true },
		});
		expect(stored?.accessToken).toBeNull();
	});

	it("does not mix up one Slack user installing into two teams at once", async () => {
		const gridUser = idOf("U-grid");
		const first: Install = {
			organizationId: NORTHSTAR,
			slackUserId: gridUser,
			teamId: northstarTeam,
			botToken: `xoxb-${idOf("grid-north")}`,
			userToken: `xoxp-${idOf("grid-north")}`,
		};
		const second: Install = {
			organizationId: HARBOR,
			slackUserId: gridUser,
			teamId: harborTeam,
			botToken: `xoxb-${idOf("grid-harbor")}`,
			userToken: `xoxp-${idOf("grid-harbor")}`,
		};

		await remember(first);
		await remember(second);
		await finish(first);
		await finish(second);

		expect((await connectionOf(NORTHSTAR))[0]?.botToken).toBe(first.botToken);
		expect((await connectionOf(HARBOR))[0]?.botToken).toBe(second.botToken);
		expect(await userTokenOf(NORTHSTAR)).toEqual([first.userToken]);
		expect(await userTokenOf(HARBOR)).toEqual([second.userToken]);
	});

	it("refuses a token exchange it has no installation for", async () => {
		const before = await connectionOf(NORTHSTAR);
		const account = await link({
			organizationId: NORTHSTAR,
			slackUserId: idOf("U-stranger"),
			teamId: idOf("T-stranger"),
			botToken: `xoxb-${idOf("stranger")}`,
		});

		await expect(
			runInTenant(NORTHSTAR, () => replaceSlackConnection(account)),
		).rejects.toBeInstanceOf(SlackInstallExpiredError);
		expect(await connectionOf(NORTHSTAR)).toEqual(before);
	});

	it("stays connected when the installer is demoted or removed", async () => {
		const northstar = await connectionOf(NORTHSTAR);
		const harbor = await connectionOf(HARBOR);

		await runAsSystem("demote and remove the installer", async () => {
			await db.member.update({
				where: { id: idOf(`${NORTHSTAR}-${SHARED_ADMIN}`) },
				data: { role: "member" },
			});
			await db.member.delete({
				where: { id: idOf(`${HARBOR}-${SHARED_ADMIN}`) },
			});
		});

		expect((await connectionOf(NORTHSTAR))[0]?.botToken).toBe(
			northstar[0]?.botToken,
		);
		expect((await connectionOf(HARBOR))[0]?.botToken).toBe(harbor[0]?.botToken);
	});

	it("clears another team's channels when the workspace switches team", async () => {
		await runInTenant(NORTHSTAR, () =>
			db.slackChannel.create({
				data: { id: idOf("C-old"), name: "old-team" },
			}),
		);
		await runAsSystem("restore the installer role", () =>
			db.member.update({
				where: { id: idOf(`${NORTHSTAR}-${SHARED_ADMIN}`) },
				data: { role: "admin" },
			}),
		);

		const moved: Install = {
			organizationId: NORTHSTAR,
			slackUserId: idOf("U-moved"),
			teamId: idOf("T-moved"),
			botToken: `xoxb-${idOf("moved")}`,
		};
		await remember(moved);
		await finish(moved);

		const [channels, grants, connection] = await runInTenant(NORTHSTAR, () =>
			Promise.all([
				db.slackChannel.count(),
				db.slackWorkspaceGrant.count(),
				db.slackConnection.findMany({ select: { teamId: true } }),
			]),
		);
		expect(channels).toBe(0);
		expect(grants).toBe(0);
		expect(connection).toEqual([{ teamId: moved.teamId }]);
		expect((await connectionOf(HARBOR))[0]?.teamId).toBe(harborTeam);
	});
});
