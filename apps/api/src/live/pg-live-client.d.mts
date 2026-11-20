import type { LiveClient, LiveClientConfig } from "./live-client";

export function createPgLiveClient(
	config: LiveClientConfig,
): Promise<LiveClient>;
