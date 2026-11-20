import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { useTestFallbackTenant } from "@crm/db/tenancy";
import { TEST_ORGANIZATION } from "@crm/db/testing";
import integrations from "../agent/connections/integrations";

type ResolverContext = Parameters<
	NonNullable<(typeof integrations.events)["turn.started"]>
>[1];

function builderChat(organizationId: string): ResolverContext {
	const attributes = {
		purpose: "builder",
		commandType: "CHAT",
		userId: "integrations-user",
		organizationId,
	};
	const context = {
		session: { auth: { current: { attributes }, initiator: null } },
	};
	return context as unknown as ResolverContext;
}

beforeAll(() => useTestFallbackTenant(null));
afterAll(() => useTestFallbackTenant(TEST_ORGANIZATION.id));

describe("the chat integrations resolver", () => {
	it("builds the connections without a fallback workspace", async () => {
		const resolve = integrations.events["turn.started"];
		if (!resolve) throw new Error("turn.started is not handled.");

		const connections = await resolve(
			{ type: "turn.started" } as Parameters<typeof resolve>[0],
			builderChat(TEST_ORGANIZATION.id),
		);

		expect(connections).not.toBeNull();
		expect(Object.keys(connections ?? {}).length).toBeGreaterThan(0);
	});
});
