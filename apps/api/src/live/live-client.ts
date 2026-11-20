import { directDatabaseUrl } from "@crm/db/database-host";
import { LIVE } from "./live-config";
import { createPgLiveClient } from "./pg-live-client.mjs";

export type LiveClientMessage = {
	channel: string;
	payload?: string;
};

export type LiveClientConfig = {
	connectionString: string;
	connectionTimeoutMillis: number;
	keepAlive: boolean;
	application_name: string;
};

export type LiveClient = {
	connect(): Promise<unknown>;
	query(text: string): Promise<unknown>;
	end(): Promise<unknown>;
	on(
		event: "notification",
		listener: (message: LiveClientMessage) => void,
	): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "end", listener: () => void): unknown;
};

export type LiveClientFactory = () => Promise<LiveClient>;

export const LIVE_CLIENT_FACTORY = Symbol("LIVE_CLIENT_FACTORY");

export const LIVE_LISTENER_TIMING = Symbol("LIVE_LISTENER_TIMING");

export class LiveDatabaseMissingError extends Error {
	override readonly name = "LiveDatabaseMissingError";
}

export function liveDatabaseUrl(): string | null {
	const url =
		process.env.NODE_ENV === "test"
			? process.env.TEST_DATABASE_URL
			: process.env.DATABASE_URL;

	return url ? directDatabaseUrl(url) : null;
}

export const pgLiveClientFactory: LiveClientFactory = async () => {
	const connectionString = liveDatabaseUrl();

	if (!connectionString) {
		throw new LiveDatabaseMissingError("No database is configured.");
	}

	return createPgLiveClient({
		connectionString,
		connectionTimeoutMillis: LIVE.listener.connectTimeoutMs,
		keepAlive: true,
		application_name: LIVE.listener.applicationName,
	});
};
