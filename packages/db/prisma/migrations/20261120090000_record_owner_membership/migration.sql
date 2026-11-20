CREATE OR REPLACE FUNCTION crm_assert_member() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  position integer := 0;
  column_name text;
  user_id text;
  previous_id text;
BEGIN
  WHILE position < TG_NARGS LOOP
    column_name := TG_ARGV[position];
    position := position + 1;

    EXECUTE format('SELECT ($1).%I::text', column_name) USING NEW INTO user_id;
    CONTINUE WHEN user_id IS NULL;

    IF TG_OP = 'UPDATE' THEN
      EXECUTE format('SELECT ($1).%I::text', column_name) USING OLD INTO previous_id;
      CONTINUE WHEN previous_id IS NOT DISTINCT FROM user_id
        AND OLD."organizationId" = NEW."organizationId";
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "member"
      WHERE "organizationId" = NEW."organizationId" AND "userId" = user_id
    ) THEN
      RAISE EXCEPTION '%.% names a user who is not a member of organization %', TG_TABLE_NAME, column_name, NEW."organizationId"
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION crm_release_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE id = OLD."organizationId") THEN
    RETURN OLD;
  END IF;

  UPDATE "contact" SET "ownerId" = NULL
    WHERE "organizationId" = OLD."organizationId" AND "ownerId" = OLD."userId";
  UPDATE "company" SET "ownerId" = NULL
    WHERE "organizationId" = OLD."organizationId" AND "ownerId" = OLD."userId";
  UPDATE "fieldValue" SET "userId" = NULL
    WHERE "organizationId" = OLD."organizationId" AND "userId" = OLD."userId";

  IF EXISTS (
    SELECT 1 FROM "deal"
    WHERE "organizationId" = OLD."organizationId" AND "ownerId" = OLD."userId"
  ) THEN
    RAISE EXCEPTION 'member % still owns deals in organization %. Reassign them before removing the member.', OLD."userId", OLD."organizationId"
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END $$;

UPDATE "contact" c SET "ownerId" = NULL
WHERE c."ownerId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "member" m WHERE m."organizationId" = c."organizationId" AND m."userId" = c."ownerId");

UPDATE "company" c SET "ownerId" = NULL
WHERE c."ownerId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "member" m WHERE m."organizationId" = c."organizationId" AND m."userId" = c."ownerId");

UPDATE "fieldValue" v SET "userId" = NULL
WHERE v."userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "member" m WHERE m."organizationId" = v."organizationId" AND m."userId" = v."userId");

UPDATE "deal" d SET "ownerId" = heir."userId"
FROM (
  SELECT DISTINCT ON (m."organizationId") m."organizationId", m."userId"
  FROM "member" m
  ORDER BY m."organizationId",
    CASE m."role" WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    m."createdAt", m."id"
) heir
WHERE heir."organizationId" = d."organizationId"
  AND NOT EXISTS (SELECT 1 FROM "member" m WHERE m."organizationId" = d."organizationId" AND m."userId" = d."ownerId");

CREATE TRIGGER "deal_owner_member" BEFORE INSERT OR UPDATE OF "organizationId", "ownerId" ON "deal" FOR EACH ROW EXECUTE FUNCTION crm_assert_member('ownerId');
CREATE TRIGGER "contact_owner_member" BEFORE INSERT OR UPDATE OF "organizationId", "ownerId" ON "contact" FOR EACH ROW EXECUTE FUNCTION crm_assert_member('ownerId');
CREATE TRIGGER "company_owner_member" BEFORE INSERT OR UPDATE OF "organizationId", "ownerId" ON "company" FOR EACH ROW EXECUTE FUNCTION crm_assert_member('ownerId');
CREATE TRIGGER "fieldValue_user_member" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "fieldValue" FOR EACH ROW EXECUTE FUNCTION crm_assert_member('userId');

CREATE TRIGGER "member_release_assignments" BEFORE DELETE ON "member" FOR EACH ROW EXECUTE FUNCTION crm_release_member();
