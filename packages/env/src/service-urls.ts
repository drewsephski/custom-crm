export function apiServiceUrl(path: string): URL {
	return serviceUrl(
		process.env.INTERNAL_API_URL ||
			process.env.API_URL ||
			process.env.NEXT_PUBLIC_API_URL ||
			"http://localhost:3001",
		path,
	);
}

export function agentServiceUrl(path: string): URL {
	return serviceUrl(
		process.env.INTERNAL_AGENT_URL ||
			process.env.AGENT_URL ||
			"http://127.0.0.1:2000",
		path,
	);
}

function serviceUrl(base: string, path: string): URL {
	return new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}
