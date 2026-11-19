import {
	type Membership,
	toWorkspaceRole,
	type WorkspaceRole,
} from "@crm/auth/organization";
import type { Db } from "@crm/db";
import { runAsSystem } from "@crm/db/tenancy";

export type ActiveWorkspace = {
	id: string;
	slug: string;
	name: string;
	role: WorkspaceRole;
};

export type WorkspaceRequest = {
	userId: string;
	requestedSlug: string | null;
	sessionOrganizationId: string | null;
};

export type WorkspaceResolution =
	| { kind: "resolved"; workspace: ActiveWorkspace }
	| { kind: "not-a-member"; slug: string }
	| { kind: "no-workspace" };

const WORKSPACE_SELECT = {
	role: true,
	organization: { select: { id: true, slug: true, name: true } },
} as const;

function toActive(row: {
	role: string;
	organization: { id: string; slug: string; name: string };
}): ActiveWorkspace {
	return {
		id: row.organization.id,
		slug: row.organization.slug,
		name: row.organization.name,
		role: toWorkspaceRole(row.role),
	};
}

export function readRequestedSlug(
	value: string | string[] | undefined,
): string | null {
	const raw = Array.isArray(value) ? value[0] : value;
	const slug = raw?.trim().toLowerCase();
	return slug && /^[a-z0-9-]{1,64}$/.test(slug) ? slug : null;
}

export function resolveWorkspace(
	db: Db,
	request: WorkspaceRequest,
): Promise<WorkspaceResolution> {
	return runAsSystem("resolve the caller's workspace membership", async () => {
		if (request.requestedSlug) {
			const member = await db.member.findFirst({
				where: {
					userId: request.userId,
					organization: { slug: request.requestedSlug },
				},
				select: WORKSPACE_SELECT,
			});

			return member
				? { kind: "resolved", workspace: toActive(member) }
				: { kind: "not-a-member", slug: request.requestedSlug };
		}

		if (request.sessionOrganizationId) {
			const member = await db.member.findUnique({
				where: {
					organizationId_userId: {
						organizationId: request.sessionOrganizationId,
						userId: request.userId,
					},
				},
				select: WORKSPACE_SELECT,
			});
			if (member) return { kind: "resolved", workspace: toActive(member) };
		}

		const first = await db.member.findFirst({
			where: { userId: request.userId },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: WORKSPACE_SELECT,
		});

		return first
			? { kind: "resolved", workspace: toActive(first) }
			: { kind: "no-workspace" };
	});
}

export function listMemberships(
	db: Db,
	userId: string,
): Promise<Array<Membership & { slug: string; name: string }>> {
	return runAsSystem("list the caller's workspaces", async () => {
		const rows = await db.member.findMany({
			where: { userId },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: WORKSPACE_SELECT,
		});

		return rows.map((row) => ({
			organizationId: row.organization.id,
			slug: row.organization.slug,
			name: row.organization.name,
			role: toWorkspaceRole(row.role),
		}));
	});
}
