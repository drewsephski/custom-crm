import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { ensureTestOrganization } from "@crm/db/testing";
import { metered } from "../agent/lib/research/meter";

it("reserves once across concurrent requests and isolates sourced results", async () => {
	const id = randomUUID(),
		other = randomUUID();
	for (const org of [id, other])
		await ensureTestOrganization({ id: org, name: org, slug: org });
	try {
		const row = await runInTenant(id, async () => {
			await db.appSetting.update({
				where: { organizationId: id },
				data: { researchCreditLimit: 10 },
			});
			const company = await db.company.create({
				data: { name: "Test Company", domain: "example.org" },
			});
			let calls = 0;
			const lookup = (key: string) =>
				metered(
					{
						operation: "brand.retrieve",
						key,
						domain: "example.org",
						target: { companyId: company.id },
					},
					async () => {
						calls++;
						return {
							key_metadata: { credits_consumed: 10 },
							brand: {
								title: "Test Company",
								domain: "example.org",
								description: "Reviewed company details.",
							},
						};
					},
				);
			const outcomes = await Promise.allSettled([
				lookup("first"),
				lookup("second"),
			]);
			expect(calls).toBe(1);
			expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
			const row = await db.researchResult.findFirstOrThrow({
				where: { companyId: company.id, status: "COMPLETE" },
			});
			expect(row.creditsUsed).toBe(10);
			expect(row.sources).toEqual([
				{ url: "https://example.org/", title: "Test Company" },
			]);
			return row;
		});
		await runInTenant(other, async () =>
			expect(
				await db.researchResult.findUnique({ where: { id: row.id } }),
			).toBeNull(),
		);
	} finally {
		await runAsSystem("remove research test workspaces", () =>
			db.organization.deleteMany({ where: { id: { in: [id, other] } } }),
		);
	}
});
