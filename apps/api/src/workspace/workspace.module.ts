import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { WorkspaceRouter } from "./workspace.router";
import { WorkspaceService } from "./workspace.service";
import { WorkspacesRouter } from "./workspaces.router";

@Module({
	imports: [AgentModule, TrpcModule],
	providers: [WorkspaceService, WorkspaceRouter, WorkspacesRouter],
	exports: [WorkspaceService],
})
export class WorkspaceModule {}
