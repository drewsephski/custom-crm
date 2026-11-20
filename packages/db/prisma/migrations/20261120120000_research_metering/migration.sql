CREATE TYPE "ResearchStatus" AS ENUM ('RESERVED', 'COMPLETE', 'PARTIAL', 'EMPTY', 'FAILED', 'REFUSED');

CREATE TYPE "ResearchReview" AS ENUM ('NONE', 'SUGGESTED', 'ACCEPTED', 'DISMISSED', 'VERIFIED');

ALTER TABLE "appSetting" ADD COLUMN "researchCreditLimit" INTEGER;

CREATE TABLE "researchResult" (
    "organizationId" TEXT NOT NULL DEFAULT crm_current_org(),
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" "ResearchStatus" NOT NULL DEFAULT 'RESERVED',
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "findings" JSONB,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "match" JSONB,
    "review" "ResearchReview" NOT NULL DEFAULT 'NONE',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "creditsReserved" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "taskId" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "researchResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platformResearchUsage" (
    "period" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "creditsReserved" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platformResearchUsage_pkey" PRIMARY KEY ("period","provider")
);

CREATE TABLE "providerCache" (
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providerCache_pkey" PRIMARY KEY ("provider","operation","key")
);

CREATE INDEX "researchResult_organizationId_createdAt_idx" ON "researchResult"("organizationId", "createdAt");

CREATE INDEX "researchResult_organizationId_provider_operation_requestKey_idx" ON "researchResult"("organizationId", "provider", "operation", "requestKey", "createdAt");

CREATE INDEX "researchResult_organizationId_userId_createdAt_idx" ON "researchResult"("organizationId", "userId", "createdAt");

CREATE INDEX "researchResult_companyId_idx" ON "researchResult"("companyId");

CREATE INDEX "researchResult_contactId_idx" ON "researchResult"("contactId");

CREATE UNIQUE INDEX "researchResult_one_in_flight" ON "researchResult"("organizationId", "provider", "operation", "requestKey") WHERE ("settledAt" IS NULL);

CREATE INDEX "providerCache_expiresAt_idx" ON "providerCache"("expiresAt");

ALTER TABLE "researchResult" ADD CONSTRAINT "researchResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "researchResult" ADD CONSTRAINT "researchResult_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "researchResult" ADD CONSTRAINT "researchResult_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "researchResult" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "researchResult" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON "researchResult" TO crm_tenant;

CREATE TRIGGER "researchResult_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId", "contactId" ON "researchResult" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company', 'contactId', 'contact');

GRANT SELECT, INSERT, UPDATE, DELETE ON "platformResearchUsage" TO crm_tenant;

GRANT SELECT, INSERT, UPDATE, DELETE ON "providerCache" TO crm_tenant;
