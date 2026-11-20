# Setup and local development

Operational detail moved out of the rule docs. `api.md`, `agent.md` and
`environment.md` are what agents read before changing code; this is what a person
reads once.

## First run

Nothing here needs Docker. The database is a Neon branch.

```sh
cp .env.example .env                    # fill BETTER_AUTH_SECRET
neon link --project-id <id>             # writes .neon
neon checkout development --create      # a development branch; writes DATABASE_URL into .env
# add the branch host to DEV_DATABASE_HOSTS in .env, and the production host to PROTECTED_DATABASE_HOSTS
bun run db:deploy                       # apply migrations to the development branch
bun run db:seed                         # optional: a demo workspace
bun run dev                             # app :3000, api :3001, agent :2000
```

Prisma from the repo root: `db:generate`, `db:migrate`, `db:push`, `db:reset`,
`db:seed`, `db:studio`, `db:deploy`.

`dev` depends on `^dev:prepare`, so every start applies pending migrations and
regenerates the Prisma client before a single server boots. When the database and
`schema.prisma` have diverged past what `migrate deploy` can reconcile,
`dev:prepare` stops the whole run rather than starting servers against a schema
they do not match — reconcile with `db:migrate`, or `db:reset` when the divergence
is an edited migration that has already been applied.

A local Postgres still works: `docker compose up -d` and
`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crm?schema=public"`.

## Neon

Set S3_PRIVATE_BUCKET to the private uploads bucket for workspace images. The app checks membership before issuing a one-minute signed read. Previous public image URLs continue to work.

`neon.ts` declares the Neon services: Postgres, the `assets` bucket, the `cron`
function and Realtime. `.neon` pins the project and branch and is not committed.

| Branch | Use | Who writes to it |
| --- | --- | --- |
| `production` | The live database. Protected in Neon. | Only a release build, through `prisma migrate deploy` |
| `development` | `bun run dev`, `db:migrate`, `db:seed`, browser checks | A developer's machine |
| a `crm_test` database on `development` | The test suite, when no local Postgres exists | `bun run db:test` and `bun run test` |

- **`DATABASE_URL` is the pooled host.** `packages/db/src/database-host.ts` strips
  `-pooler` for Prisma's CLI, so migrations use the direct host of the same
  database. Set DATABASE_URL_UNPOOLED to provide direct credentials. Prisma checks the endpoint and database against DATABASE_URL. Tenant scope is transaction-local
  (`docs/tenancy.md`), so the pooler's transaction mode is safe.
- **Live research uses Neon Realtime.** The API seals a record query for the signed-in member. Each query checks current membership. The record panel also polls the authenticated API.
- **Every query pays the network round trip.** A laptop far from the region is
  slow: 72 migrations take about 110 seconds at a 90 ms round trip.
- **Function triggers are disabled until `CRON_TARGET_URL` is set**, so Vercel
  crons and Neon triggers never run the same job twice by default.

### No development command reaches production

`packages/db/src/database-guard.ts` decides, and `scripts/require-local-db.ts`
runs it before `db:migrate`, `db:push`, `db:reset`, `db:seed` and `dev`.

- It judges **every** `DATABASE_URL` it can see: the shell, `.env.local` and
  `.env`. Prisma uses the shell value when one exists, so a guard that read only
  the file passed a production URL exported in the terminal.
- **A protected target has no override.** A target is protected when
  `NEON_BRANCH` is `production`, `prod`, `main` or `live`, or when its host is
  listed in `PROTECTED_DATABASE_HOSTS`. `ALLOW_REMOTE_DB=1` does not unlock it,
  and neither does listing the host in `DEV_DATABASE_HOSTS`.
- A remote host that is not protected runs only when `DEV_DATABASE_HOSTS` names
  it, or with `ALLOW_REMOTE_DB=1`.
- **`db:deploy` has its own check** (`scripts/require-deploy-target.ts`). It allows local databases and hosts listed in `DEV_DATABASE_HOSTS`. It refuses a protected
  target unless `VERCEL_ENV` is `production` or `ALLOW_PRODUCTION_MIGRATE=1`
  confirms it.
- The `production` branch is also marked protected in Neon.
- CI uses a Postgres service container. It holds no Neon credential.

## Google Cloud

- **Enable the Gmail API and the Google Calendar API** on the project.
- **Set the consent screen to User type: Internal** if you are on Workspace.
  `gmail.readonly` is a *restricted* scope, so an External app needs OAuth
  verification plus an annual CASA assessment. Going External later means the full
  review — a decision, not a checkbox.

## The agent bridge

```sh
AGENT_URL="http://127.0.0.1:2000"   # 127.0.0.1, not localhost: eve dev is IPv4-only
AGENT_BRIDGE_SECRET="$(openssl rand -base64 32)"
```

| Agent tab error | Cause |
| --- | --- |
| `503` | `AGENT_BRIDGE_SECRET` unset in the app's process |
| `401` | The two processes hold different secrets, **or** `passThroughEnv` in `apps/app/turbo.json` / `apps/agent/turbo.json` is missing the pair (Turbo is strict-env) |
| `502` | Agent not running, or `AGENT_URL` wrong |

`localDev()` accepts any loopback request, so `curl 127.0.0.1` proves nothing about
the bridge — send `-H 'Host: agent.example.com'`. `GET /eve/v1/info` is the whole
inventory, including a `diagnostics` count that finds files eve silently ignored.

## Running the agent

The agent package's default `dev` command is interactive `eve dev`. The root
Turbo task marks it interactive, so select the agent pane and press Enter before
using the eve TUI. Run `turbo run dev:headless --filter=agent` when a terminal
cannot render the TUI; that uses `eve dev --no-ui`, and the Turbo pane is the
record because only interactive development writes `.eve/logs/` for `eve logs`.
Reach for the Turbo task rather than `bun run --filter=agent dev:headless`: the
package script alone skips `dev:prepare`, so the agent would start against
unmigrated tables.

`hooks/activity.ts` is the replacement narration, **to stderr** (the TUI hides
stdout), printing shape everywhere and argument contents outside production only. It
is **not the audit trail** — `hooks/audit.ts` writes `AgentEvent` regardless.

- A second `bun run dev` fails the whole turbo run.
- An orphaned agent holds the port: `lsof -nP -iTCP:2000 -sTCP:LISTEN`.

### Nothing is researching, and the queue only grows

**`eve dev` never fires schedules on their cron cadence**, and everything visible
still works — the row is written, the sheet says *Queued*, and `dispatch.ts` is never
called. The poke covers this **only when `AGENT_BRIDGE_SECRET` is set**; unset,
`poke()` returns silently and the queue looks exactly like a slow agent.

Tasks the API did not write (`schedule_recheck`) and anything queued while the agent
was down still need a manual run:

```sh
bun run --filter=agent dispatch    # exact production path, both lanes, real credits
```

Its printed `sessionIds` are research rows only, so a run that resolved forty logos
prints an empty list and was not idle. `eve start` and Vercel do run the schedule.

## `vercel env pull` writes `.env.local`, which wins

`.env.local` is the override the loader reads *last*, and `vercel env pull` writes
**production** credentials there by default. Pull once and every process silently
points at production — not as an error, but as `bun run dev` working perfectly against
the live database. On 2026-08-01 eleven migrations landed on Neon from a laptop.

1. **Pull somewhere inert**: `vercel env pull .env.vercel`.
2. **`packages/db/scripts/require-local-db.ts` guards `db:migrate`, `db:push`,
   `db:reset`, `db:seed`**. It reads the shell and the root files, and it refuses a
   protected target with no override. See "No development command reaches
   production" above.

## Migrations run on the production deploy, and nowhere else

`apps/api/scripts/build-func.mjs` runs `prisma migrate deploy` during the crm-api
build, gated on `VERCEL_ENV === "production"`. The schema therefore moves when the
release pull request merges and `release` deploys — with the code that needs it,
and once rather than once per branch.

Preview deploys share the production database: `DATABASE_URL` is a single value
across production, preview and development. Until that changes, **a preview of a
branch that adds a migration runs against a database without those tables** — it
builds, and the pages that touch them fail. Test schema changes locally, where
`bun run dev` migrates for you. Before the gate existed the reverse was true and
worse: every preview applied its own migrations to the production database, so on
2026-08-07 the live schema ran six migrations ahead of the live code all day.

### `migrate deploy` is not proof the schema is right

The build follows the deploy with `prisma migrate diff --exit-code` against
`schema.prisma` and shouts in the build log when they disagree. **`No pending
migrations to apply` only means `_prisma_migrations` has a row for every file** —
it says nothing about what the tables actually look like.

They came apart once. A `prisma db push` shaped production from a laptop, the
migration rows were recorded as applied without their SQL ever running, and
`agentConversationAttachment` went live without its `position` column. Every deploy
reported nothing pending, for days, while `conversations.builderById` returned 500.
The tell is an object in the database that no migration defines — there was an
`agentConversationAttachment_submissionId_createdAt_idx` that appears in no
migration file, only in a `db push` of an older schema.

Reconciling is one command, and it is worth reading before running:

```sh
DATABASE_URL="…" bunx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script
```

## Secrets hygiene

`.gitignore` ignores `.env` and `.env.*` with one negation for `.env.example`, so
`.env.bak` is ignored too. `.env.example` ships no secret — placeholders are empty
strings, asserted by `packages/env/test/root.spec.ts`. **Generate your own secret**;
never reuse one from an example, a tutorial, or another environment.

## Tests

```sh
bun run --filter=api test
bun run --filter=agent test    # integration specs need DATABASE_URL + real Postgres
```

### The test database rebuilds itself when it drifts

`bun run db:test` creates `crm_test` and runs `migrate deploy` on it. The database
name must end in `_test`; the suite deletes rows it expects to put back, so it
refuses anything else.

**`migrate deploy` only applies migrations that are missing. It never removes a
table, a column or a constraint the database has and the schema does not.** A
`crm_test` built on a branch that was later abandoned therefore keeps that branch's
objects forever, and `db:test` used to report `already exists` and move on. The
extra objects are invisible until one of them rejects a write, and then the failure
names a constraint that appears in no migration and in no schema — a stray
`trackedEvent_visitorId_fkey` once failed seven tracking specs this way, on every
branch, for as long as the database survived.

So `db:test` now checks the database it found and rebuilds it when either is true:

- **It holds a migration this branch does not have.** The database came from
  another branch. The name of the first one is printed.
- **It no longer matches `schema.prisma`**, by `prisma migrate diff`. Something
  was pushed or altered by hand.

A rebuild drops the database and re-runs every migration, and it says which of the
two reasons fired. Force one with `bun run db:test --reset`. Nothing else in the
repo may drop a database, and this may only because the `_test` suffix is checked
first.


## Better Auth 1.7 upgrade

CRM uses Better Auth 1.7.7 and matching plugins.
The account schema stays the same as 1.6.
The existing Slack redirect URL stays valid through `slackOAuthCallback`.

Microsoft accounts need an identity check before deployment.
Version 1.7 uses the verified Microsoft `oid` instead of the previous `sub` account identifier.
Existing Microsoft accounts need a verified mapping from the identity provider before sign-in resumes.
Follow the [Microsoft account migration guide](https://better-auth.com/docs/guides/1-7-upgrade-guide#migrate-microsoft-account-identifiers).
Do not decode stored tokens without signature verification or infer identifiers from email addresses.
Google account identifiers stay the same.
