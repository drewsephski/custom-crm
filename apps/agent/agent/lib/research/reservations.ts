import { db } from "@crm/db";
import { researchPeriod } from "@crm/db/research-budget";
import { runAsSystem } from "@crm/db/tenancy";
import { RESEARCH } from "./research-config";

type Request = {
	organizationId: string;
	operation: string;
	requestKey: string;
};

function groupBy<T, K>(rows: Iterable<T>, keyFor: (row: T) => K) {
	const groups = new Map<K, T[]>();
	for (const row of rows) {
		const key = keyFor(row);
		const group = groups.get(key);
		if (group) group.push(row);
		else groups.set(key, [row]);
	}
	return groups;
}

export function recoverExpiredReservations(now: Date, request?: Request) {
	return runAsSystem(
		"settle expired provider credit reservations",
		async () => {
			const where = {
				provider: RESEARCH.provider,
				settledAt: null,
				createdAt: {
					lte: new Date(now.getTime() - RESEARCH.reservation.ttlMs),
				},
			};
			const select = {
				id: true,
				createdAt: true,
				creditsReserved: true,
			} as const;
			const [oldest, matching] = await Promise.all([
				db.researchResult.findMany({
					where,
					select,
					orderBy: { createdAt: "asc" },
					take: RESEARCH.reservation.batchSize,
				}),
				request
					? db.researchResult.findFirst({
							where: { ...where, ...request },
							select,
						})
					: null,
			]);
			const rows = new Map(oldest.map((row) => [row.id, row]));
			if (matching) rows.set(matching.id, matching);
			const groups = groupBy(rows.values(), (row) =>
				researchPeriod(row.createdAt),
			);
			for (const [period, reservations] of groups) {
				await db.$transaction(async (tx) => {
					const platform = {
						period_provider: { period, provider: RESEARCH.provider },
					};
					await tx.platformResearchUsage.update({
						where: platform,
						data: { requests: { increment: 0 } },
					});
					let used = 0;
					for (const [estimate, batch] of groupBy(
						reservations,
						(row) => row.creditsReserved,
					)) {
						const { count } = await tx.researchResult.updateMany({
							where: { ...where, id: { in: batch.map((row) => row.id) } },
							data: {
								creditsUsed: estimate || undefined,
								creditsReserved: 0,
								settledAt: now,
								status: "FAILED",
								error: "reservation-expired",
							},
						});
						used += count * estimate;
					}
					await tx.platformResearchUsage.update({
						where: platform,
						data: {
							creditsUsed: { increment: used },
							creditsReserved: { decrement: used },
						},
					});
				});
			}
		},
	);
}
