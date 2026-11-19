import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { WorkspaceConfigRouter } from "./workspace-config.router";
import { WorkspaceConfigService } from "./workspace-config.service";

@Module({
	imports: [AgentModule, TrpcModule],
	providers: [WorkspaceConfigService, WorkspaceConfigRouter],
})
export class WorkspaceConfigModule {}
