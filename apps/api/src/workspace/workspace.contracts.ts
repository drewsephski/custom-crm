import { WORKSPACE_ROLES } from "@crm/auth/organization";
import { MAX_SLUG } from "@crm/db/workspace-slug";
import { z } from "zod";
import { listInput } from "../trpc/list-input";

export const memberListInput = listInput.extend({
	role: z.array(z.string()).default([]),
});

export type MemberListInput = z.infer<typeof memberListInput>;

const workspaceName = z.string().trim().min(1).max(120);

const slugInput = z
	.string()
	.trim()
	.min(1)
	.max(MAX_SLUG)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const updateWorkspaceInput = z.object({
	name: workspaceName,
	website: z.string().trim().min(1).max(255),
	slug: slugInput.optional(),
});

export const createWorkspaceInput = z.object({
	name: workspaceName,
	website: z.string().trim().max(255).optional(),
});

export const activateWorkspaceInput = z.object({
	slug: slugInput,
});

export const setMemberRoleInput = z.object({
	memberId: z.string().min(1),
	role: z.enum(WORKSPACE_ROLES),
});

export const removeMemberInput = z.object({
	memberId: z.string().min(1),
});

export const inviteMemberInput = z.object({
	email: z.string().trim().toLowerCase().email().max(320),
	role: z.enum(WORKSPACE_ROLES).default("member"),
});

export const invitationIdInput = z.object({
	invitationId: z.string().min(1).max(128),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInput>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;
export type SetMemberRoleInput = z.infer<typeof setMemberRoleInput>;
export type RemoveMemberInput = z.infer<typeof removeMemberInput>;
export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

export const workspaceOutput = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	website: z.string().nullable(),
	onboarded: z.boolean(),
	viewerRole: z.enum(WORKSPACE_ROLES).nullable(),
	canRename: z.boolean(),
	canChangeRoles: z.boolean(),
	canInvite: z.boolean(),
});

export type Workspace = z.infer<typeof workspaceOutput>;

export const workspaceSummaryOutput = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	role: z.enum(WORKSPACE_ROLES),
});

export type WorkspaceSummary = z.infer<typeof workspaceSummaryOutput>;

export const workspaceListOutput = z.object({
	workspaces: z.array(workspaceSummaryOutput),
	activeSlug: z.string().nullable(),
});

export const workspaceMemberOutput = z.object({
	id: z.string(),
	userId: z.string(),
	name: z.string(),
	email: z.string(),
	image: z.string().nullable(),
	role: z.enum(WORKSPACE_ROLES),
	joinedAt: z.string(),
	isViewer: z.boolean(),
});

export type WorkspaceMember = z.infer<typeof workspaceMemberOutput>;

export const memberListOutput = z.object({
	rows: z.array(workspaceMemberOutput),
	total: z.number(),
	facetCounts: z.record(z.string(), z.record(z.string(), z.number())),
});

export const invitationOutput = z.object({
	id: z.string(),
	email: z.string(),
	role: z.enum(WORKSPACE_ROLES),
	status: z.enum(["pending", "accepted", "canceled", "expired"]),
	expiresAt: z.string(),
	invitedBy: z.string(),
});

export type InvitationView = z.infer<typeof invitationOutput>;

export const INVITATION_EMAIL_STATUSES = [
	"sent",
	"not-sent",
	"failed",
] as const;

export const inviteMemberOutput = invitationOutput.extend({
	emailStatus: z.enum(INVITATION_EMAIL_STATUSES),
});

export type InviteMemberResult = z.infer<typeof inviteMemberOutput>;

export const invitationListOutput = z.array(invitationOutput);

export const myInvitationOutput = z.object({
	id: z.string(),
	workspaceName: z.string(),
	role: z.enum(WORKSPACE_ROLES),
	invitedBy: z.string(),
	expiresAt: z.string(),
});

export type MyInvitation = z.infer<typeof myInvitationOutput>;

export const myInvitationListOutput = z.array(myInvitationOutput);

export const okOutput = z.object({ ok: z.literal(true) });

export const workspaceLiveOutput = z
	.object({
		url: z.url(),
		sealedQuery: z.object({
			capability: z.string(),
			queryFingerprint: z.string(),
			expiresAt: z.number(),
		}),
	})
	.nullable();

export type WorkspaceLive = z.infer<typeof workspaceLiveOutput>;
