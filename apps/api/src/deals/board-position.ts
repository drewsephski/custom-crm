import type { Prisma } from "@crm/db";
import { lockIdempotencyKeys } from "@crm/db/idempotency";
import { BOARD } from "./deals.config";

export async function lockBoardStages(
	tx: Prisma.TransactionClient,
	stageIds: string[],
): Promise<void> {
	await lockIdempotencyKeys(
		tx,
		stageIds.map((stageId) => `${BOARD.lock.prefix}:${stageId}`),
	);
}

export async function appendStageDeals(
	tx: Prisma.TransactionClient,
	fromStageId: string,
	toStageId: string,
	now: Date,
): Promise<number> {
	return tx.$executeRaw`
		UPDATE deal
		SET "stageId" = ${toStageId},
			"boardPosition" = tail.position
				+ ranked.rank * ${BOARD.position.step}::double precision,
			"updatedAt" = ${now}
		FROM (
			SELECT id, row_number() OVER (
				ORDER BY "boardPosition" ASC, "createdAt" DESC, id ASC
			) AS rank
			FROM deal
			WHERE "stageId" = ${fromStageId}
		) ranked
		CROSS JOIN (
			SELECT COALESCE(MAX("boardPosition"), 0) AS position
			FROM deal
			WHERE "stageId" = ${toStageId}
		) tail
		WHERE deal.id = ranked.id
	`;
}
