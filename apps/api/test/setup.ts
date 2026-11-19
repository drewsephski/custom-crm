import { afterAll } from "bun:test";
import { scopeTestsToTestOrganization } from "@crm/db/testing";

await scopeTestsToTestOrganization();

afterAll(async () => {
	if (!process.env.DATABASE_URL) return;
	const { db } = await import("@crm/db");
	await db.$disconnect();
});
