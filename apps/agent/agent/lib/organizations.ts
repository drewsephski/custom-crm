import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";

export async function organizationIds(): Promise<string[]> {
	const rows = await runAsSystem(
		"list every workspace for an agent sweep",
		() =>
			db.organization.findMany({
				select: { id: true },
				orderBy: { id: "asc" },
			}),
	);
	return rows.map((row) => row.id);
}

export async function forEachOrganization<T>(
	job: string,
	work: (organizationId: string) => Promise<T>,
): Promise<T[]> {
	const results: T[] = [];

	for (const organizationId of await organizationIds()) {
		try {
			results.push(
				await runInTenant(organizationId, () => work(organizationId)),
			);
		} catch (error) {
			console.error(
				`[agent] ${job} failed for workspace ${organizationId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	return results;
}

export async function organizationOfRun(runId: string): Promise<string | null> {
	const row = await runAsSystem("find the workspace of an agent run", () =>
		db.agentRun.findUnique({
			where: { id: runId },
			select: { organizationId: true },
		}),
	);
	return row?.organizationId ?? null;
}

export async function organizationOfSubmission(
	submissionId: string,
): Promise<string | null> {
	const row = await runAsSystem("find the workspace of a builder message", () =>
		db.agentConversationSubmission.findUnique({
			where: { id: submissionId },
			select: { organizationId: true },
		}),
	);
	return row?.organizationId ?? null;
}

export async function inOrganizationOf<T>(
	organizationId: string | null,
	what: string,
	work: () => Promise<T>,
): Promise<T> {
	if (!organizationId) {
		throw new Error(`${what} does not exist, or belongs to no workspace.`);
	}
	return runInTenant(organizationId, work);
}

export async function organizationOfConversation(
	conversationId: string,
): Promise<string | null> {
	const row = await runAsSystem("find the workspace of a conversation", () =>
		db.agentConversation.findUnique({
			where: { id: conversationId },
			select: { organizationId: true },
		}),
	);
	return row?.organizationId ?? null;
}
