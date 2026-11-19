import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const port = Number(process.env.MCP_LIVE_PORT ?? "3199");
const log = process.env.MCP_LIVE_LOG ?? "mcp-live-calls.jsonl";
const issuesByToken = new Map<string, string[]>(
	(process.env.MCP_LIVE_TOKENS ?? "")
		.split(",")
		.filter(Boolean)
		.map((entry) => {
			const [token = "", ...issues] = entry.split(":");
			return [token, issues];
		}),
);

type CallRecord = {
	tool?: string;
	token: string;
	id?: string;
	refused?: boolean;
	path?: string;
};

function record(entry: CallRecord) {
	appendFileSync(log, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

function serverFor(token: string) {
	const server = new McpServer({ name: "crm-live-linear", version: "1.0.0" });
	server.registerTool(
		"list_issues",
		{
			description: "List open issues in the workspace's tracker.",
			inputSchema: { limit: z.number().int().optional() },
		},
		async () => {
			record({ tool: "list_issues", token });
			const issues = issuesByToken.get(token) ?? [];
			return {
				content: [{ type: "text", text: JSON.stringify({ issues }) }],
			};
		},
	);
	server.registerTool(
		"delete_issue",
		{
			description: "Delete one issue.",
			inputSchema: { id: z.string() },
		},
		async ({ id }) => {
			record({ tool: "delete_issue", token, id });
			return { content: [{ type: "text", text: "deleted" }] };
		},
	);
	return server;
}

createServer(async (request, response) => {
	const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
	if (!issuesByToken.has(token)) {
		record({ refused: true, token, path: request.url });
		response.writeHead(401).end();
		return;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	const body = chunks.length
		? JSON.parse(Buffer.concat(chunks).toString("utf8"))
		: undefined;
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	response.on("close", () => {
		void transport.close();
	});
	await serverFor(token).connect(transport);
	await transport.handleRequest(request, response, body);
}).listen(port, "127.0.0.1", () => {
	console.log(`MCP live server on http://127.0.0.1:${port}/mcp`);
});
