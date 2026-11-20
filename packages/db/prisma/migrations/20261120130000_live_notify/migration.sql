CREATE OR REPLACE FUNCTION crm_notify_live() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  record_json jsonb := to_jsonb(NEW);
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'organizationId', record_json->>'organizationId',
    'topic', TG_ARGV[0],
    'id', record_json->>'id'
  );
  IF record_json ? 'companyId' AND record_json->>'companyId' IS NOT NULL THEN
    payload := payload || jsonb_build_object('companyId', record_json->>'companyId');
  END IF;
  IF record_json ? 'contactId' AND record_json->>'contactId' IS NOT NULL THEN
    payload := payload || jsonb_build_object('contactId', record_json->>'contactId');
  END IF;
  PERFORM pg_notify('crm_live', payload::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "company_live" AFTER UPDATE OF "enrichmentStatus" ON "company" FOR EACH ROW WHEN (OLD."enrichmentStatus" IS DISTINCT FROM NEW."enrichmentStatus") EXECUTE FUNCTION crm_notify_live('company');

CREATE TRIGGER "contact_live" AFTER UPDATE OF "enrichmentStatus" ON "contact" FOR EACH ROW WHEN (OLD."enrichmentStatus" IS DISTINCT FROM NEW."enrichmentStatus") EXECUTE FUNCTION crm_notify_live('contact');

CREATE TRIGGER "agentTask_live_insert" AFTER INSERT ON "agentTask" FOR EACH ROW EXECUTE FUNCTION crm_notify_live('task');

CREATE TRIGGER "agentTask_live_update" AFTER UPDATE OF "startedAt", "finishedAt", "outcome" ON "agentTask" FOR EACH ROW WHEN (OLD."startedAt" IS DISTINCT FROM NEW."startedAt" OR OLD."finishedAt" IS DISTINCT FROM NEW."finishedAt" OR OLD."outcome" IS DISTINCT FROM NEW."outcome") EXECUTE FUNCTION crm_notify_live('task');

CREATE TRIGGER "researchResult_live_insert" AFTER INSERT ON "researchResult" FOR EACH ROW EXECUTE FUNCTION crm_notify_live('research');

CREATE TRIGGER "researchResult_live_update" AFTER UPDATE OF "status", "review" ON "researchResult" FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status" OR OLD."review" IS DISTINCT FROM NEW."review") EXECUTE FUNCTION crm_notify_live('research');
