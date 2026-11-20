import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { PipelineModule } from "../pipeline/pipeline.module";
import { TrpcModule } from "../trpc/trpc.module";
import { WorkspaceConfigRouter } from "./workspace-config.router";
import { WorkspaceConfigService } from "./workspace-config.service";

@Module({
	imports: [AgentModule, PipelineModule, TrpcModule],
	providers: [WorkspaceConfigService, WorkspaceConfigRouter],
	exports: [WorkspaceConfigService],
})
export class WorkspaceConfigModule {}
