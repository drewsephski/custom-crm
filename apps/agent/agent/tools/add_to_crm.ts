import { defineTool } from "eve/tools";
import { chatAdditionApproval } from "../lib/approval";
import { addToCrm, crmAddition } from "../lib/crm-create";
import { purposeOf, requireAttribute } from "../lib/session-purpose";
import { inSessionTenant } from "../lib/tenant-scope";

const CHAT_ONLY = "Records are added only from a CRM chat, when the user asks.";

export default defineTool({
	description:
		"Add a person, their company, or both to the CRM when the user asks you to. Research first and pass only what a source showed: a LinkedIn URL you read, a company domain you confirmed. It finds an existing contact by email or LinkedIn URL and an existing company by domain or name before creating anything, so calling it for someone already in the CRM links to the existing record. The new records belong to the user and the agent then enriches them.",
	inputSchema: crmAddition,
	approval: chatAdditionApproval,
	async execute(addition, ctx) {
		return inSessionTenant(ctx, async () => {
			if (purposeOf(ctx) !== "builder") throw new Error(CHAT_ONLY);
			return addToCrm(addition, requireAttribute(ctx, "userId"));
		});
	},
});
