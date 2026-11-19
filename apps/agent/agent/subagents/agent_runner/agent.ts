import { defaultModel } from "@crm/db/ai-models";
import { defineAgent } from "eve";
import { defaultAgentModel } from "../../lib/model";

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	model: defaultAgentModel(),
	modelContextWindowTokens: defaultModel().contextWindowTokens,
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
