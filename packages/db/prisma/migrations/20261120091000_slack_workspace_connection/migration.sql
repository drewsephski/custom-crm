CREATE TABLE "slackConnection" (
    "organizationId" TEXT NOT NULL DEFAULT crm_current_org(),
    "teamId" TEXT NOT NULL,
    "teamName" TEXT,
    "botToken" TEXT NOT NULL,
    "botScopes" TEXT NOT NULL,
    "installerSlackUserId" TEXT NOT NULL,
    "installedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slackConnection_pkey" PRIMARY KEY ("organizationId")
);

CREATE INDEX "slackConnection_teamId_idx" ON "slackConnection"("teamId");

ALTER TABLE "slackConnection" ADD CONSTRAINT "slackConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slackConnection" ADD CONSTRAINT "slackConnection_installedById_fkey" FOREIGN KEY ("installedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "slackConnection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "slackConnection" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "slackConnection" TO crm_tenant;

CREATE TEMPORARY TABLE "slackConnectionBackfill" AS
SELECT DISTINCT ON (g."organizationId")
  g."organizationId",
  g."teamId",
  g."teamName",
  a."id" AS "accountId",
  a."accessToken",
  coalesce(a."scope", '') AS "botScopes",
  a."accountId" AS "installerSlackUserId",
  a."userId",
  a."createdAt",
  a."updatedAt"
FROM "slackWorkspaceGrant" g
JOIN "member" m
  ON m."organizationId" = g."organizationId" AND m."role" IN ('owner', 'admin')
JOIN "account" a
  ON a."userId" = m."userId" AND a."providerId" = 'slack' AND a."accessToken" IS NOT NULL
WHERE (
  SELECT count(*) FROM "member" o
  WHERE o."userId" = a."userId" AND o."role" IN ('owner', 'admin')
) = 1
ORDER BY g."organizationId", a."updatedAt" DESC, a."id";

INSERT INTO "slackConnection" ("organizationId", "teamId", "teamName", "botToken", "botScopes", "installerSlackUserId", "installedById", "createdAt", "updatedAt")
SELECT "organizationId", "teamId", "teamName", "accessToken", "botScopes", "installerSlackUserId", "userId", "createdAt", "updatedAt"
FROM "slackConnectionBackfill";

UPDATE "account" a
SET "accessToken" = NULL, "refreshToken" = NULL
FROM "slackConnectionBackfill" b
WHERE a."id" = b."accountId";

DROP TABLE "slackConnectionBackfill";

DROP TABLE "slackInstallation";

CREATE TABLE "slackInstallation" (
    "botTokenHash" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT,
    "userToken" TEXT,
    "userScopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slackInstallation_pkey" PRIMARY KEY ("botTokenHash", "installerId")
);

CREATE INDEX "slackInstallation_createdAt_idx" ON "slackInstallation"("createdAt");
GRANT SELECT, INSERT, UPDATE, DELETE ON "slackInstallation" TO crm_tenant;
