import { describe, expect, it } from "bun:test";
import { TEST_ORGANIZATION } from "@crm/db/testing";
import { builderTaskMarkdown } from "../agent/instructions/task";
import { chatAdditionApproval } from "../agent/lib/approval";
import addToCrmTool from "../agent/tools/add_to_crm";

type ToolContext = Parameters<NonNullable<typeof addToCrmTool.execute>>[1];

function session(purpose: string, commandType: string): ToolContext {
	const attributes = {
		purpose,
		commandType,
		userId: "add-to-crm-user",
		organizationId: TEST_ORGANIZATION.id,
	};
	const context = {
		session: { auth: { current: { attributes }, initiator: null } },
	};
	return context as unknown as ToolContext;
}

describe("the add_to_crm tool", () => {
	const execute = addToCrmTool.execute;
	if (!execute) throw new Error("add_to_crm has no execute.");
	const company = { company: { name: "Guarded Co", domain: null } };

	it("refuses a research session", async () => {
		await expect(execute(company, session("research", ""))).rejects.toThrow(
			"Records are added only from a CRM chat",
		);
	});

	it("asks the chat user to approve, including when the Approve click resumes the call", async () => {
		const approval = (purpose: string, commandType: string, mode: string) =>
			chatAdditionApproval({
				...session(purpose, commandType),
				session: {
					auth: {
						current: {
							attributes: {
								purpose,
								commandType,
								permissionMode: mode,
								organizationId: TEST_ORGANIZATION.id,
							},
						},
						initiator: null,
					},
				},
			} as unknown as Parameters<typeof chatAdditionApproval>[0]);

		expect(await approval("builder", "CHAT", "manual")).toBe("user-approval");
		expect(await approval("builder", "CHAT", "auto")).toBe("approved");
		expect(await approval("builder", "CREATE_AGENT", "manual")).toBe(
			"user-approval",
		);
		expect(await approval("research", "", "bypass")).toMatchObject({
			type: "denied",
		});
		expect(await approval("team-agent", "", "bypass")).toMatchObject({
			type: "denied",
		});
	});

	it("is the one CRM write the chat instructions allow", () => {
		const chat = builderTaskMarkdown("CHAT");

		expect(chat).toContain("call add_to_crm once");
		expect(chat).toContain("read_linkedin_profile");
		expect(chat).toContain("change CRM records on this turn in any other way");
		expect(builderTaskMarkdown("CREATE_AGENT")).not.toContain("add_to_crm");
	});
});
