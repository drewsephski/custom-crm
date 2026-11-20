import { agentServiceUrl } from "@crm/env/service-urls";

export interface Bridge {
	url(path: string): URL;
	secret: string;
}

/**
 * `AGENT_BRIDGE_SECRET` unset means there is no bridge, not an open one — the
 * same rule the rep bridge and the dispatch poke already follow. Every caller
 * has to say what it does without the agent.
 */
export function bridge(): Bridge | null {
	const secret = process.env.AGENT_BRIDGE_SECRET?.trim();
	if (!secret) return null;

	return { url: agentServiceUrl, secret };
}
