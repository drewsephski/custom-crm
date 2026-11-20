export const DATABASE_HOST = {
	local: ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"],
	neonSuffix: ".neon.tech",
	poolerSuffix: "-pooler",
	devHostsVariable: "DEV_DATABASE_HOSTS",
} as const;

const LOCAL_HOSTS = new Set<string>(DATABASE_HOST.local);

function directHost(hostname: string): string {
	if (!hostname.endsWith(DATABASE_HOST.neonSuffix)) return hostname;

	const [endpoint, ...rest] = hostname.split(".");
	if (!endpoint?.endsWith(DATABASE_HOST.poolerSuffix)) return hostname;

	return [endpoint.slice(0, -DATABASE_HOST.poolerSuffix.length), ...rest].join(
		".",
	);
}

export function directDatabaseUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const direct = directHost(parsed.hostname);
		if (direct === parsed.hostname) return url;

		parsed.hostname = direct;
		return parsed.toString();
	} catch {
		return url;
	}
}

export function databaseHost(url: string): string {
	try {
		return directHost(new URL(url).hostname);
	} catch {
		return url;
	}
}

export function isLocalHost(host: string): boolean {
	return LOCAL_HOSTS.has(host);
}

export function parseDevHosts(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => directHost(entry.trim().toLowerCase()))
		.filter(Boolean);
}
