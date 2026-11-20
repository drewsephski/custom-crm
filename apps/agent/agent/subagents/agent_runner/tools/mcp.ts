import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
	authorizeMcpTool,
	callMcpTool,
	mcpModelOutput,
	runMcpGrants,
} from "../../../lib/mcp-runtime";
import { attribute, purposeOf } from "../../../lib/session-purpose";
import { inSessionTenant } from "../../../lib/tenant-scope";

const inputSchema = z.record(z.string(), z.json());

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			if (purposeOf(ctx) !== "team-agent") return null;
			const runId = attribute(ctx, "runId");
			if (!runId) return null;
			const grants = await inSessionTenant(ctx, () => runMcpGrants(runId));
			if (grants.length === 0) return null;

			return Object.fromEntries(
				grants.map((grant) => {
					const organizationId = grant.organizationId;
					const platformSlug = grant.platformSlug;
					const connectionId = grant.connectionId;
					const toolName = grant.toolName;
					return [
						`${platformSlug}__${toolName}`,
						defineTool({
							description: grant.description,
							inputSchema: grant.inputSchema,
							approval: (context) =>
								inSessionTenant(context, () =>
									authorizeMcpTool(platformSlug, context),
								),
							async execute(arguments_, toolContext) {
								return inSessionTenant(toolContext, () =>
									callMcpTool({
										organizationId,
										connectionId,
										platformSlug,
										toolName,
										arguments: inputSchema.parse(arguments_),
									}),
								);
							},
							toModelOutput: mcpModelOutput,
						}),
					] as const;
				}),
			);
		},
	},
});
