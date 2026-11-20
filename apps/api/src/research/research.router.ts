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
	researchDecideFindingInput,
	researchDecideFindingOutput,
	researchForRecordInput,
	researchForRecordOutput,
	researchUsageOutput,
} from "./research.contracts";
import { ResearchService } from "./research.service";

@Router({ alias: "research" })
@UseMiddlewares(AuthMiddleware)
export class ResearchRouter {
	constructor(
		@Inject(ResearchService) private readonly research: ResearchService,
	) {}

	@Query({
		input: researchForRecordInput,
		output: researchForRecordOutput,
		meta: restMeta("GET", "/research/results", ["Research"]),
	})
	async forRecord(@Input() input: z.infer<typeof researchForRecordInput>) {
		return this.research.forRecord(input);
	}

	@Query({
		output: researchUsageOutput,
		meta: restMeta("GET", "/research/usage", ["Research"]),
	})
	async usage() {
		return this.research.usage();
	}

	@Mutation({
		input: researchDecideFindingInput,
		output: researchDecideFindingOutput,
		meta: restMeta("POST", "/research/decide-finding", ["Research"]),
	})
	async decideFinding(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof researchDecideFindingInput>,
	) {
		return this.research.decideFinding(input, ctx.user.id);
	}
}
