import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { ResearchRouter } from "./research.router";
import { ResearchService } from "./research.service";

@Module({
	imports: [TrpcModule],
	providers: [ResearchService, ResearchRouter],
	exports: [ResearchService],
})
export class ResearchModule {}
