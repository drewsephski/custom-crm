import { db } from "@crm/db";
import type { JsonValue } from "@crm/db/json";
import {
	APIError,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import * as z from "zod";
import {
	activeOrganizationOfSession,
	canManageConnections,
	membershipOf,
	WORKSPACE_ROLES,
} from "./organization";
import { SLACK_PROVIDER_ID } from "./scopes";

const CONNECT_MANAGER_ROLES = WORKSPACE_ROLES.filter((role) =>
	canManageConnections(role),
);

const SLACK_CONNECT_START_PATHS = ["/link-social", "/sign-in/social"];
const OAUTH_CALLBACK_PATH = "/callback";

const connectStartBody = z.object({
	provider: z.string(),
	callbackURL: z.string().optional(),
});
const callbackParams = z.object({ id: z.string() });

export const slackConnectGuard = createAuthMiddleware(async (ctx) => {
	const guarded =
		startsSlackConnect(ctx.path, ctx.body) ||
		completesSlackConnect(ctx.path, ctx.params);
	if (!guarded) return;

	const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
	if (!session) {
		throw new APIError("UNAUTHORIZED", {
			message: "Sign in to the CRM before you connect Slack.",
		});
	}

	const organizationId =
		(await workspaceOnScreen(
			ctx.path,
			ctx.body,
			session.user.id,
			session.session.id,
		)) ?? (await activeOrganizationOfSession(session.session.id));
	if (!organizationId) {
		throw new APIError("FORBIDDEN", {
			message: "Open a workspace before you connect Slack.",
		});
	}

	const [membership, managers] = await Promise.all([
		membershipOf(session.user.id, organizationId),
		db.member.count({
			where: {
				organizationId,
				role: { in: [...CONNECT_MANAGER_ROLES] },
			},
		}),
	]);
	const role = membership?.role ?? null;

	if (!role) {
		throw new APIError("FORBIDDEN", {
			message: "Only a member of this workspace can connect Slack.",
		});
	}

	if (managers === 0) return;
	if (!canManageConnections(role)) {
		throw new APIError("FORBIDDEN", {
			message:
				"Only an owner or an admin can connect Slack. One Slack workspace is shared by everyone here, so ask one of them to connect or reconnect it.",
		});
	}
});

async function workspaceOnScreen(
	path: string,
	body: JsonValue | undefined,
	userId: string,
	sessionId: string,
): Promise<string | null> {
	if (!startsSlackConnect(path, body)) return null;

	const slug = slugOf(connectStartBody.parse(body).callbackURL);
	if (!slug) return null;

	const workspace = await db.organization.findFirst({
		where: { slug, members: { some: { userId } } },
		select: { id: true },
	});
	if (!workspace) return null;

	await db.session.update({
		where: { id: sessionId },
		data: { activeOrganizationId: workspace.id },
	});

	return workspace.id;
}

function slugOf(callbackURL: string | undefined): string | null {
	if (!callbackURL || !URL.canParse(callbackURL)) return null;
	const [slug] = new URL(callbackURL).pathname.split("/").filter(Boolean);
	return slug ?? null;
}

function startsSlackConnect(
	path: string,
	body: JsonValue | undefined,
): boolean {
	if (!SLACK_CONNECT_START_PATHS.includes(path)) return false;
	const parsed = connectStartBody.safeParse(body);
	return parsed.success && parsed.data.provider === SLACK_PROVIDER_ID;
}

function completesSlackConnect(
	path: string,
	params: JsonValue | undefined,
): boolean {
	if (!path.startsWith(OAUTH_CALLBACK_PATH)) return false;
	const parsed = callbackParams.safeParse(params);
	return parsed.success && parsed.data.id === SLACK_PROVIDER_ID;
}
