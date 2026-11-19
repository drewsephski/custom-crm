import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import { z } from "zod";
import { pipelinePlanOutput } from "../pipeline/pipeline.contracts";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	applyInput,
	applyOutput,
	configStateOutput,
	configVersionOutput,
	editInput,
	planInput,
	proposeInput,
} from "./workspace-config.contracts";
import { WorkspaceConfigService } from "./workspace-config.service";

@Router({ alias: "workspaceConfig" })
@UseMiddlewares(AuthMiddleware)
export class WorkspaceConfigRouter {
	constructor(
		@Inject(WorkspaceConfigService)
		private readonly configs: WorkspaceConfigService,
	) {}

	@Query({
		output: configStateOutput,
		meta: restMeta("GET", "/workspace/config", ["Workspace"]),
	})
	async state(@Ctx() ctx: AuthedTrpcContext) {
		return this.configs.state(ctx.user.id);
	}

	@Mutation({
		input: proposeInput,
		output: z.array(configVersionOutput),
		meta: restMeta("POST", "/workspace/config/proposals", ["Workspace"]),
	})
	async propose(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof proposeInput>,
	) {
		return this.configs.propose(ctx.user.id, input);
	}

	@Mutation({
		input: editInput,
		output: configVersionOutput,
		meta: restMeta("PATCH", "/workspace/config/proposals/{versionId}", [
			"Workspace",
		]),
	})
	async edit(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof editInput>,
	) {
		return this.configs.edit(ctx.user.id, input.versionId, input.config);
	}

	@Query({
		input: planInput,
		output: pipelinePlanOutput,
		meta: restMeta("GET", "/workspace/config/proposals/{versionId}/pipeline", [
			"Workspace",
		]),
	})
	async pipelinePlan(@Input() input: z.infer<typeof planInput>) {
		return this.configs.pipelinePlan(input.versionId);
	}

	@Mutation({
		input: applyInput,
		output: applyOutput,
		meta: restMeta("POST", "/workspace/config/proposals/{versionId}/apply", [
			"Workspace",
		]),
	})
	async apply(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof applyInput>,
	) {
		return this.configs.apply(ctx.user.id, input);
	}
}
