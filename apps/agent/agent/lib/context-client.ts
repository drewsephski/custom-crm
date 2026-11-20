import "@crm/env/load";

import ContextDev from "context.dev";
import { CONTEXT } from "./context-config";

let client: { key: string; api: ContextDev } | null = null;

export function contextDevApiKey(): string | null {
	return process.env[CONTEXT.keyVariable]?.trim() || null;
}

export function contextDevConfigured(): boolean {
	return contextDevApiKey() !== null;
}

export function contextDevClient(): ContextDev | null {
	const key = contextDevApiKey();

	if (!key) {
		client = null;
		return null;
	}

	if (client?.key !== key) {
		client = {
			key,
			api: new ContextDev({ apiKey: key, maxRetries: CONTEXT.maxRetries }),
		};
	}

	return client.api;
}
