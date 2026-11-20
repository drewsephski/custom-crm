import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { WorkspaceRouter } from "./workspace.router";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceLiveService } from "./workspace-live.service";
import { WorkspacesRouter } from "./workspaces.router";

@Module({
	imports: [AgentModule, TrpcModule],
	providers: [
		WorkspaceService,
		WorkspaceLiveService,
		WorkspaceRouter,
		WorkspacesRouter,
	],
	exports: [WorkspaceService],
})
export class WorkspaceModule {}
