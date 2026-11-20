CREATE TYPE "OnboardingBrandStatus" AS ENUM ('IDLE', 'READY', 'NOT_FOUND', 'UNAVAILABLE', 'FAILED');

CREATE TABLE "onboardingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "step" TEXT NOT NULL DEFAULT 'business-type',
    "businessType" TEXT,
    "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessName" TEXT,
    "website" TEXT,
    "details" JSONB,
    "brand" JSONB,
    "brandStatus" "OnboardingBrandStatus" NOT NULL DEFAULT 'IDLE',
    "brandDomain" TEXT,
    "brandLookups" INTEGER NOT NULL DEFAULT 0,
    "brandLookupAt" TIMESTAMP(3),
    "presetKey" TEXT,
    "config" JSONB,
    "configVersionId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboardingSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboardingSession_userId_idx" ON "onboardingSession"("userId");

CREATE INDEX "onboardingSession_organizationId_idx" ON "onboardingSession"("organizationId");

CREATE UNIQUE INDEX "onboardingSession_one_open_per_user" ON "onboardingSession"("userId") WHERE ("completedAt" IS NULL);

ALTER TABLE "onboardingSession" ADD CONSTRAINT "onboardingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "onboardingSession" ADD CONSTRAINT "onboardingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "onboardingSession" TO crm_tenant;
