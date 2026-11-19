import { type Db, db } from "@crm/db";
import { requireOrganizationId } from "@crm/db/tenancy";

export const DEFAULT_WORKSPACE_NAME = "CRM";

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ORGANIZATION_PLUGIN_PATHS = [
	"/organization/accept-invitation",
	"/organization/add-team-member",
	"/organization/cancel-invitation",
	"/organization/check-slug",
	"/organization/create",
	"/organization/create-role",
	"/organization/create-team",
	"/organization/delete",
	"/organization/delete-role",
	"/organization/get-active-member",
	"/organization/get-active-member-role",
	"/organization/get-full-organization",
	"/organization/get-invitation",
	"/organization/get-role",
	"/organization/has-permission",
	"/organization/invite-member",
	"/organization/leave",
	"/organization/list",
	"/organization/list-invitations",
	"/organization/list-members",
	"/organization/list-roles",
	"/organization/list-team-members",
	"/organization/list-teams",
	"/organization/list-user-invitations",
	"/organization/list-user-teams",
	"/organization/reject-invitation",
	"/organization/remove-member",
	"/organization/remove-team",
	"/organization/remove-team-member",
	"/organization/set-active",
	"/organization/set-active-team",
	"/organization/update",
	"/organization/update-member-role",
	"/organization/update-role",
	"/organization/update-team",
] as const;

const ROLE_RANK = {
	member: 0,
	admin: 1,
	owner: 2,
} as const satisfies Record<WorkspaceRole, number>;

export function isWorkspaceRole(value: string): value is WorkspaceRole {
	return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function toWorkspaceRole(value: string): WorkspaceRole {
	return isWorkspaceRole(value) ? value : "member";
}

export function isWorkspaceAdmin(role: WorkspaceRole | null): boolean {
	return role === "owner" || role === "admin";
}

export function canRenameWorkspace(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canChangeRole(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageCurrency(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageConnections(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageTracking(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canInviteMembers(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canConfigureWorkspace(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canGrantRole(
	actor: WorkspaceRole | null,
	granted: WorkspaceRole,
): boolean {
	if (!actor || !isWorkspaceAdmin(actor)) return false;
	return ROLE_RANK[granted] <= ROLE_RANK[actor];
}

export function canChangeRoleOf(
	actor: WorkspaceRole | null,
	target: WorkspaceRole,
	next: WorkspaceRole,
): boolean {
	if (!actor || !isWorkspaceAdmin(actor)) return false;
	if (actor === "owner") return true;
	return target !== "owner" && next !== "owner";
}

export function canRemoveMember(
	actor: WorkspaceRole | null,
	target: WorkspaceRole,
): boolean {
	if (!actor || !isWorkspaceAdmin(actor)) return false;
	return actor === "owner" || target !== "owner";
}

export function memberOfWorkspace(
	organizationId: string = requireOrganizationId(),
) {
	return { members: { some: { organizationId } } };
}

export function connectionManagerOfWorkspace(
	organizationId: string = requireOrganizationId(),
) {
	return {
		members: {
			some: {
				organizationId,
				role: { in: WORKSPACE_ROLES.filter(canManageConnections) },
			},
		},
	};
}

export function slackAccountOfWorkspace(
	organizationId: string = requireOrganizationId(),
) {
	return {
		providerId: "slack",
		accessToken: { not: null },
		user: connectionManagerOfWorkspace(organizationId),
	};
}

export type WorkspaceMemberReader = Pick<Db, "member">;

export type Membership = {
	organizationId: string;
	role: WorkspaceRole;
};

export async function membershipOf(
	userId: string,
	organizationId: string,
	client: WorkspaceMemberReader = db,
): Promise<Membership | null> {
	const member = await client.member.findUnique({
		where: { organizationId_userId: { organizationId, userId } },
		select: { organizationId: true, role: true },
	});

	return member
		? {
				organizationId: member.organizationId,
				role: toWorkspaceRole(member.role),
			}
		: null;
}

export async function workspaceRoleOf(
	userId: string,
	client: WorkspaceMemberReader = db,
	organizationId: string = requireOrganizationId(),
): Promise<WorkspaceRole | null> {
	return (await membershipOf(userId, organizationId, client))?.role ?? null;
}

export async function defaultOrganizationFor(
	userId: string,
	client: WorkspaceMemberReader = db,
): Promise<string | null> {
	const first = await client.member.findFirst({
		where: { userId },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		select: { organizationId: true },
	});

	return first?.organizationId ?? null;
}

export async function activeOrganizationForNewSession(
	userId: string,
): Promise<string | null> {
	try {
		return await defaultOrganizationFor(userId);
	} catch (error) {
		console.error(
			`[auth] could not read the memberships of user ${userId}; the session starts without a workspace`,
			error,
		);
		return null;
	}
}

export async function activeOrganizationOfSession(
	sessionId: string,
): Promise<string | null> {
	const row = await db.session.findUnique({
		where: { id: sessionId },
		select: { activeOrganizationId: true },
	});

	return row?.activeOrganizationId ?? null;
}
