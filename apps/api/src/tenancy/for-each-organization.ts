import type { Db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import type { Logger } from "@nestjs/common";

export type OrganizationOutcome<T> =
	| { organizationId: string; ok: true; value: T }
	| { organizationId: string; ok: false; error: string };

export async function organizationIds(db: Db): Promise<string[]> {
	const rows = await runAsSystem("list every workspace for a sweep", () =>
		db.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
	);
	return rows.map((row) => row.id);
}

export async function forEachOrganization<T>(
	db: Db,
	logger: Logger,
	job: string,
	work: (organizationId: string) => Promise<T>,
): Promise<OrganizationOutcome<T>[]> {
	const outcomes: OrganizationOutcome<T>[] = [];

	for (const organizationId of await organizationIds(db)) {
		try {
			const value = await runInTenant(organizationId, () =>
				work(organizationId),
			);
			outcomes.push({ organizationId, ok: true, value });
		} catch (error) {
			logger.error(
				{ message: `${job} failed for one workspace`, organizationId },
				error instanceof Error ? error.stack : String(error),
			);
			outcomes.push({
				organizationId,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return outcomes;
}
