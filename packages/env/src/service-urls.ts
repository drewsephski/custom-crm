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

export function agentCommandBridge() {
	const secret = process.env.AGENT_BRIDGE_SECRET?.trim();
	if (!secret) return null;

	const headers = new Headers({ authorization: `Bearer ${secret}` });
	const deployment = process.env.VERCEL_URL;
	let base = process.env.INTERNAL_AGENT_URL;

	if (!base && deployment && process.env.VERCEL_ENV !== "development") {
		const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
		base = `https://${deployment}`;
		if (bypass) headers.set("x-vercel-protection-bypass", bypass);
		else if (process.env.VERCEL_ENV === "production" && process.env.API_URL)
			base = process.env.API_URL;
	}

	return {
		post(path: string, options: { body?: string; signal: AbortSignal }) {
			const url = base ? serviceUrl(base, path) : agentServiceUrl(path);
			const requestHeaders = new Headers(headers);
			if (options.body !== undefined)
				requestHeaders.set("content-type", "application/json");
			return fetch(url, {
				...options,
				headers: requestHeaders,
				method: "POST",
				redirect: "error",
			});
		},
	};
}

function serviceUrl(base: string, path: string): URL {
	return new URL(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
}
