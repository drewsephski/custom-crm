# Environment

Setup, DB commands, Google Cloud and the `vercel env pull` hazard: `docs/setup.md`.

## One `.env`, at the repo root

`.env.example` **is the documentation** — every variable the repo reads, with a note,
and nothing that is not read. `packages/env` walks up to the workspace root and reads
`.env`, then `.env.local` on top.

- **Real environment variables always win** — the loader never overwrites
  `process.env`, so Vercel/Docker/CI takes precedence.
- **Never add a per-package `.env`.** Four once existed with duplicate
  `DATABASE_URL`/`BETTER_AUTH_SECRET`; when they drifted the API minted a cookie the
  app could not verify and the browser bounced between `/sign-in` and `/` forever.
- **The root marker is a `package.json` declaring `workspaces`** — stopping at the
  first `turbo.json` resolves the API's root to `apps/api`.

## A new variable has three homes, not two

`.env.example` and — if the API reads it — `env.validation.ts` are the two people
remember. The third is **`globalPassThroughEnv` in the root `turbo.json`**, and it is
the one that bites: Turborepo hides an undeclared variable from every task it runs, so
a deployment that sets the variable perfectly still hands the code `undefined`, and
nothing anywhere says so. That is how `MICROSOFT_CLIENT_ID` shipped with the sign-in
button quietly missing. **`passThroughEnv`, never `env`** — a secret in `env` is a
cache key, which means a cache miss on every rotation and the secret in the cache
metadata. The root file's comment has the whole account.

## Database pool

`DATABASE_POOL_MAX` (default 10), `DATABASE_POOL_IDLE_TIMEOUT_MS` (30000) and
`DATABASE_POOL_CONNECT_TIMEOUT_MS` (10000) size the `pg` pool of each process,
in `packages/db/src/pool-config.ts`. On serverless every instance has its own pool,
so keep instances times the maximum under the database's connection limit.

## Neon

`docs/setup.md` has the commands. The variables, all optional:

| Variable | What it adds |
| --- | --- |
| `DEV_DATABASE_HOSTS` | Remote development hosts the local-database guard accepts |
| `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_PUBLIC_BUCKET` | Picture storage on an S3 API. `packages/db/src/object-storage.ts` |
| `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET` | Live Settings → Members. `workspace.membersLive` |
| `CRON_TARGET_URL` | The public API URL the `cron` function calls. Read by `neon.ts` only |

- **Realtime refuses any table with row-level security.** Every tenant table has
  it, so only `member` and `invitation` are live. The sealed query checks the
  viewer's membership itself, and invitations need an owner or an admin.
- **The live query is a signal, not the data.** It carries ids and a status. A
  change invalidates the tRPC queries, which keep every rule they already have.
- **`isMirrored` recognises both stores** by host: Vercel Blob and Neon storage.

## Required

`DATABASE_URL`, `BETTER_AUTH_SECRET`. Everything else has a localhost default or is
genuinely optional.

**`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`** are the sign-in button *and* the
Gmail/Calendar sync — optional, so an SSO-only install needn't create a Google project,
but **set together or not at all** (`packages/auth/src/env.ts` throws on one).

**`MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET`** are the same bargain for Entra
ID: the other sign-in button *and* the Outlook mail sync, one app registration, the
same pair rule. **`MICROSOFT_TENANT_ID`** defaults to `common` and is the only one of
the three that is genuinely optional on its own — set it to your tenant's GUID to
refuse other tenants at Microsoft instead of at `ALLOWED_SIGN_IN`. There is **no
Microsoft equivalent of `hd`**: `tenantId` is the whole of it.

**Neither pair is required, but an install wants one of them or an SSO provider** —
with none, the sign-in page says so by name rather than rendering nothing.

**`ALLOWED_SIGN_IN`** — optional. Empty means self-service sign-up: anyone may
register, and workspace membership decides what they see (`docs/tenancy.md`). Set it
to restrict an install to whole domains or single addresses. It is also read by the
sync's "which side is external" decision, together with the members of the current
workspace.
`packages/auth/src/workspace.ts`.

**`ANTHROPIC_API_KEY`** — optional, server-side only. The agent and the AI setup
proposal call Anthropic directly; there is no gateway. **`ANTHROPIC_MODEL`**
(default `claude-haiku-5-5`) and **`ANTHROPIC_COMPLEX_MODEL`** (default
`claude-opus-5-5`, used by the agent builder) are native Anthropic ids, read through
`packages/db/src/ai-models.ts`. Without a key, every AI feature reports itself off and
the CRM still works.

**`AUTH_EMAIL_PASSWORD`** — `"true"` enables email-and-password accounts, for local
development without a Google client. No email verification exists, so such accounts
cannot accept invitations and are never linked to a social sign-in. Off in
production.

## Where things are

- **`API_URL`** is the public API origin for OAuth callbacks and sign-in. Set it to the shared origin on Vercel.
- Vercel injects **`INTERNAL_API_URL`** and **`INTERNAL_AGENT_URL`** into the functions that call each service.
  Leave these variables unset in project settings. Local services use `API_URL` and `AGENT_URL`.
- The app service build sets **`CRM_PROJECT_PROXY`**. The project runs the workspace proxy before routing requests to services.
- **Editing a file under `packages/` does not restart the API. Restart it by hand.**
  `bun --watch src/main.ts` refuses to watch outside its project directory and
  says so once at boot: `File ... is not in the project directory and will not be
  watched`. So a change to `packages/auth` or `packages/db` leaves the API
  serving the old module until someone kills it. This cost an hour once: the
  Slack OAuth scope list was correct in source and stale in the process, and
  every reconnect kept asking Slack for the old scopes.
  Running the API from the repo root fixes the watch and breaks Nest, which
  resolves its tsconfig paths from the current directory and then cannot build
  its dependency graph. There is no fix in the dev script today.
- **`APP_URL`** (`:3000`) is also the trusted-origin and `callbackURL` allow-list.
- **Every OAuth `redirect_uri` is built from `API_URL`, never `APP_URL`.** Better
  Auth serves `/api/auth/*` at `baseURL`, and `baseURL` is `apiUrl`. A redirect
  built from `APP_URL` points at the web app, where `/api/auth/callback` does not
  exist, and the provider rejects it with "redirect_uri did not match". This is
  invisible until someone sets `APP_URL` to a tunnel or a LAN host, at which
  point the redirect silently becomes that host. `ssoCallbackBase()` is the
  pattern; `slackRedirectUri` in `auth.ts` once was not.
- **`AUTH_COOKIE_DOMAIN`** only for API and app on different subdomains of one parent.
- **`AGENT_URL`** is the agent's deployment, server-side only, and **must include the
  scheme** — validated at boot, or it throws when a task is queued instead.
- **`AUTH_COOKIE_PREFIX` is `crm`** (`@crm/auth/cookies`), set on **both**
  `advanced.cookiePrefix` in `auth.ts` and `getSessionCookie(request, { cookiePrefix })`
  in `proxy.ts` — one alone redirects every signed-in request. Better Auth's default
  collides with any neighbour on a shared parent domain, silently: sign-in completes,
  the row is written, every reader resolves `null`. **Changing it signs everybody out.**

## Public homepage

The application serves the public homepage at `/` on every installation.

## Typed, validated env

`apps/api/src/config/env.validation.ts` runs via `ConfigModule.forRoot({ validate })`,
and lists every variable the API reads and nothing else.

- **Validation runs while `AppModule` is evaluated** — a test must set variables before
  importing it (see the dynamic `import()` in `test/auth.e2e.spec.ts`).
- **The schema is the API's, not the repo's** — `@crm/auth` and the agent read their own.

## Builder chat encryption

`CHAT_EVENT_ENCRYPTION_KEY` encrypts new builder chat events before database storage.
Generate 32 bytes with `openssl rand -base64 32`.
The API and agent must use the same value.
Without it, builder chat stores the sanitized public event as plaintext.
Removing it hides encrypted replay data without stopping the agent or API.

## Optional: what the agent can do

Every outside source is optional and the agent runs with none. A missing key removes a
place to look; **never an error, never throws**. `agent/lib/capabilities.ts` is the
single place that knows what is set.

| Variable | What it adds |
| --- | --- |
| `PERPLEXITY_API_KEY` | Open-web research with citations; finds a LinkedIn slug |
| `GITHUB_TOKEN` | Raises the GitHub rate limit from 60/hour |
| `BLOB_READ_WRITE_TOKEN` | Mirrors logos and photos into Blob |
| `ANTHROPIC_API_KEY` | The model, called directly. Optional |
| `AGENT_BRIDGE_SECRET` | The rep-facing Agent panel — see `agent.md` |

`BLOB_READ_WRITE_TOKEN` is also in `env.validation.ts` and `apps/api/turbo.json`
because the API and the seed write pictures too. The Next.js app is deliberately
excluded — recognising our URL for the image optimizer needs no token.

### Platform research credentials

Set CONTEXT_DEV_API_KEY on the agent server. An empty value disables paid research. Users can complete onboarding without research.

RESEARCH_WORKSPACE_MONTHLY_CREDITS sets the default monthly workspace allowance. RESEARCH_PLATFORM_MONTHLY_CREDITS sets the shared platform allowance.
The agent reserves credits before each billable call. It reads usage from provider responses.
Set RESEND_API_KEY and EMAIL_FROM for production email delivery. Configure Google credentials to enable Google sign-in.

## Mailbox sync

Always on, on whichever social provider is configured, so there is no extra redirect
URI beyond the sign-in one. Scopes are requested at sign-in and gated by
`requireMailboxAccess()`, because granular consent lets a user untick one and still
sign in.

**An SSO rep is not gated** — `needsMailboxGrant` (`@crm/auth`) walls only an account
whose sign-in rows are *all* mailbox providers. It cannot be "has the scopes": an SSO
rep has no Google or Microsoft account to grant on, and `revoke()` keeps the `account`
row, so trying the optional feature and revoking would lock them out. They connect from
Settings → Connections, posting the same `linkSocial` call.

**One granted mailbox is enough.** A rep with both providers linked who granted Google
is not asked for Outlook; `mailboxGrantsNeeded` names the ones still outstanding and
`/grant-access` offers exactly those buttons.

**Microsoft's granted scopes come back fully qualified** —
`https://graph.microsoft.com/Mail.Read`, not `Mail.Read`. `parseScopes` is the one
canonicaliser and strips that prefix, so the comparison is against the bare permission
everywhere.

**Sync is forward-only** — Gmail records the current `historyId` on its first pass and
imports nothing, Calendar reads from `now`, and Outlook records `now` as its cursor.

**`CRON_SECRET`** (min 16 chars) guards `POST /internal/sync/mailboxes` and
`/internal/sync/rates`; both **fail closed when unset**. `/internal/sync/google` is
kept as an alias of the first, so an existing deployment's cron does not break on
deploy. **Crons live in `vercel.json`** — mailboxes `*/5 * * * *`, rates
daily. Minute-level schedules need a Pro plan; on Hobby it silently becomes daily.

Deliberate absences: **no `GOOGLE_SYNC_ENABLED`** (a switch that can disable a mandatory
feature is only ever wrong), **no `GOOGLE_WORKSPACE_DOMAIN`** (`ALLOWED_SIGN_IN` already
says who is internal — two sources is how a colleague becomes a lead), **no
`GMAIL_BACKFILL_DAYS`**, **no `OUTLOOK_BACKFILL_DAYS`**, **no rate provider variable**.

## Telemetry is on, and turning it off is one variable

`CRM_TELEMETRY_DISABLED="1"` — or `DO_NOT_TRACK=1`, honoured identically — and nothing
is sent. No client is constructed, so there is no queue waiting to flush later.

- The API and agent send server telemetry. The homepage does not load marketing analytics.
- **There is no variable for the destination.** The project key and host are
  constants in `packages/telemetry/src/project.ts`. A `phc_` key is write-only —
  it can send events and read nothing back — so making it configurable would
  only imply it were a secret. Edit the constants to point somewhere else.
- **The install ID is a row, not a file** — `install`, one row, UUID written by
  the migration. Vercel's filesystem is ephemeral, so `~/.crm/telemetry-id`
  would count containers.
- Declared in `env.validation.ts` as optional, like everything else here. Every
  event and the never-sent list are in **`docs/telemetry.md`**.

## Not env vars

- **Cache TTL** — `DEFAULT_TTL_MS` (60s) in `cache.module.ts`; `CACHE_TTL_MS` overrides.
- **Redis** — optional; without `REDIS_URL` the cache is per-instance in-memory, which
  is wrong for multi-instance.
- **Sign-in method** — Google and Microsoft are in code; an IdP is a row (SSO, in `api.md`).
