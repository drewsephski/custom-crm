import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { PipelineRouter } from "./pipeline.router";
import { PipelineService } from "./pipeline.service";

@Module({
	imports: [TrpcModule],
	providers: [PipelineService, PipelineRouter],
	exports: [PipelineService],
})
export class PipelineModule {}
