import "@crm/env/load";

import { afterAll, describe, expect, it } from "bun:test";
import { SCOPE_SQL } from "../src/scoped-adapter";
import { createTenantPool } from "../src/tenant-pool";

const pool = createTenantPool(process.env.TEST_DATABASE_URL ?? "");

afterAll(() => pool.end());

describe("the tenant pool", () => {
	it("sets the tenant role and workspace inside the transaction it opens", async () => {
		const client = await pool.connect();
		try {
			await client.query({ text: "BEGIN" });
			await client.query({ text: SCOPE_SQL, values: ["org_fused_1"] });
			const inside = await client.query(
				"SELECT current_user AS role, current_setting('crm.organization_id', true) AS org",
			);
			expect(inside.rows[0]).toEqual({
				role: "crm_tenant",
				org: "org_fused_1",
			});
			await client.query({ text: "COMMIT" });

			const after = await client.query(
				"SELECT current_user AS role, coalesce(current_setting('crm.organization_id', true), '') AS org",
			);
			expect(after.rows[0]?.role).not.toBe("crm_tenant");
			expect(after.rows[0]?.org).toBe("");
		} finally {
			client.release();
		}
	});

	it("leaves a system transaction unscoped", async () => {
		const client = await pool.connect();
		try {
			await client.query({ text: "BEGIN" });
			const inside = await client.query(
				"SELECT current_user AS role, now() = statement_timestamp() AS fresh",
			);
			expect(inside.rows[0]?.role).not.toBe("crm_tenant");
			const status = await client.query(
				"SELECT count(*)::int AS open FROM pg_stat_activity WHERE pid = pg_backend_pid() AND state = 'active' AND xact_start IS NOT NULL",
			);
			expect(status.rows[0]?.open).toBe(1);
			await client.query({ text: "ROLLBACK" });
		} finally {
			client.release();
		}
	});

	it("binds a value that is not a workspace id as a parameter, never as SQL", async () => {
		const hostile = "x'); DROP TABLE deal; --";
		const client = await pool.connect();
		try {
			await client.query({ text: "BEGIN" });
			await client.query({ text: SCOPE_SQL, values: [hostile] });
			const inside = await client.query(
				"SELECT current_setting('crm.organization_id', true) AS org",
			);
			expect(inside.rows[0]?.org).toBe(hostile);
			await client.query({ text: "ROLLBACK" });
			const deals = await client.query(
				"SELECT to_regclass('public.deal') AS t",
			);
			expect(deals.rows[0]?.t).toBe("deal");
		} finally {
			client.release();
		}
	});

	it("does not carry a deferred begin into the next checkout", async () => {
		const first = await pool.connect();
		await first.query({ text: "BEGIN" });
		first.release();

		const second = await pool.connect();
		try {
			const result = await second.query("SELECT 1 AS one");
			expect(result.rows[0]).toEqual({ one: 1 });
			const open = await second.query(
				"SELECT xact_start IS NOT NULL AND xact_start < statement_timestamp() AS inherited FROM pg_stat_activity WHERE pid = pg_backend_pid()",
			);
			expect(open.rows[0]?.inherited).toBe(false);
		} finally {
			second.release();
		}
	});
});
