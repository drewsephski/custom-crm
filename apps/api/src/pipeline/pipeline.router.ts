import { Inject } from "@nestjs/common";
import { Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { pipelineOutput } from "./pipeline.contracts";
import { PipelineService } from "./pipeline.service";

@Router({ alias: "pipeline" })
@UseMiddlewares(AuthMiddleware)
export class PipelineRouter {
	constructor(
		@Inject(PipelineService) private readonly pipelines: PipelineService,
	) {}

	@Query({
		output: pipelineOutput,
		meta: restMeta("GET", "/pipeline", ["Pipeline"]),
	})
	async active() {
		return this.pipelines.active();
	}
}
