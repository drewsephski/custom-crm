import { createHash } from "node:crypto";
import { db } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { requireOrganizationId } from "@crm/db/tenancy";
import type { OauthAccess } from "@crm/validation";
import { SLACK_CONNECTION } from "./slack-config";

export class SlackInstallExpiredError extends Error {
	override readonly name = "SlackInstallExpiredError";
}

export function slackBotTokenHash(botToken: string): string {
	return createHash("sha256").update(botToken).digest("hex");
}

export async function rememberSlackInstall(grant: OauthAccess): Promise<void> {
	const { team, authed_user: installer, access_token: botToken } = grant;
	if (!team || !installer || !botToken) return;

	const key = {
		botTokenHash: slackBotTokenHash(botToken),
		installerId: installer.id,
	};
	const install = {
		teamId: team.id,
		teamName: team.name ?? null,
		userToken: installer.access_token ?? null,
		userScopes: installer.scope ?? "",
		createdAt: new Date(),
	};

	await db.slackInstallation.upsert({
		where: { botTokenHash_installerId: key },
		create: { ...key, ...install },
		update: install,
	});

	await forgetStaleInstalls();
}

export type SlackAccountGrant = {
	id: string;
	accountId: string;
	userId: string;
	accessToken?: string | null;
	scope?: string | null;
};

export async function replaceSlackConnection(
	account: SlackAccountGrant,
): Promise<void> {
	const organizationId = requireOrganizationId();
	const botToken = account.accessToken;
	if (!botToken) {
		throw new SlackInstallExpiredError(
			"Slack did not hand over a bot token. Connect Slack again.",
		);
	}

	await db.$transaction(async (tx) => {
		await lockIdempotencyKey(tx, SLACK_CONNECTION.locks.connection);

		const key = {
			botTokenHash: slackBotTokenHash(botToken),
			installerId: account.accountId,
		};
		const install = await tx.slackInstallation.findUnique({
			where: { botTokenHash_installerId: key },
		});
		if (
			!install ||
			install.createdAt.getTime() <
				Date.now() - SLACK_CONNECTION.install.staleMs
		) {
			throw new SlackInstallExpiredError(
				"The Slack authorization expired before it finished. Connect Slack again.",
			);
		}

		await tx.slackInstallation.delete({
			where: { botTokenHash_installerId: key },
		});

		const previous = await tx.slackConnection.findUnique({
			where: { organizationId },
			select: { teamId: true },
		});
		if (previous && previous.teamId !== install.teamId) {
			await tx.slackChannel.deleteMany({});
			await tx.slackMemberMatch.deleteMany({});
		}

		const connection = {
			teamId: install.teamId,
			teamName: install.teamName,
			botToken,
			botScopes: account.scope ?? "",
			installerSlackUserId: account.accountId,
			installedById: account.userId,
		};
		await tx.slackConnection.upsert({
			where: { organizationId },
			create: { organizationId, ...connection },
			update: connection,
		});

		await tx.account.update({
			where: { id: account.id },
			data: { accessToken: null, refreshToken: null },
		});

		await tx.slackWorkspaceGrant.deleteMany({
			where: { teamId: { not: install.teamId } },
		});

		if (!install.userToken) return;

		const grant = {
			teamName: install.teamName,
			userToken: install.userToken,
			userScopes: install.userScopes,
		};

		await tx.slackWorkspaceGrant.upsert({
			where: {
				organizationId_teamId: { organizationId, teamId: install.teamId },
			},
			create: { organizationId, teamId: install.teamId, ...grant },
			update: grant,
		});
	});
}

async function forgetStaleInstalls(): Promise<void> {
	await db.slackInstallation.deleteMany({
		where: {
			createdAt: {
				lt: new Date(Date.now() - SLACK_CONNECTION.install.staleMs),
			},
		},
	});
}
