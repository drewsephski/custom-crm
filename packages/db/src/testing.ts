import "@crm/env/load";

import type { ActivePipeline } from "./pipeline";
import { runAsSystem, runInTenant, useTestFallbackTenant } from "./tenancy";

export const TEST_ORGANIZATION = {
	id: "test-workspace",
	name: "Test Workspace",
	slug: "test-workspace",
} as const;

export async function ensureTestOrganization(
	organization: { id: string; name: string; slug: string } = TEST_ORGANIZATION,
): Promise<string> {
	const { db } = await import("./client");

	await runAsSystem("create a test organization", async () => {
		await db.organization.upsert({
			where: { id: organization.id },
			create: { ...organization, createdAt: new Date() },
			update: {},
		});
		await db.appSetting.upsert({
			where: { organizationId: organization.id },
			create: { organizationId: organization.id },
			update: {},
		});
	});
	await ensureTestPipeline(organization.id);
	return organization.id;
}

export async function ensureTestPipeline(
	organizationId: string,
): Promise<ActivePipeline> {
	const { db } = await import("./client");
	const { ensureActivePipeline } = await import("./pipeline");

	return runInTenant(organizationId, () =>
		db.$transaction((tx) => ensureActivePipeline(tx)),
	);
}

export async function testStageIds(
	organizationId: string,
): Promise<Record<string, string>> {
	const pipeline = await ensureTestPipeline(organizationId);
	return Object.fromEntries(
		pipeline.stages.map((stage) => [stage.key, stage.id]),
	);
}

export async function scopeTestsToTestOrganization(): Promise<void> {
	if (!process.env.TEST_DATABASE_URL) return;
	useTestFallbackTenant(await ensureTestOrganization());
}
