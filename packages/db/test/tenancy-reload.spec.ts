import "@crm/env/load";

import { describe, expect, it } from "bun:test";
import { db } from "../src/client";
import { currentOrganizationId, runInTenant } from "../src/tenancy";

type Tenancy = typeof import("../src/tenancy");

async function reloadedTenancy(): Promise<Tenancy> {
	return import(`../src/tenancy.ts?reload=${crypto.randomUUID()}`);
}

describe("a hot reload of the tenancy module", () => {
	it("loads a second copy of the module", async () => {
		const reloaded = await reloadedTenancy();

		expect(reloaded.runInTenant).not.toBe(runInTenant);
	});

	it("shares one scope store with the copy it replaces", async () => {
		const reloaded = await reloadedTenancy();

		const seen = await reloaded.runInTenant("org_reloaded", () =>
			currentOrganizationId(),
		);

		expect(seen).toBe("org_reloaded");
	});

	it("scopes the kept database client from the reloaded copy", async () => {
		const reloaded = await reloadedTenancy();

		const rows = await reloaded.runInTenant(
			"org_reloaded",
			() =>
				db.$queryRaw<
					{ org: string }[]
				>`SELECT current_setting('crm.organization_id', true) AS org`,
		);

		expect(rows).toEqual([{ org: "org_reloaded" }]);
	});
});
