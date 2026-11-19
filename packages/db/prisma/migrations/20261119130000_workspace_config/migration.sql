-- CreateEnum
CREATE TYPE "WorkspaceConfigStatus" AS ENUM ('GENERATING', 'PROPOSED', 'APPLIED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkspaceConfigSource" AS ENUM ('TEMPLATE', 'AI');

-- CreateTable
CREATE TABLE "workspaceConfigVersion" (
    "organizationId" TEXT NOT NULL DEFAULT crm_current_org(),
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkspaceConfigStatus" NOT NULL,
    "source" "WorkspaceConfigSource" NOT NULL,
    "profile" JSONB NOT NULL,
    "config" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaceConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspaceConfigVersion_organizationId_status_idx" ON "workspaceConfigVersion"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspaceConfigVersion_organizationId_version_key" ON "workspaceConfigVersion"("organizationId", "version");

-- AddForeignKey
ALTER TABLE "workspaceConfigVersion" ADD CONSTRAINT "workspaceConfigVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "workspaceConfigVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspaceConfigVersion" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "workspaceConfigVersion" TO crm_tenant;
