import { vendors } from "@crm/mcp-integrations/catalog";
import { defineDynamic } from "eve/connections";
import {
	buildChatMcpConnections,
	loadChatMcpConnections,
} from "../lib/chat-mcp";
import { attribute, purposeOf } from "../lib/session-purpose";
import { inSessionTenant } from "../lib/tenant-scope";

export default defineDynamic({
	events: {
		"turn.started": async (_event, ctx) => {
			if (
				purposeOf(ctx) !== "builder" ||
				attribute(ctx, "commandType") !== "CHAT"
			) {
				return null;
			}
			const userId = attribute(ctx, "userId");
			if (!userId) return null;
			return inSessionTenant(ctx, async () =>
				buildChatMcpConnections(
					vendors,
					await loadChatMcpConnections(),
					userId,
				),
			);
		},
	},
});
