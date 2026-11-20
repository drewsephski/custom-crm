import { requireOrganizationId } from "@crm/db/tenancy";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import type { WorkspaceLive } from "./workspace.contracts";

type MembershipSignal = { id: string; state: string };

const MEMBERSHIP_SIGNAL_SQL = `
SELECT 'member:' || member.id AS id, member.role AS state
FROM member
WHERE member."organizationId" = $1
  AND EXISTS (
    SELECT 1 FROM member AS viewer
    WHERE viewer."organizationId" = $1 AND viewer."userId" = $2
  )
UNION ALL
SELECT 'invitation:' || invitation.id AS id, invitation.status AS state
FROM invitation
WHERE invitation."organizationId" = $1
  AND EXISTS (
    SELECT 1 FROM member AS viewer
    WHERE viewer."organizationId" = $1
      AND viewer."userId" = $2
      AND viewer.role IN ('owner', 'admin')
  )`;

const RESEARCH_SIGNAL_SQL = `
 SELECT r.id,r."updatedAt"::text AS state FROM "researchResult" r
 WHERE r."organizationId"=$1 AND (r."companyId"=$3 OR r."contactId"=$4)
 AND EXISTS(SELECT 1 FROM member m WHERE m."organizationId"=$1 AND m."userId"=$2)
 ORDER BY r."createdAt" DESC LIMIT 20`;

function databaseName(url: string): string | null {
	try {
		return new URL(url).pathname.replace(/^\//, "") || null;
	} catch {
		return null;
	}
}

@Injectable()
export class WorkspaceLiveService {
	private readonly url: string | undefined;
	private readonly secret: string | undefined;
	private readonly database: string | null;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.url = config.get("NEON_REALTIME_URL", { infer: true })?.trim();
		this.secret = config.get("NEON_REALTIME_SECRET", { infer: true })?.trim();
		this.database = databaseName(config.get("DATABASE_URL", { infer: true }));
	}

	membership(userId: string) {
		return this.seal(MEMBERSHIP_SIGNAL_SQL, [requireOrganizationId(), userId]);
	}
	research(userId: string, record: { companyId?: string; contactId?: string }) {
		return this.seal(RESEARCH_SIGNAL_SQL, [
			requireOrganizationId(),
			userId,
			record.companyId ?? null,
			record.contactId ?? null,
		]);
	}
	private async seal(
		sql: string,
		params: (string | null)[],
	): Promise<WorkspaceLive> {
		if (!this.url || !this.secret || !this.database) return null;

		const realtime = createRealtime({
			secret: this.secret,
			db: this.database,
		});
		const sealedQuery = await realtime.seal({
			query: rawSql<MembershipSignal>(sql, params),
		});

		return {
			url: this.url,
			sealedQuery: {
				capability: sealedQuery.capability,
				queryFingerprint: sealedQuery.queryFingerprint,
				expiresAt: sealedQuery.expiresAt,
			},
		};
	}
}
