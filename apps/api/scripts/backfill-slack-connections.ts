import {
	chooseSlackOrganization,
	type SlackBackfillCandidate,
} from "@crm/auth/slack-backfill";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { z } from "zod";

const apply = process.argv.includes("--apply");

const authTest = z.object({
	ok: z.boolean(),
	team_id: z.string().optional(),
	team: z.string().optional(),
	error: z.string().optional(),
});

async function slackTeamOf(token: string) {
	const response = await fetch("https://slack.com/api/auth.test", {
		method: "POST",
		headers: { authorization: `Bearer ${token}` },
	});
	const parsed = authTest.parse(await response.json());
	return parsed.ok && parsed.team_id
		? { teamId: parsed.team_id, teamName: parsed.team ?? null }
		: { error: parsed.error ?? `HTTP ${response.status}` };
}

const accounts = await runAsSystem("list Slack accounts to backfill", () =>
	db.account.findMany({
		where: { providerId: "slack", accessToken: { not: null } },
		select: {
			id: true,
			accountId: true,
			userId: true,
			accessToken: true,
			scope: true,
			user: {
				select: {
					members: {
						where: { role: { in: ["owner", "admin"] } },
						select: {
							organizationId: true,
							organization: {
								select: {
									slackConnection: { select: { organizationId: true } },
									slackWorkspaceGrants: { select: { teamId: true } },
								},
							},
						},
					},
				},
			},
		},
	}),
);

console.log(
	`${accounts.length} Slack account token(s) without a workspace connection.${apply ? "" : " Dry run: pass --apply to write."}`,
);

for (const account of accounts) {
	if (!account.accessToken) continue;
	const team = await slackTeamOf(account.accessToken);
	if ("error" in team) {
		console.log(`account ${account.id}: skipped, Slack said ${team.error}`);
		continue;
	}

	const candidates: SlackBackfillCandidate[] = account.user.members.map(
		(member) => ({
			organizationId: member.organizationId,
			grantTeamId: member.organization.slackWorkspaceGrants[0]?.teamId ?? null,
			connected: member.organization.slackConnection !== null,
		}),
	);
	const decision = chooseSlackOrganization(team.teamId, candidates);
	if (decision.kind === "skip") {
		console.log(`account ${account.id}: skipped, ${decision.reason}`);
		continue;
	}

	console.log(
		`account ${account.id}: Slack team ${team.teamId} belongs to workspace ${decision.organizationId}`,
	);
	if (!apply) continue;

	const botToken = account.accessToken;
	await runInTenant(decision.organizationId, () =>
		db.slackConnection.create({
			data: {
				teamId: team.teamId,
				teamName: team.teamName,
				botToken,
				botScopes: account.scope ?? "",
				installerSlackUserId: account.accountId,
				installedById: account.userId,
			},
		}),
	);
	await runAsSystem("clear a migrated Slack account token", () =>
		db.account.update({
			where: { id: account.id },
			data: { accessToken: null, refreshToken: null },
		}),
	);
}

await db.$disconnect();
