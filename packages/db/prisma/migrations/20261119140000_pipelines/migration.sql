-- Pipelines: every organization owns its deal stages.
--
-- Read docs/pipelines.md before changing anything here. The short version:
--   * "pipeline" holds one active pipeline per organization.
--   * "pipelineStage" holds its ordered stages. "key" is stable; "label" is editable.
--   * "deal"."stageId" replaces the "DealStage" enum column.
--   * Every existing deal keeps its stage: each legacy enum value becomes one stage
--     with the same meaning, and the deal points at it.

-- CreateEnum
CREATE TYPE "StageOutcome" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "pipeline" (
    "organizationId" TEXT NOT NULL DEFAULT crm_current_org(),
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelineStage" (
    "organizationId" TEXT NOT NULL DEFAULT crm_current_org(),
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "outcome" "StageOutcome" NOT NULL,
    "probability" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "inWinRate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelineStage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pipelineStage_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT "pipelineStage_label_present" CHECK (btrim("label") <> ''),
    CONSTRAINT "pipelineStage_probability_range" CHECK ("probability" IS NULL OR "probability" BETWEEN 0 AND 100),
    CONSTRAINT "pipelineStage_default_is_open" CHECK (NOT "isDefault" OR "outcome" = 'OPEN')
);

-- CreateIndex
CREATE INDEX "pipeline_organizationId_idx" ON "pipeline"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_one_active_per_org" ON "pipeline"("organizationId") WHERE ("isActive" = true);

-- CreateIndex
CREATE INDEX "pipelineStage_pipelineId_position_idx" ON "pipelineStage"("pipelineId", "position");

-- CreateIndex
CREATE INDEX "pipelineStage_organizationId_idx" ON "pipelineStage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pipelineStage_pipelineId_key_key" ON "pipelineStage"("pipelineId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "pipelineStage_one_default_per_pipeline" ON "pipelineStage"("pipelineId") WHERE ("isDefault" = true);

-- AddForeignKey
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelineStage" ADD CONSTRAINT "pipelineStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelineStage" ADD CONSTRAINT "pipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One pipeline per existing organization.
INSERT INTO "pipeline" ("organizationId", "id", "name", "isActive", "updatedAt")
SELECT o."id", md5(o."id" || ':pipeline'), 'Sales pipeline', true, now()
FROM "organization" o;

-- An organization that approved a configuration and has no deals takes the pipeline
-- it approved. A stored pipeline that is not well formed falls back to the legacy stages.
CREATE TEMP TABLE "_approved_pipeline" ON COMMIT DROP AS
SELECT DISTINCT ON (v."organizationId") v."organizationId", v."config"->'pipeline' AS stages
FROM "workspaceConfigVersion" v
WHERE v."status" = 'APPLIED'
  AND jsonb_typeof(v."config"->'pipeline') = 'array'
  AND NOT EXISTS (SELECT 1 FROM "deal" d WHERE d."organizationId" = v."organizationId")
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v."config"->'pipeline') s
    WHERE NOT (
      jsonb_typeof(s) = 'object'
      AND coalesce(s->>'key', '') ~ '^[a-z][a-z0-9_]*$'
      AND btrim(coalesce(s->>'label', '')) <> ''
      AND coalesce(s->>'outcome', '') IN ('open', 'won', 'lost')
      AND CASE WHEN coalesce(s->>'probability', '') ~ '^[0-9]{1,3}$' THEN (s->>'probability')::int <= 100 ELSE false END
    )
  )
  AND (SELECT count(DISTINCT s->>'outcome') FROM jsonb_array_elements(v."config"->'pipeline') s) = 3
  AND (SELECT count(DISTINCT s->>'key') FROM jsonb_array_elements(v."config"->'pipeline') s) = jsonb_array_length(v."config"->'pipeline')
ORDER BY v."organizationId", v."version" DESC;

INSERT INTO "pipelineStage" ("organizationId", "id", "pipelineId", "key", "label", "position", "outcome", "probability", "isDefault", "inWinRate", "updatedAt")
SELECT
  p."organizationId",
  md5(p."id" || ':' || (e.stage->>'key')),
  p."id",
  e.stage->>'key',
  btrim(e.stage->>'label'),
  (e.ordinality - 1)::int,
  upper(e.stage->>'outcome')::"StageOutcome",
  (e.stage->>'probability')::int,
  e.ordinality = (
    SELECT min(o.ordinality)
    FROM jsonb_array_elements(a.stages) WITH ORDINALITY o(stage, ordinality)
    WHERE o.stage->>'outcome' = 'open'
  ),
  true,
  now()
FROM "_approved_pipeline" a
JOIN "pipeline" p ON p."organizationId" = a."organizationId"
CROSS JOIN LATERAL jsonb_array_elements(a.stages) WITH ORDINALITY e(stage, ordinality);

-- Every other organization takes the legacy stages, one per "DealStage" value.
-- UNQUALIFIED_TO_BUY closed a deal and required a reason, and it never counted as a
-- loss in the win rate. "inWinRate" = false keeps that.
INSERT INTO "pipelineStage" ("organizationId", "id", "pipelineId", "key", "label", "position", "outcome", "probability", "isDefault", "inWinRate", "updatedAt")
SELECT
  p."organizationId",
  md5(p."id" || ':' || legacy.key),
  p."id",
  legacy.key,
  legacy.label,
  legacy.position,
  legacy.outcome::"StageOutcome",
  NULL,
  legacy.is_default,
  legacy.in_win_rate,
  now()
FROM "pipeline" p
CROSS JOIN (
  VALUES
    ('demo_booked', 'Demo booked', 0, 'OPEN', true, true),
    ('qualified_to_buy', 'Qualified to buy', 1, 'OPEN', false, true),
    ('decision_maker_bought_in', 'Decision maker in', 2, 'OPEN', false, true),
    ('contract_sent', 'Contract sent', 3, 'OPEN', false, true),
    ('closed_won', 'Closed won', 4, 'WON', false, true),
    ('closed_lost', 'Closed lost', 5, 'LOST', false, true),
    ('unqualified_to_buy', 'Unqualified', 6, 'LOST', false, false)
) AS legacy(key, label, position, outcome, is_default, in_win_rate)
WHERE NOT EXISTS (SELECT 1 FROM "_approved_pipeline" a WHERE a."organizationId" = p."organizationId");

-- Deals: point every deal at the stage that carries its legacy value.
ALTER TABLE "deal" ADD COLUMN "stageId" TEXT;
ALTER TABLE "deal" ADD COLUMN "boardPosition" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "deal" d
SET "stageId" = s."id"
FROM "pipeline" p
JOIN "pipelineStage" s ON s."pipelineId" = p."id"
WHERE p."organizationId" = d."organizationId"
  AND p."isActive"
  AND s."key" = lower(d."stage"::text);

DO $$
DECLARE
  orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned FROM "deal" WHERE "stageId" IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION '% deal(s) have no pipeline stage after the backfill. Nothing was changed.', orphaned;
  END IF;
END $$;

UPDATE "deal" d
SET "boardPosition" = ranked.position
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "stageId" ORDER BY "createdAt" DESC, "id") AS position
  FROM "deal"
) ranked
WHERE ranked."id" = d."id";

-- Stage history: a STAGE_CHANGE activity stored the two enum values. It now stores
-- the stage each value became, with the label it had, so history survives a rename
-- or a removed stage.
UPDATE "activity" a
SET "meta" = jsonb_build_object(
  'from', jsonb_build_object('id', f."id", 'key', f."key", 'label', f."label", 'outcome', f."outcome"),
  'to', jsonb_build_object('id', t."id", 'key', t."key", 'label', t."label", 'outcome', t."outcome")
)
FROM "pipeline" p, "pipelineStage" f, "pipelineStage" t
WHERE a."type" = 'STAGE_CHANGE'
  AND jsonb_typeof(a."meta"->'from') = 'string'
  AND jsonb_typeof(a."meta"->'to') = 'string'
  AND p."organizationId" = a."organizationId"
  AND p."isActive"
  AND f."pipelineId" = p."id"
  AND f."key" = lower(a."meta"->>'from')
  AND t."pipelineId" = p."id"
  AND t."key" = lower(a."meta"->>'to');

-- Saved views filtered deals by enum value. They now filter by stage id.
UPDATE "savedView" v
SET "filters" = jsonb_set(
  v."filters",
  '{filters,stage}',
  (
    SELECT coalesce(jsonb_agg(coalesce(s."id", chosen.value) ORDER BY chosen.ordinality), '[]'::jsonb)
    FROM jsonb_array_elements_text(v."filters"->'filters'->'stage') WITH ORDINALITY chosen(value, ordinality)
    LEFT JOIN "pipeline" p ON p."organizationId" = v."organizationId" AND p."isActive"
    LEFT JOIN "pipelineStage" s ON s."pipelineId" = p."id" AND s."key" = lower(chosen.value)
  )
)
WHERE v."entity" = 'DEAL'
  AND jsonb_typeof(v."filters"->'filters'->'stage') = 'array';

ALTER TABLE "deal" ALTER COLUMN "stageId" SET NOT NULL;

-- A deal written without a stage takes the default stage of its organization's
-- active pipeline. Outside a tenant scope there is no organization, the default is
-- null, and the insert fails on NOT NULL.
CREATE OR REPLACE FUNCTION crm_default_stage() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT s."id"
  FROM "pipelineStage" s
  JOIN "pipeline" p ON p."id" = s."pipelineId"
  WHERE p."organizationId" = crm_current_org()
    AND p."isActive"
    AND s."isDefault"
  LIMIT 1
$$;

ALTER TABLE "deal" ALTER COLUMN "stageId" SET DEFAULT crm_default_stage();

-- DropIndex
DROP INDEX "deal_stage_idx";

-- AlterTable
ALTER TABLE "deal" DROP COLUMN "stage";

-- DropEnum
DROP TYPE "DealStage";

-- CreateIndex
CREATE INDEX "deal_stageId_boardPosition_idx" ON "deal"("stageId", "boardPosition");

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipelineStage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Row-level security, as for every tenant table.
ALTER TABLE "pipeline" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "pipeline" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "pipeline" TO crm_tenant;

ALTER TABLE "pipelineStage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "pipelineStage" USING ("organizationId" = crm_current_org()) WITH CHECK ("organizationId" = crm_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "pipelineStage" TO crm_tenant;

-- A stage belongs to a pipeline of its own organization, and a deal to a stage of its own.
CREATE TRIGGER "pipelineStage_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "pipelineId" ON "pipelineStage" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('pipelineId', 'pipeline');

DROP TRIGGER "deal_same_org" ON "deal";
CREATE TRIGGER "deal_same_org" BEFORE INSERT OR UPDATE OF "organizationId", "companyId", "stageId" ON "deal" FOR EACH ROW EXECUTE FUNCTION crm_assert_same_org('companyId', 'company', 'stageId', 'pipelineStage');

-- A pipeline always has an open, a won and a lost stage, and one default stage.
-- The check is deferred to commit, so a transaction can replace stages freely.
CREATE OR REPLACE FUNCTION crm_assert_pipeline_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target text;
  missing text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target := OLD."pipelineId";
  ELSE
    target := NEW."pipelineId";
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "pipeline" WHERE "id" = target) THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(lower(needed::text), ', ') INTO missing
  FROM unnest(enum_range(NULL::"StageOutcome")) AS needed
  WHERE NOT EXISTS (
    SELECT 1 FROM "pipelineStage" s WHERE s."pipelineId" = target AND s."outcome" = needed
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'pipeline % needs at least one stage for each outcome; it has no % stage', target, missing
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "pipelineStage" s WHERE s."pipelineId" = target AND s."isDefault") THEN
    RAISE EXCEPTION 'pipeline % has no default stage', target
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "pipelineStage_shape" AFTER INSERT OR UPDATE OR DELETE ON "pipelineStage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crm_assert_pipeline_shape();
