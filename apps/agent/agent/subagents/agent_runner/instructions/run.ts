import { defineDynamic, defineInstructions } from "eve/instructions";
import { approvedRunInstructions } from "../../../lib/run-runtime";
import { attribute, purposeOf } from "../../../lib/session-purpose";
import { inSessionTenant } from "../../../lib/tenant-scope";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			if (purposeOf(ctx) !== "team-agent") return null;
			const runId = attribute(ctx, "runId");
			if (!runId) return null;

			return defineInstructions({
				markdown: `# Human-approved version instructions\n\n${await inSessionTenant(ctx, () => approvedRunInstructions(runId))}`,
			});
		},
	},
});
