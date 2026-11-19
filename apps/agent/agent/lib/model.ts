import { complexModel, defaultModel } from "@crm/db/ai-models";
import { anthropic } from "eve/models/anthropic";

export function defaultAgentModel() {
	return anthropic(defaultModel().id);
}

export function complexAgentModel() {
	return anthropic(complexModel().id);
}
