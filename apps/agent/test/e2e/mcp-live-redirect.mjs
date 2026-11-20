const from = process.env.MCP_LIVE_FROM ?? "https://mcp.linear.app/mcp";
const to = process.env.MCP_LIVE_TO ?? "http://127.0.0.1:3199/mcp";
const original = globalThis.fetch;

globalThis.fetch = (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (!url.startsWith(from)) return original(input, init);
	const target = to + url.slice(from.length);
	return input instanceof Request
		? original(new Request(target, input), init)
		: original(target, init);
};
