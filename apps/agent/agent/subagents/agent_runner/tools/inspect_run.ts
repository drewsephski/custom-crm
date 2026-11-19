import { defineTool } from "eve/tools";
import { z } from "zod";
import { runContext } from "../../../lib/run-runtime";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";
import { inSessionTenant } from "../../../lib/tenant-scope";

export default defineTool({
	description:
		"Read the immutable version manifest, trigger, approved scope, allowed actions, and current time for this run.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		return inSessionTenant(ctx, async () => {
			return runContext(requireTeamAgentAttribute(ctx, "runId"));
		});
	},
});
