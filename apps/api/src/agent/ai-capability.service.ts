import { isAnthropicConfigured } from "@crm/db/ai-models";
import { Injectable } from "@nestjs/common";
import { AgentTriggerService } from "./agent-trigger.service";

@Injectable()
export class AiCapabilityService {
	constructor(private readonly agent: AgentTriggerService) {}

	canGenerate(): boolean {
		return isAnthropicConfigured() && this.agent.canReachAgent();
	}
}
