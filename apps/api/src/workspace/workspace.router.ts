import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	invitationIdInput,
	invitationListOutput,
	invitationOutput,
	inviteMemberInput,
	memberListInput,
	memberListOutput,
	okOutput,
	removeMemberInput,
	setMemberRoleInput,
	updateWorkspaceInput,
	workspaceLiveOutput,
	workspaceMemberOutput,
	workspaceOutput,
} from "./workspace.contracts";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceLiveService } from "./workspace-live.service";

@Router({ alias: "workspace" })
@UseMiddlewares(AuthMiddleware)
export class WorkspaceRouter {
	constructor(
		@Inject(WorkspaceService) private readonly workspace: WorkspaceService,
		@Inject(WorkspaceLiveService) private readonly live: WorkspaceLiveService,
	) {}

	@Query({
		output: workspaceLiveOutput,
		meta: restMeta("GET", "/workspace/members/live", ["Workspace"]),
	})
	async membersLive(@Ctx() ctx: AuthedTrpcContext) {
		return this.live.membership(ctx.user.id);
	}

	@Query({
		output: workspaceOutput,
		meta: restMeta("GET", "/workspace", ["Workspace"]),
	})
	async get(@Ctx() ctx: AuthedTrpcContext) {
		return this.workspace.get(ctx.user.id);
	}

	@Query({
		input: memberListInput,
		output: memberListOutput,
		meta: restMeta("POST", "/workspace/members/search", ["Workspace"]),
	})
	async members(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof memberListInput>,
	) {
		return this.workspace.members(ctx.user.id, input);
	}

	@Mutation({
		input: updateWorkspaceInput,
		output: workspaceOutput,
		meta: restMeta("PATCH", "/workspace", ["Workspace"]),
	})
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateWorkspaceInput>,
	) {
		return this.workspace.update(ctx.user.id, input);
	}

	@Mutation({
		input: setMemberRoleInput,
		output: workspaceMemberOutput,
		meta: restMeta("PATCH", "/workspace/members/{memberId}/role", [
			"Workspace",
		]),
	})
	async setMemberRole(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setMemberRoleInput>,
	) {
		return this.workspace.setMemberRole(ctx.user.id, input);
	}

	@Mutation({
		input: removeMemberInput,
		output: okOutput,
		meta: restMeta("DELETE", "/workspace/members/{memberId}", ["Workspace"]),
	})
	async removeMember(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof removeMemberInput>,
	) {
		return this.workspace.removeMember(ctx.user.id, input);
	}

	@Mutation({
		input: inviteMemberInput,
		output: invitationOutput,
		meta: restMeta("POST", "/workspace/invitations", ["Workspace"]),
	})
	async invite(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof inviteMemberInput>,
	) {
		return this.workspace.invite(ctx.user.id, input);
	}

	@Query({
		output: invitationListOutput,
		meta: restMeta("GET", "/workspace/invitations", ["Workspace"]),
	})
	async invitations(@Ctx() ctx: AuthedTrpcContext) {
		return this.workspace.invitations(ctx.user.id);
	}

	@Mutation({
		input: invitationIdInput,
		output: okOutput,
		meta: restMeta("DELETE", "/workspace/invitations/{invitationId}", [
			"Workspace",
		]),
	})
	async revokeInvitation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof invitationIdInput>,
	) {
		return this.workspace.revokeInvitation(ctx.user.id, input.invitationId);
	}
}
