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
import { sessionOrganizationId } from "../tenancy/session-organization";
import type { UserTrpcContext } from "../trpc/context.types";
import { UserMiddleware } from "../trpc/middlewares/auth.middleware";
import { SessionOnlyMiddleware } from "../trpc/middlewares/session-only.middleware";
import { restMeta } from "../trpc/openapi";
import {
	activateWorkspaceInput,
	createWorkspaceInput,
	invitationIdInput,
	myInvitationListOutput,
	workspaceListOutput,
	workspaceSummaryOutput,
} from "./workspace.contracts";
import { WorkspaceService } from "./workspace.service";

function sessionIdOf(ctx: UserTrpcContext): string | null {
	return ctx.session?.session.id ?? null;
}

@Router({ alias: "workspaces" })
@UseMiddlewares(UserMiddleware, SessionOnlyMiddleware)
export class WorkspacesRouter {
	constructor(
		@Inject(WorkspaceService) private readonly workspace: WorkspaceService,
	) {}

	@Query({
		output: workspaceListOutput,
		meta: restMeta("GET", "/workspaces", ["Workspace"]),
	})
	async list(@Ctx() ctx: UserTrpcContext) {
		return this.workspace.list(ctx.user.id, sessionOrganizationId(ctx.session));
	}

	@Mutation({
		input: createWorkspaceInput,
		output: workspaceSummaryOutput,
		meta: restMeta("POST", "/workspaces", ["Workspace"]),
	})
	async create(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof createWorkspaceInput>,
	) {
		return this.workspace.create(ctx.user.id, sessionIdOf(ctx), input);
	}

	@Mutation({
		input: activateWorkspaceInput,
		output: workspaceSummaryOutput,
		meta: restMeta("POST", "/workspaces/activate", ["Workspace"]),
	})
	async activate(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof activateWorkspaceInput>,
	) {
		return this.workspace.activate(ctx.user.id, sessionIdOf(ctx), input.slug);
	}

	@Query({
		output: myInvitationListOutput,
		meta: restMeta("GET", "/workspaces/invitations", ["Workspace"]),
	})
	async invitations(@Ctx() ctx: UserTrpcContext) {
		return this.workspace.myInvitations(ctx.user.id);
	}

	@Mutation({
		input: invitationIdInput,
		output: workspaceSummaryOutput,
		meta: restMeta("POST", "/workspaces/invitations/{invitationId}/accept", [
			"Workspace",
		]),
	})
	async acceptInvitation(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof invitationIdInput>,
	) {
		return this.workspace.acceptInvitation(
			ctx.user.id,
			sessionIdOf(ctx),
			input.invitationId,
		);
	}
}
