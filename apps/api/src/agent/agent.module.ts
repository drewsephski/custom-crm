import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { AgentAccessService } from "./agent-access.service";
import { AgentDefinitionsService } from "./agent-definitions.service";
import { AgentQueueService } from "./agent-queue.service";
import { AgentRunsService } from "./agent-runs.service";
import { AgentTriggerService } from "./agent-trigger.service";
import { AgentsRouter } from "./agents.router";
import { AiCapabilityService } from "./ai-capability.service";
import { DispatchHeartbeatService } from "./dispatch-heartbeat.service";

@Module({
	imports: [TrpcModule],
	providers: [
		AgentAccessService,
		AgentDefinitionsService,
		AgentQueueService,
		AgentRunsService,
		AgentTriggerService,
		AgentsRouter,
		AiCapabilityService,
		DispatchHeartbeatService,
	],
	exports: [
		AgentAccessService,
		AgentTriggerService,
		AgentQueueService,
		AiCapabilityService,
	],
})
export class AgentModule {}
