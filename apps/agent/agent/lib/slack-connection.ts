import { db } from "@crm/db";
import { requireOrganizationId } from "@crm/db/tenancy";

export async function slackAccessToken(): Promise<string | null> {
	const connection = await db.slackConnection.findUnique({
		where: { organizationId: requireOrganizationId() },
		select: { botToken: true },
	});

	return connection?.botToken ?? null;
}

export async function slackConnected(): Promise<boolean> {
	return (await slackAccessToken()) !== null;
}

export async function slackUserToken(): Promise<string | null> {
	const grant = await db.slackWorkspaceGrant.findFirst({
		orderBy: { updatedAt: "desc" },
		select: { userToken: true },
	});

	return grant?.userToken ?? null;
}

export async function slackCanInviteItself(): Promise<boolean> {
	return (await slackUserToken()) !== null;
}
