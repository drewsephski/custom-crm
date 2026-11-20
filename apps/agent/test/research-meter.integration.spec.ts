import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { researchPeriod } from "@crm/db/research-budget";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { ensureTestOrganization } from "@crm/db/testing";
import { metered } from "../agent/lib/research/meter";
import { RESEARCH } from "../agent/lib/research/research-config";
import { recoverExpiredReservations } from "../agent/lib/research/reservations";

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

it("retries an interrupted lookup and settles a late provider response once", async () => {
	const id = randomUUID();
	await ensureTestOrganization({ id, name: id, slug: id });
	try {
		await runInTenant(id, async () => {
			const contact = await db.contact.create({
				data: { firstName: "Research", email: id + "@example.test" },
			});
			const options = {
				operation: "people.enrich" as const,
				key: id,
				target: { contactId: contact.id },
			};
			const entered = Promise.withResolvers<void>();
			const finish = Promise.withResolvers<{
				key_metadata: { credits_consumed: number };
				match: { status: "not_found" };
			}>();
			const platform = () =>
				db.platformResearchUsage.findUnique({
					where: {
						period_provider: {
							period: researchPeriod(),
							provider: RESEARCH.provider,
						},
					},
				});
			const before = await platform();
			const first = metered(options, async () => {
				entered.resolve();
				return finish.promise;
			});
			try {
				await Promise.race([entered.promise, first]);
				const booked = await db.researchResult.findFirstOrThrow({
					where: { contactId: contact.id, settledAt: null },
				});
				await recoverExpiredReservations(
					new Date(booked.createdAt.getTime() + RESEARCH.reservation.ttlMs),
				);
				const expired = await db.researchResult.findUniqueOrThrow({
					where: { id: booked.id },
				});
				expect(expired).toMatchObject({
					status: "FAILED",
					error: "reservation-expired",
					creditsReserved: 0,
					creditsUsed: 20,
				});
				await metered(options, async () => ({
					key_metadata: { credits_consumed: 3 },
					match: {
						status: "candidate",
						score: 86,
						person: {
							social_urls: ["https://linkedin.com/in/test-contact"],
							current_role: { title: "Designer" },
						},
					},
				}));
			} finally {
				finish.resolve({
					key_metadata: { credits_consumed: 7 },
					match: { status: "not_found" },
				});
				await first;
			}
			const after = await platform();
			expect(after?.creditsReserved).toBe(before?.creditsReserved ?? 0);
			expect(after?.creditsUsed).toBe((before?.creditsUsed ?? 0) + 10);
			const rows = await db.researchResult.findMany({
				where: { contactId: contact.id },
			});
			expect(rows.find((row) => row.creditsUsed === 3)?.sources).toEqual([
				{
					url: "https://www.linkedin.com/in/test-contact",
					title: "Candidate profile",
				},
			]);
			expect(rows.map((row) => row.creditsUsed).sort()).toEqual([3, 7]);
			expect(rows.every((row) => row.status === "COMPLETE" && !row.error)).toBe(
				true,
			);
		});
	} finally {
		await runAsSystem("remove research recovery test workspace", () =>
			db.organization.delete({ where: { id } }),
		);
	}
});
