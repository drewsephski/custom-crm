-- Multi-tenancy: every CRM row belongs to one organization, and Postgres enforces it.
--
-- Read docs/tenancy.md before changing anything here. The short version:
--   * crm_current_org() is the organization of the running transaction, set by
--     packages/db/src/scoped-adapter.ts with set_config(..., true).
--   * Tenant work runs as the crm_tenant role, which row-level security filters.
--   * System work runs as the connecting role, which owns the tables and is not filtered.
--   * crm_assert_same_org() refuses a reference into another organization, because
--     foreign key checks bypass row-level security.
--
-- Existing rows belong to the single-tenant install's organization, "workspace".

CREATE OR REPLACE FUNCTION crm_current_org() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('crm.organization_id', true), '')
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_tenant') THEN
    CREATE ROLE crm_tenant NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT crm_tenant TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not grant crm_tenant to %: %. Grant it by hand, or tenant queries cannot switch role.', current_user, SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION crm_assert_same_org() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  position integer := 0;
  column_name text;
  target_table text;
  target_id text;
  previous_id text;
  matches boolean;
BEGIN
  WHILE position < TG_NARGS LOOP
    column_name := TG_ARGV[position];
    target_table := TG_ARGV[position + 1];
    position := position + 2;

    EXECUTE format('SELECT ($1).%I::text', column_name) USING NEW INTO target_id;
    CONTINUE WHEN target_id IS NULL;

    IF TG_OP = 'UPDATE' THEN
      EXECUTE format('SELECT ($1).%I::text', column_name) USING OLD INTO previous_id;
      CONTINUE WHEN previous_id IS NOT DISTINCT FROM target_id
        AND OLD."organizationId" = NEW."organizationId";
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND "organizationId" = $2)', target_table)
      USING target_id, NEW."organizationId" INTO matches;

    IF NOT matches THEN
      RAISE EXCEPTION '%.% points at a % row outside organization %', TG_TABLE_NAME, column_name, target_table, NEW."organizationId"
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- The legacy organization must exist before any row can point at it.
DO $$
DECLARE
  has_rows boolean := false;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company','companyEnrichment','contact','contactFact','contactBrief','agentTask','agentEvent','agentConversation','agentConversationFeedback','agentConversationShare','agentConversationSubmission','agentConversationAttachment','agentDefinition','agentVersion','agentBuilderArtifact','agentTrigger','agentRun','agentRunEvent','agentAction','agentAuditEvent','deal','dealContact','fieldDefinition','fieldOption','fieldValue','savedView','activity','mailboxSync','emailThread','emailMessage','calendarEvent','calendarAttendee','suppressedDomain','suppressedContact','trackedDomain','trackedVisitor','trackedEvent','trackedPageDaily','formSubmission','mcpToolSnapshot','slackMemberMatch','slackChannel','slackWorkspaceGrant','exchangeRate'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;
    EXIT WHEN has_rows;
  END LOOP;

  IF NOT has_rows THEN
    SELECT EXISTS (SELECT 1 FROM "workspaceProfile") INTO has_rows;
  END IF;

  IF has_rows AND NOT EXISTS (SELECT 1 FROM "organization" WHERE id = 'workspace') THEN
    INSERT INTO "organization" (id, name, slug, "createdAt")
    VALUES ('workspace', 'CRM', 'workspace', now());
  END IF;
END $$;

-- appSetting and workspaceProfile were singletons keyed by a constant. They are now keyed by organization.
DELETE FROM "appSetting" WHERE NOT EXISTS (SELECT 1 FROM "organization" WHERE id = 'workspace');
ALTER TABLE "appSetting" RENAME COLUMN "id" TO "organizationId";
UPDATE "appSetting" SET "organizationId" = 'workspace';
ALTER TABLE "appSetting" ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "workspaceProfile" RENAME COLUMN "id" TO "organizationId";
DELETE FROM "workspaceProfile" WHERE "organizationId" NOT IN (SELECT id FROM "organization");
ALTER TABLE "workspaceProfile" ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "mcpConnection" ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "mcpOauthState" ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();

-- Add the tenant key, backfill it, then require it.
ALTER TABLE "company" ADD COLUMN "organizationId" TEXT;
UPDATE "company" SET "organizationId" = 'workspace';
ALTER TABLE "company" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "companyEnrichment" ADD COLUMN "organizationId" TEXT;
UPDATE "companyEnrichment" SET "organizationId" = 'workspace';
ALTER TABLE "companyEnrichment" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "contact" ADD COLUMN "organizationId" TEXT;
UPDATE "contact" SET "organizationId" = 'workspace';
ALTER TABLE "contact" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "contactFact" ADD COLUMN "organizationId" TEXT;
UPDATE "contactFact" SET "organizationId" = 'workspace';
ALTER TABLE "contactFact" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "contactBrief" ADD COLUMN "organizationId" TEXT;
UPDATE "contactBrief" SET "organizationId" = 'workspace';
ALTER TABLE "contactBrief" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentTask" ADD COLUMN "organizationId" TEXT;
UPDATE "agentTask" SET "organizationId" = 'workspace';
ALTER TABLE "agentTask" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "agentEvent" SET "organizationId" = 'workspace';
ALTER TABLE "agentEvent" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentConversation" ADD COLUMN "organizationId" TEXT;
UPDATE "agentConversation" SET "organizationId" = 'workspace';
ALTER TABLE "agentConversation" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentConversationFeedback" ADD COLUMN "organizationId" TEXT;
UPDATE "agentConversationFeedback" SET "organizationId" = 'workspace';
ALTER TABLE "agentConversationFeedback" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentConversationShare" ADD COLUMN "organizationId" TEXT;
UPDATE "agentConversationShare" SET "organizationId" = 'workspace';
ALTER TABLE "agentConversationShare" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentConversationSubmission" ADD COLUMN "organizationId" TEXT;
UPDATE "agentConversationSubmission" SET "organizationId" = 'workspace';
ALTER TABLE "agentConversationSubmission" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentConversationAttachment" ADD COLUMN "organizationId" TEXT;
UPDATE "agentConversationAttachment" SET "organizationId" = 'workspace';
ALTER TABLE "agentConversationAttachment" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentDefinition" ADD COLUMN "organizationId" TEXT;
UPDATE "agentDefinition" SET "organizationId" = 'workspace';
ALTER TABLE "agentDefinition" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentVersion" ADD COLUMN "organizationId" TEXT;
UPDATE "agentVersion" SET "organizationId" = 'workspace';
ALTER TABLE "agentVersion" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentBuilderArtifact" ADD COLUMN "organizationId" TEXT;
UPDATE "agentBuilderArtifact" SET "organizationId" = 'workspace';
ALTER TABLE "agentBuilderArtifact" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentTrigger" ADD COLUMN "organizationId" TEXT;
UPDATE "agentTrigger" SET "organizationId" = 'workspace';
ALTER TABLE "agentTrigger" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentRun" ADD COLUMN "organizationId" TEXT;
UPDATE "agentRun" SET "organizationId" = 'workspace';
ALTER TABLE "agentRun" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentRunEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "agentRunEvent" SET "organizationId" = 'workspace';
ALTER TABLE "agentRunEvent" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentAction" ADD COLUMN "organizationId" TEXT;
UPDATE "agentAction" SET "organizationId" = 'workspace';
ALTER TABLE "agentAction" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "agentAuditEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "agentAuditEvent" SET "organizationId" = 'workspace';
ALTER TABLE "agentAuditEvent" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "deal" ADD COLUMN "organizationId" TEXT;
UPDATE "deal" SET "organizationId" = 'workspace';
ALTER TABLE "deal" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "dealContact" ADD COLUMN "organizationId" TEXT;
UPDATE "dealContact" SET "organizationId" = 'workspace';
ALTER TABLE "dealContact" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "fieldDefinition" ADD COLUMN "organizationId" TEXT;
UPDATE "fieldDefinition" SET "organizationId" = 'workspace';
ALTER TABLE "fieldDefinition" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "fieldOption" ADD COLUMN "organizationId" TEXT;
UPDATE "fieldOption" SET "organizationId" = 'workspace';
ALTER TABLE "fieldOption" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "fieldValue" ADD COLUMN "organizationId" TEXT;
UPDATE "fieldValue" SET "organizationId" = 'workspace';
ALTER TABLE "fieldValue" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "savedView" ADD COLUMN "organizationId" TEXT;
UPDATE "savedView" SET "organizationId" = 'workspace';
ALTER TABLE "savedView" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "activity" ADD COLUMN "organizationId" TEXT;
UPDATE "activity" SET "organizationId" = 'workspace';
ALTER TABLE "activity" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "mailboxSync" ADD COLUMN "organizationId" TEXT;
UPDATE "mailboxSync" SET "organizationId" = 'workspace';
ALTER TABLE "mailboxSync" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "emailThread" ADD COLUMN "organizationId" TEXT;
UPDATE "emailThread" SET "organizationId" = 'workspace';
ALTER TABLE "emailThread" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "emailMessage" ADD COLUMN "organizationId" TEXT;
UPDATE "emailMessage" SET "organizationId" = 'workspace';
ALTER TABLE "emailMessage" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "calendarEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "calendarEvent" SET "organizationId" = 'workspace';
ALTER TABLE "calendarEvent" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "calendarAttendee" ADD COLUMN "organizationId" TEXT;
UPDATE "calendarAttendee" SET "organizationId" = 'workspace';
ALTER TABLE "calendarAttendee" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "suppressedDomain" ADD COLUMN "organizationId" TEXT;
UPDATE "suppressedDomain" SET "organizationId" = 'workspace';
ALTER TABLE "suppressedDomain" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "suppressedContact" ADD COLUMN "organizationId" TEXT;
UPDATE "suppressedContact" SET "organizationId" = 'workspace';
ALTER TABLE "suppressedContact" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "trackedDomain" ADD COLUMN "organizationId" TEXT;
UPDATE "trackedDomain" SET "organizationId" = 'workspace';
ALTER TABLE "trackedDomain" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "trackedVisitor" ADD COLUMN "organizationId" TEXT;
UPDATE "trackedVisitor" SET "organizationId" = 'workspace';
ALTER TABLE "trackedVisitor" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "trackedEvent" ADD COLUMN "organizationId" TEXT;
UPDATE "trackedEvent" SET "organizationId" = 'workspace';
ALTER TABLE "trackedEvent" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "trackedPageDaily" ADD COLUMN "organizationId" TEXT;
UPDATE "trackedPageDaily" SET "organizationId" = 'workspace';
ALTER TABLE "trackedPageDaily" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "formSubmission" ADD COLUMN "organizationId" TEXT;
UPDATE "formSubmission" SET "organizationId" = 'workspace';
ALTER TABLE "formSubmission" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "mcpToolSnapshot" ADD COLUMN "organizationId" TEXT;
UPDATE "mcpToolSnapshot" SET "organizationId" = 'workspace';
ALTER TABLE "mcpToolSnapshot" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "slackMemberMatch" ADD COLUMN "organizationId" TEXT;
UPDATE "slackMemberMatch" SET "organizationId" = 'workspace';
ALTER TABLE "slackMemberMatch" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "slackChannel" ADD COLUMN "organizationId" TEXT;
UPDATE "slackChannel" SET "organizationId" = 'workspace';
ALTER TABLE "slackChannel" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "slackWorkspaceGrant" ADD COLUMN "organizationId" TEXT;
UPDATE "slackWorkspaceGrant" SET "organizationId" = 'workspace';
ALTER TABLE "slackWorkspaceGrant" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();
ALTER TABLE "exchangeRate" ADD COLUMN "organizationId" TEXT;
UPDATE "exchangeRate" SET "organizationId" = 'workspace';
ALTER TABLE "exchangeRate" ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "organizationId" SET DEFAULT crm_current_org();

-- Uniqueness is per organization.
-- DropIndex
DROP INDEX "calendarEvent_iCalUid_originalStartTime_key";

-- DropIndex
DROP INDEX "company_domain_active_key";

-- DropIndex
DROP INDEX "contact_email_active_key";

-- DropIndex
DROP INDEX "emailMessage_rfcMessageId_key";

-- DropIndex
DROP INDEX "emailThread_rootMessageId_key";

-- DropIndex
DROP INDEX "exchangeRate_baseCurrency_quoteCurrency_idx";

-- DropIndex
DROP INDEX "exchangeRate_baseCurrency_quoteCurrency_source_key";

-- DropIndex
DROP INDEX "fieldDefinition_entity_key_key";

-- DropIndex
DROP INDEX "formSubmission_createdAt_idx";

-- DropIndex
DROP INDEX "formSubmission_dedupeKey_key";

-- DropIndex
DROP INDEX "mailboxSync_userId_source_key";

-- DropIndex
DROP INDEX "savedView_entity_ownerId_name_key";

-- DropIndex
DROP INDEX "slackChannel_available_name_idx";

-- DropIndex
DROP INDEX "slackMemberMatch_crmUserId_key";

-- DropIndex
DROP INDEX "slackWorkspaceGrant_teamId_key";

-- DropIndex
DROP INDEX "trackedDomain_host_key";

-- DropIndex
DROP INDEX "trackedPageDaily_host_day_idx";







































-- AlterTable
ALTER TABLE "slackChannel" DROP CONSTRAINT "slackChannel_pkey",
ADD CONSTRAINT "slackChannel_pkey" PRIMARY KEY ("organizationId", "id");



-- AlterTable
ALTER TABLE "suppressedContact" DROP CONSTRAINT "suppressedContact_pkey",
ADD CONSTRAINT "suppressedContact_pkey" PRIMARY KEY ("organizationId", "email");

-- AlterTable
ALTER TABLE "suppressedDomain" DROP CONSTRAINT "suppressedDomain_pkey",
ADD CONSTRAINT "suppressedDomain_pkey" PRIMARY KEY ("organizationId", "domain");



-- AlterTable
ALTER TABLE "trackedPageDaily" DROP CONSTRAINT "trackedPageDaily_pkey",
ADD CONSTRAINT "trackedPageDaily_pkey" PRIMARY KEY ("organizationId", "day", "host", "path");

-- AlterTable
ALTER TABLE "trackedVisitor" DROP CONSTRAINT "trackedVisitor_pkey",
ADD CONSTRAINT "trackedVisitor_pkey" PRIMARY KEY ("organizationId", "id");


-- CreateIndex
CREATE INDEX "activity_organizationId_idx" ON "activity"("organizationId");

-- CreateIndex
CREATE INDEX "agentAction_organizationId_idx" ON "agentAction"("organizationId");

-- CreateIndex
CREATE INDEX "agentAuditEvent_organizationId_idx" ON "agentAuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "agentBuilderArtifact_organizationId_idx" ON "agentBuilderArtifact"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversation_organizationId_idx" ON "agentConversation"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationAttachment_organizationId_idx" ON "agentConversationAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationFeedback_organizationId_idx" ON "agentConversationFeedback"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationShare_organizationId_idx" ON "agentConversationShare"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationSubmission_organizationId_idx" ON "agentConversationSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "agentDefinition_organizationId_idx" ON "agentDefinition"("organizationId");

-- CreateIndex
CREATE INDEX "agentEvent_organizationId_idx" ON "agentEvent"("organizationId");

-- CreateIndex
CREATE INDEX "agentRun_organizationId_idx" ON "agentRun"("organizationId");

-- CreateIndex
CREATE INDEX "agentRunEvent_organizationId_idx" ON "agentRunEvent"("organizationId");

-- CreateIndex
CREATE INDEX "agentTask_organizationId_idx" ON "agentTask"("organizationId");

-- CreateIndex
CREATE INDEX "agentTrigger_organizationId_idx" ON "agentTrigger"("organizationId");

-- CreateIndex
CREATE INDEX "agentVersion_organizationId_idx" ON "agentVersion"("organizationId");

-- CreateIndex
CREATE INDEX "calendarAttendee_organizationId_idx" ON "calendarAttendee"("organizationId");

-- CreateIndex
CREATE INDEX "calendarEvent_organizationId_idx" ON "calendarEvent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "calendarEvent_organizationId_iCalUid_originalStartTime_key" ON "calendarEvent"("organizationId", "iCalUid", "originalStartTime");

-- CreateIndex
CREATE INDEX "company_organizationId_idx" ON "company"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "company_org_domain_active_key" ON "company"("organizationId", "domain") WHERE ("archivedAt" IS NULL);

-- CreateIndex
CREATE INDEX "companyEnrichment_organizationId_idx" ON "companyEnrichment"("organizationId");

-- CreateIndex
CREATE INDEX "contact_organizationId_idx" ON "contact"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_org_email_active_key" ON "contact"("organizationId", "email") WHERE ("archivedAt" IS NULL);

-- CreateIndex
CREATE INDEX "contactBrief_organizationId_idx" ON "contactBrief"("organizationId");

-- CreateIndex
CREATE INDEX "contactFact_organizationId_idx" ON "contactFact"("organizationId");

-- CreateIndex
CREATE INDEX "deal_organizationId_idx" ON "deal"("organizationId");

-- CreateIndex
CREATE INDEX "dealContact_organizationId_idx" ON "dealContact"("organizationId");

-- CreateIndex
CREATE INDEX "emailMessage_organizationId_idx" ON "emailMessage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "emailMessage_organizationId_rfcMessageId_key" ON "emailMessage"("organizationId", "rfcMessageId");

-- CreateIndex
CREATE INDEX "emailThread_organizationId_idx" ON "emailThread"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "emailThread_organizationId_rootMessageId_key" ON "emailThread"("organizationId", "rootMessageId");

-- CreateIndex
CREATE INDEX "exchangeRate_organizationId_baseCurrency_quoteCurrency_idx" ON "exchangeRate"("organizationId", "baseCurrency", "quoteCurrency");

-- CreateIndex
CREATE UNIQUE INDEX "exchangeRate_organizationId_baseCurrency_quoteCurrency_sour_key" ON "exchangeRate"("organizationId", "baseCurrency", "quoteCurrency", "source");

-- CreateIndex
CREATE INDEX "fieldDefinition_organizationId_idx" ON "fieldDefinition"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "fieldDefinition_organizationId_entity_key_key" ON "fieldDefinition"("organizationId", "entity", "key");

-- CreateIndex
CREATE INDEX "fieldOption_organizationId_idx" ON "fieldOption"("organizationId");

-- CreateIndex
CREATE INDEX "fieldValue_organizationId_idx" ON "fieldValue"("organizationId");

-- CreateIndex
CREATE INDEX "formSubmission_organizationId_createdAt_idx" ON "formSubmission"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "formSubmission_organizationId_dedupeKey_key" ON "formSubmission"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "mailboxSync_organizationId_idx" ON "mailboxSync"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxSync_organizationId_userId_source_key" ON "mailboxSync"("organizationId", "userId", "source");

-- CreateIndex
CREATE INDEX "mcpToolSnapshot_organizationId_idx" ON "mcpToolSnapshot"("organizationId");

-- CreateIndex
CREATE INDEX "savedView_organizationId_idx" ON "savedView"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "savedView_organizationId_entity_ownerId_name_key" ON "savedView"("organizationId", "entity", "ownerId", "name");

-- CreateIndex
CREATE INDEX "slackChannel_organizationId_available_name_idx" ON "slackChannel"("organizationId", "available", "name");

-- CreateIndex
CREATE UNIQUE INDEX "slackMemberMatch_organizationId_crmUserId_key" ON "slackMemberMatch"("organizationId", "crmUserId");

-- CreateIndex
CREATE UNIQUE INDEX "slackWorkspaceGrant_organizationId_teamId_key" ON "slackWorkspaceGrant"("organizationId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "trackedDomain_organizationId_host_key" ON "trackedDomain"("organizationId", "host");

-- CreateIndex
CREATE INDEX "trackedEvent_organizationId_idx" ON "trackedEvent"("organizationId");

-- CreateIndex
CREATE INDEX "trackedPageDaily_organizationId_host_day_idx" ON "trackedPageDaily"("organizationId", "host", "day");

-- AddForeignKey
ALTER TABLE "slackMemberMatch" ADD CONSTRAINT "slackMemberMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slackChannel" ADD CONSTRAINT "slackChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slackWorkspaceGrant" ADD CONSTRAINT "slackWorkspaceGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcpToolSnapshot" ADD CONSTRAINT "mcpToolSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companyEnrichment" ADD CONSTRAINT "companyEnrichment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactFact" ADD CONSTRAINT "contactFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactBrief" ADD CONSTRAINT "contactBrief_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentTask" ADD CONSTRAINT "agentTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentEvent" ADD CONSTRAINT "agentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversation" ADD CONSTRAINT "agentConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationFeedback" ADD CONSTRAINT "agentConversationFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationShare" ADD CONSTRAINT "agentConversationShare_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationSubmission" ADD CONSTRAINT "agentConversationSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationAttachment" ADD CONSTRAINT "agentConversationAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentDefinition" ADD CONSTRAINT "agentDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentVersion" ADD CONSTRAINT "agentVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentBuilderArtifact" ADD CONSTRAINT "agentBuilderArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentTrigger" ADD CONSTRAINT "agentTrigger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentRun" ADD CONSTRAINT "agentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentRunEvent" ADD CONSTRAINT "agentRunEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentAction" ADD CONSTRAINT "agentAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentAuditEvent" ADD CONSTRAINT "agentAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchangeRate" ADD CONSTRAINT "exchangeRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealContact" ADD CONSTRAINT "dealContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fieldDefinition" ADD CONSTRAINT "fieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fieldOption" ADD CONSTRAINT "fieldOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fieldValue" ADD CONSTRAINT "fieldValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savedView" ADD CONSTRAINT "savedView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxSync" ADD CONSTRAINT "mailboxSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emailThread" ADD CONSTRAINT "emailThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emailMessage" ADD CONSTRAINT "emailMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendarEvent" ADD CONSTRAINT "calendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendarAttendee" ADD CONSTRAINT "calendarAttendee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressedDomain" ADD CONSTRAINT "suppressedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressedContact" ADD CONSTRAINT "suppressedContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appSetting" ADD CONSTRAINT "appSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedDomain" ADD CONSTRAINT "trackedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedVisitor" ADD CONSTRAINT "trackedVisitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedEvent" ADD CONSTRAINT "trackedEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedPageDaily" ADD CONSTRAINT "trackedPageDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formSubmission" ADD CONSTRAINT "formSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaceProfile" ADD CONSTRAINT "workspaceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security. The policy is the whole tenancy boundary for crm_tenant.
ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "company" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "companyEnrichment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "companyEnrichment" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contact" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "contactFact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contactFact" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "contactBrief" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contactBrief" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentTask" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentEvent" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentConversation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentConversation" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentConversationFeedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentConversationFeedback" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentConversationShare" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentConversationShare" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentConversationSubmission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentConversationSubmission" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentConversationAttachment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentConversationAttachment" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentDefinition" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentVersion" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentBuilderArtifact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentBuilderArtifact" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentTrigger" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentTrigger" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentRun" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentRunEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentRunEvent" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentAction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentAction" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "agentAuditEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agentAuditEvent" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "deal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "deal" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "dealContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "dealContact" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "fieldDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "fieldDefinition" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "fieldOption" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "fieldOption" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "fieldValue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "fieldValue" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "savedView" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "savedView" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "activity" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "mailboxSync" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mailboxSync" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "emailThread" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "emailThread" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "emailMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "emailMessage" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "calendarEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "calendarEvent" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "calendarAttendee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "calendarAttendee" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "suppressedDomain" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "suppressedDomain" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "suppressedContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "suppressedContact" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "trackedDomain" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "trackedDomain" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "trackedVisitor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "trackedVisitor" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "trackedEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "trackedEvent" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "trackedPageDaily" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "trackedPageDaily" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "formSubmission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "formSubmission" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "mcpToolSnapshot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mcpToolSnapshot" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "slackMemberMatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "slackMemberMatch" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "slackChannel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "slackChannel" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "slackWorkspaceGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "slackWorkspaceGrant" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "exchangeRate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "exchangeRate" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "appSetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "appSetting" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "workspaceProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspaceProfile" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "mcpConnection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mcpConnection" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
ALTER TABLE "mcpOauthState" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mcpOauthState" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());

-- References stay inside one organization.
CREATE TRIGGER "company_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "primaryContactId" ON "company" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('primaryContactId', 'contact');
CREATE TRIGGER "companyEnrichment_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "companyEnrichment" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company');
CREATE TRIGGER "contact_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "contact" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company');
CREATE TRIGGER "contactFact_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "contactId" ON "contactFact" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('contactId', 'contact');
CREATE TRIGGER "contactBrief_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "contactId" ON "contactBrief" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('contactId', 'contact');
CREATE TRIGGER "agentEvent_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "conversationId" ON "agentEvent" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('conversationId', 'agentConversation');
CREATE TRIGGER "agentConversation_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "contactId", "companyId", "dealId", "agentId" ON "agentConversation" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('contactId', 'contact', 'companyId', 'company', 'dealId', 'deal', 'agentId', 'agentDefinition');
CREATE TRIGGER "agentConversationFeedback_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "conversationId" ON "agentConversationFeedback" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('conversationId', 'agentConversation');
CREATE TRIGGER "agentConversationShare_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "conversationId" ON "agentConversationShare" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('conversationId', 'agentConversation');
CREATE TRIGGER "agentConversationSubmission_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "conversationId" ON "agentConversationSubmission" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('conversationId', 'agentConversation');
CREATE TRIGGER "agentConversationAttachment_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "submissionId" ON "agentConversationAttachment" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('submissionId', 'agentConversationSubmission');
CREATE TRIGGER "agentDefinition_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "currentVersionId" ON "agentDefinition" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('currentVersionId', 'agentVersion');
CREATE TRIGGER "agentVersion_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "agentId", "sourceConversationId" ON "agentVersion" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('agentId', 'agentDefinition', 'sourceConversationId', 'agentConversation');
CREATE TRIGGER "agentBuilderArtifact_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "conversationId", "versionId" ON "agentBuilderArtifact" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('conversationId', 'agentConversation', 'versionId', 'agentVersion');
CREATE TRIGGER "agentTrigger_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "agentId" ON "agentTrigger" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('agentId', 'agentDefinition');
CREATE TRIGGER "agentRun_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "agentId" ON "agentRun" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('agentId', 'agentDefinition');
CREATE TRIGGER "agentRunEvent_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "runId" ON "agentRunEvent" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('runId', 'agentRun');
CREATE TRIGGER "agentAction_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "agentId" ON "agentAction" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('agentId', 'agentDefinition');
CREATE TRIGGER "agentAuditEvent_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "agentId" ON "agentAuditEvent" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('agentId', 'agentDefinition');
CREATE TRIGGER "deal_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "deal" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company');
CREATE TRIGGER "dealContact_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "dealId", "contactId" ON "dealContact" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('dealId', 'deal', 'contactId', 'contact');
CREATE TRIGGER "fieldOption_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "fieldId" ON "fieldOption" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('fieldId', 'fieldDefinition');
CREATE TRIGGER "fieldValue_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "fieldId", "companyId", "contactId", "dealId", "optionId" ON "fieldValue" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('fieldId', 'fieldDefinition', 'companyId', 'company', 'contactId', 'contact', 'dealId', 'deal', 'optionId', 'fieldOption');
CREATE TRIGGER "activity_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId", "contactId", "dealId", "emailThreadId", "calendarEventId" ON "activity" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company', 'contactId', 'contact', 'dealId', 'deal', 'emailThreadId', 'emailThread', 'calendarEventId', 'calendarEvent');
CREATE TRIGGER "emailThread_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId", "contactId" ON "emailThread" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company', 'contactId', 'contact');
CREATE TRIGGER "emailMessage_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "threadId" ON "emailMessage" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('threadId', 'emailThread');
CREATE TRIGGER "calendarEvent_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId", "contactId" ON "calendarEvent" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company', 'contactId', 'contact');
CREATE TRIGGER "calendarAttendee_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "eventId", "contactId" ON "calendarAttendee" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('eventId', 'calendarEvent', 'contactId', 'contact');
CREATE TRIGGER "trackedVisitor_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "contactId" ON "trackedVisitor" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('contactId', 'contact');
CREATE TRIGGER "formSubmission_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "contactId" ON "formSubmission" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('contactId', 'contact');
CREATE TRIGGER "mcpToolSnapshot_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "connectionId" ON "mcpToolSnapshot" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('connectionId', 'mcpConnection');

-- crm_tenant reads and writes every table; row-level security decides which rows.
GRANT USAGE ON SCHEMA public TO crm_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crm_tenant;
