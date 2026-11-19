# Pipelines

Every organization owns its deal stages. Read this before you touch a stage, a
deal's stage, the Deals board, a stage filter, or the workspace setup apply.

## The model

| Table | What it holds |
| --- | --- |
| `pipeline` | One **active** pipeline per organization (`pipeline_one_active_per_org`) |
| `pipelineStage` | Its ordered stages |
| `deal.stageId` | The stage a deal is in. `deal.boardPosition` is its place in that stage |

A stage has two names and they do different jobs:

- **`id` is the identifier.** Deals, saved-view filters, stage history and the API
  refer to a stage by `id`. A rename never changes it.
- **`key` is stable inside one pipeline** (`inquiry`, `proposal_sent`). It is how a
  workspace configuration recognises a stage it already has. Same key, new label
  is a rename.
- **`label` is display text.** Never filter, group or compare on it.

**`outcome` is the only thing code may branch on**: `OPEN`, `WON` or `LOST`
(`StageOutcome`). There is no stage name in the code. "Open deals" is
`OPEN_DEALS`, "closed" is `CLOSED_DEALS` (`@crm/db/pipeline`). A lost move needs a
reason. `closedAt` is set when a deal enters a `WON` or `LOST` stage and cleared
when it returns to an `OPEN` one.

`inWinRate` says whether a `LOST` stage counts as a loss in the dashboard win
rate. It exists for one legacy stage (below) and defaults to `true`.

`probability` is optional. `isDefault` marks the one stage a new deal starts in.

## What the database enforces

- **A pipeline always has an open, a won and a lost stage, and one default stage.**
  `crm_assert_pipeline_shape()` is a deferred constraint trigger. It runs at
  commit, so one transaction can replace stages freely. A single statement
  outside a transaction that removes the last lost stage fails at its own commit.
- **A default stage is open** (`pipelineStage_default_is_open`), and there is one
  per pipeline (`pipelineStage_one_default_per_pipeline`).
- **A stage that holds deals cannot be deleted** (`deal_stageId_fkey`,
  `NO ACTION`). `NO ACTION`, not `RESTRICT`: deleting an organization cascades to
  its deals and its stages in one statement, and `RESTRICT` checks too early.
- **A deal cannot point at another organization's stage.** `deal_same_org` checks
  `stageId` with `crm_assert_same_org`, as it does `companyId`. Row-level security
  hides the other stage first, so the API answers 400 before the trigger runs.
- **A deal written without a stage takes the default stage.** The column default
  is `crm_default_stage()`. Outside a tenant scope there is no organization, the
  default is null and the insert fails on `NOT NULL`.

## Where a pipeline comes from

- **An organization with none gets one on first use.** `ensureActivePipeline(tx)`
  creates `DEFAULT_PIPELINE_STAGES` (`@crm/db/pipeline-defaults`) under an
  advisory lock. `PipelineService.active()` and `DealsService.create` call it.
  `readActivePipeline` throws outside a tenant scope: in system scope its filter
  would match another agency's pipeline.
- **Applying a workspace configuration is the only thing that changes stages.**
  `PipelineService.plan` compares the configuration with the live pipeline;
  `PipelineService.apply` writes it, inside the apply transaction. There is no
  second editor on purpose: the live pipeline is the one the owner approved.

## Reconfiguring

`workspaceConfig.pipelinePlan` is the preview. `workspaceConfig.apply` takes
`stageMapping` (`removed stage id → target stage key`).

- **A rename keeps the stage and every deal in it.** Matching is by `key`.
- **A removed stage that holds deals needs a mapping**, and the target must have
  the same outcome. An open deal cannot be mapped to a won stage: that would
  close it without anybody deciding to.
- **A stage that holds deals cannot change outcome.** The plan reports it in
  `blocked` and apply refuses.
- **Moved deals keep `stageChangedAt`, `closedAt` and `closedReason`.** Each one
  gets a `STAGE_CHANGE` activity with `reason: "reconfigured"`. No CRM event is
  emitted: a reconfiguration is not a rep moving a deal, and it must not fire
  every deployed agent at once.
- **Saved views follow.** A removed stage id in a deal view's `stage` filter is
  replaced by its target, or dropped when the stage was empty.
- **Applying is idempotent.** An applied version whose pipeline already matches
  answers `alreadyApplied`. An applied version whose pipeline does **not** match
  (a version applied before pipelines existed) can be applied again to converge;
  `workspaceConfig.state` reports that as `pipelineInSync: false`.

## Generated saved views

A configuration view carries `filter`: `status` (`open` / `closed`), `stages`
(stage **keys** of the same configuration) and `unassigned`. Apply resolves keys
to stage ids and writes ordinary `savedView` rows, so the table, the Views menu
and a rep's own edits all work as for any other view. An existing shared view of
the same name is filled only when it has no filter at all; a view somebody
changed is kept.

## Stage history

A `STAGE_CHANGE` activity stores `{ from, to }` as snapshots
(`{ id, key, label, outcome }`, `@crm/validation/pipeline`). The label is the
label at the time, so history survives a rename and a removed stage.
`readStageChangeMeta` returns null for a row it cannot read; the timeline then
shows the subject alone.

CRM event data (`deal.created`, `deal.stage.changed`, `deal.closed`,
`deal.opened`) carries labels for a model to read (`stage`, `from`, `to`) and keys,
ids and `outcome` for code.

## The board

`deals.board` returns every stage as a column: count, value and the first
`BOARD.column.defaultLimit` deals by `boardPosition`. Counts and sums come from
separate queries, as `docs/currency.md` requires.

`deals.setStage` takes an optional `placement` (`afterId` or `beforeId`). The
server reads the neighbour's position and takes the midpoint of the real gap, so
a filtered or truncated column on the client cannot produce a wrong order. When
the gap is exhausted it renumbers that one stage. A move inside a stage changes
only `boardPosition`: no activity, no event.

The client moves the card in the query cache before the request
(`deals-board-state.ts`) and puts it back on an error. A move into a lost stage
is not optimistic: it opens the reason dialog first.

`Kanban` (`@crm/ui/components/kanban`) owns the drag: mouse after 6px, touch after
a long press, keyboard from each card's move button (Space, arrows, Space;
Escape cancels). Every card also has a menu that moves it without dragging.

## Migration from the `DealStage` enum

`20261119140000_pipelines` runs in one transaction.

- Every organization gets a pipeline with one stage per enum value, keyed by the
  lower-cased value (`DEMO_BOOKED` → `demo_booked`). Each deal points at the stage
  that carries its old value. Nothing else on the deal changes, `updatedAt`
  included.
- `UNQUALIFIED_TO_BUY` closed a deal and never counted as a loss. Its stage is
  `LOST` with `inWinRate = false`, so the win rate is the same number as before.
- An organization with an applied configuration **and no deals** gets the
  pipeline it approved instead. A stored pipeline that is not well formed falls
  back to the legacy stages.
- `STAGE_CHANGE` history and saved-view stage filters are rewritten from enum
  values to stage snapshots and stage ids. A value that matches no stage is left
  as it was.
- The migration raises and changes nothing if any deal is left without a stage.
- **Rollback is a restore.** The enum column is dropped.

`packages/db/test/pipeline-migration.spec.ts` builds a pre-migration database,
runs the migration and checks all of the above.
