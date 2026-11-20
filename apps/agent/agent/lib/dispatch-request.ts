import { agentServiceUrl } from "@crm/env/service-urls";
import { DISPATCH } from "./dispatch-config";

export type DispatchRequest = () => void;

export async function postDispatch(): Promise<boolean> {
	const secret = process.env.AGENT_BRIDGE_SECRET?.trim();
	if (!secret) return false;

	try {
		const response = await fetch(agentServiceUrl(DISPATCH.self.path), {
			method: "POST",
			headers: { authorization: `Bearer ${secret}` },
			signal: AbortSignal.timeout(DISPATCH.self.timeoutMs),
		});

		if (response.ok) return true;

		console.warn(
			`[agent] The dispatch request answered ${response.status}. The next dispatch tick starts the queued work.`,
		);
		return false;
	} catch (error) {
		console.warn(
			`[agent] The dispatch request did not land. The next dispatch tick starts the queued work: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return false;
	}
}

export const requestDispatch: DispatchRequest = () => {
	void postDispatch();
};
