# Tenancy

Every CRM row belongs to exactly one **organization** (an agency workspace,
Better Auth's `organization` row). Postgres enforces it. Read this before you add a
table, write raw SQL, start background work, or touch auth.

## The boundary is the database, not the `where` clause

Each tenant table has `organizationId` (`NOT NULL`, foreign key to `organization`,
`ON DELETE CASCADE`) and a row-level-security policy:

```sql
USING ("organizationId" = crm_current_org())
```

`crm_current_org()` reads `crm.organization_id`, a transaction-local setting.
Nothing in application code filters by organization to stay safe — the policy does,
for Prisma queries, raw SQL, joins, counts and aggregates alike.

**`packages/db/src/scoped-adapter.ts`** wraps the Prisma `pg` driver adapter. Before
every statement outside a transaction, and at the start of every transaction, it runs

```sql
SELECT set_config('role', 'crm_tenant', true), set_config('crm.organization_id', $1, true)
```

`crm_tenant` is a non-login role that row-level security applies to. Both settings
are `is_local = true`, so they die with the transaction — safe behind a transaction
pooler (pgbouncer, Neon's pooled URL), where a session-level setting would leak into
another caller's connection.

Which organization comes from **`packages/db/src/tenancy.ts`**, an
`AsyncLocalStorage` scope:

| Scope | How you enter it | What the database sees |
| --- | --- | --- |
| Tenant | `runInTenant(organizationId, fn)` | `crm_tenant`, filtered to that organization |
| System | `runAsSystem(reason, fn)` | The connecting role, which owns the tables — unfiltered |
| None | anything else | `crm_tenant` with no organization — **sees nothing, writes nothing** |

**Missing scope fails closed.** Code that forgot to name a tenant reads empty
results and cannot insert (the `organizationId` default is `crm_current_org()`,
which is null, and the column is `NOT NULL`). `requireOrganizationId()` throws a
`TenancyError` for code that needs the id explicitly.

**One scope store per process.** Outside production, `client.ts` keeps the Prisma
client on `globalThis.prisma` across hot reloads, and its adapter reads the scope
through the `tenancy.ts` copy that created it. A reload loads a fresh copy of
`tenancy.ts`. So the store lives on `globalThis.crmTenancy`, and every copy reads and
writes the same one. A module-local store made every tenant query after an `eve dev`
or `next dev` reload see no organization. `packages/db/test/tenancy-reload.spec.ts`
holds this.

**Always `await` inside the scope.** Prisma queries are lazy; a promise returned
unawaited from `runInTenant` starts outside it and runs unscoped. `runInTenant` awaits
for you — keep it that way.

### The scope costs one round trip, not two

A tenant statement outside a transaction is `BEGIN`, the scope `set_config`, the
statement and `COMMIT`. `packages/db/src/tenant-pool.ts` wraps each `pg` client so
the adapter's `BEGIN` waits for the next statement. When that statement is the
scope `set_config`, both go to Postgres in one simple-protocol message:
`BEGIN; SELECT set_config(...)`. The settings are still `is_local = true` inside
an explicit transaction, so nothing outlives the transaction, and row-level
security is unchanged. The workspace id is inlined only after it matches
`isOrganizationId`, and through `escapeLiteral`. Anything else, such as a system
transaction or `SET TRANSACTION ISOLATION LEVEL`, gets the plain `BEGIN` first.

`relationJoins` is on in `schema.prisma`, so a read with nested relations is one
statement instead of one per relation. Each statement pays the scope round trip,
so this is the larger saving.

`DATABASE_POOL_MAX`, `DATABASE_POOL_IDLE_TIMEOUT_MS` and
`DATABASE_POOL_CONNECT_TIMEOUT_MS` size the pool (`packages/db/src/pool-config.ts`).

`packages/db/scripts/latency-proxy.ts` adds a fixed delay to every packet, and
`packages/db/scripts/bench-tenant-queries.ts` times the common list shapes through
it. It also asserts that row-level security still hides the second organization.
At a 20 ms round trip (p50, 2,000 companies, 10,000 contacts and 4,000 deals per
organization):

| Query | Before | Fused scope | Fused scope and relation joins |
| --- | --- | --- | --- |
| `findUnique` by id | 96 ms | 73 ms | 72 ms |
| Contacts page, 50 rows, 2 relations | 205 ms | 158 ms | 93 ms |
| Deals list, 4 queries in parallel | 192 ms | 145 ms | 73 ms |
| Deals list, 4 queries in one `$transaction([...])` | 247 ms | 225 ms | 151 ms |

Keep list procedures on `Promise.all`. One batch transaction runs its statements
one after another on one connection, so it is slower for one request. It holds
fewer connections, so it wins only when the pool is the bottleneck.

### Batched `findUnique` would cross tenants — and does not

Prisma batches `findUnique` calls made in the same tick into one query, keyed only
by the query's shape, and dispatches every batch from the first caller's async
context. Two requests from two agencies could share one query run under one agency's
scope. `isolateBatchesByScope` (in `scoped-adapter.ts`) adds the scope to the batch
key and re-enters each batch's own scope at dispatch. It reaches into Prisma
internals and **refuses to start the client** if they move — upgrade Prisma, run
`apps/api/test/tenant-isolation.e2e.spec.ts`. This is the reason
`packages/db/src/scoped-adapter.ts` has the lint override in `vite.config.ts`.

### References stay inside one organization

Foreign-key checks bypass row-level security, so a deal in Northstar could point at
a company in Harbor by id. `crm_assert_same_org()` is a `BEFORE INSERT OR UPDATE`
trigger on every table with a tenant-to-tenant reference; it raises `23503`
(Prisma `P2003`) when the target is in another organization. It checks only changed
columns on update, so a dangling id on an untouched column does not block an edit.
A deal's `stageId` is checked the same way, so a deal cannot sit in another
agency's stage (`docs/pipelines.md`). `agentTask` has no trigger on purpose: it names records with no foreign key, and a
task may outlive the record it names (a "deleted" event).

### Owners are members of the organization

A user can belong to several organizations, so a foreign key to `user` proves
nothing about this one. `crm_assert_member()` is a `BEFORE INSERT OR UPDATE`
trigger on `deal.ownerId`, `contact.ownerId`, `company.ownerId` and
`fieldValue.userId`. It raises `23503` (Prisma `P2003`) when the user is not a
`member` of the row's organization. Like `crm_assert_same_org()`, it checks only
changed columns, so an old assignment never blocks an edit to another field.
The services check first with `requireOwner` (`apps/api/src/crm/bulk.ts`) on
create, update and every bulk path, so the caller gets a `400` with a reason.

Removing a member releases their work in that organization only.
`WorkspaceService.removeMember` hands their deals to the person who removed them,
or to the oldest owner, then admin, then member when someone leaves. It clears
their contact and company ownership and deletes their `mailboxSync` and
`slackMemberMatch` rows there, so their mailbox stops syncing into a workspace
they left. `crm_release_member()`, a `BEFORE DELETE` trigger on `member`, is the
backstop: it clears contact, company and USER-field assignments and refuses the
delete while the member still owns a deal. It does nothing when the whole
organization is being deleted. Their records in other organizations do not change.

`20261120090000_record_owner_membership` repairs existing rows once: contact,
company and USER-field assignments to non-members become empty, and a deal owned
by a non-member moves to the oldest owner of its organization.

### Uniqueness is per organization

Contact email, company domain, field keys, pipeline stage keys, saved-view names, mailbox syncs, email
message and thread ids, calendar events, suppressions, tracked domains, visitors,
page rollups, form dedupe keys, exchange rates and Slack rows are unique per
`organizationId`. Two agencies can both have `maya@lakeside.com`.

Advisory locks are namespaced too: `lockIdempotencyKey` prefixes the key with the
current organization (`packages/db/src/idempotency.ts`).

## Where the scope comes from

| Entry point | Scope |
| --- | --- |
| tRPC behind `AuthMiddleware` | The workspace the request names (below), verified against `member` |
| tRPC behind `UserMiddleware` (`workspaces.*`) | None — list, create, switch, accept invitations |
| `GET/POST /api/t/*` (tracking collector) | `appSetting.trackingSiteId` → organization, looked up server-side |
| `GET /api/mcp/callback` | The OAuth state row's organization, then the user's role there |
| Slack connect (`/api/auth/link-social`, then the callback) | The workspace in the `callbackURL` the button sends, if the caller belongs to it; it becomes the session's active organization before the role check |
| `GET /api/conversations/attachments/:id` | The attachment's organization, if the reader is a member |
| Crons (`archive`, `rates`, `sync`) | `forEachOrganization` (`apps/api/src/tenancy/for-each-organization.ts`) |
| Crons (`tracking/retention`, `telemetry`) | System — install-wide maintenance |
| Agent tools, hooks, instructions | The session's `organizationId` attribute (`apps/agent/agent/lib/tenant-scope.ts`) |
| Agent dispatch | Lease across organizations as system; run each task in its own |
| `/eve/v1/*` proxy (app) | The record's or conversation's organization, if the rep is a member; minted into the bridge token |

### The browser names its workspace on every request

The URL is `/<slug>/…`. The browser tRPC client sends the slug as `x-crm-workspace`
(`apps/app/lib/trpc/client.tsx`); `proxy.ts` forwards it to server components, whose
client sends it on. `AuthMiddleware` resolves it **only among the caller's own
memberships** — a slug the caller does not belong to is `403`, never a silent fallback,
so a tab left open on another workspace cannot write into the wrong one. With no
header, it uses the session's `activeOrganizationId`, then the oldest membership. No
membership at all is `412 NO_WORKSPACE`, which the proxy turns into `/onboarding`.

Switching workspaces is a full page load on purpose: React Query keys do not carry the
workspace, so a client-side switch would show the last workspace's cache for a frame.

## Exceptions: tables without a tenant key

Each is either install-wide by nature or mediated by explicit membership checks.

| Table | Why |
| --- | --- |
| `user`, `session`, `account`, `verification`, `rateLimit`, `apikey` | Identities span workspaces. `account` holds OAuth tokens per *user* for Google and Microsoft. It no longer holds a Slack token: the bot token moves to the tenant-scoped `slackConnection` when the OAuth hook runs, and the account row's copy is cleared. A `user` read for a picker, an owner check, a `USER` field, an internal-email check or an automated note's author goes through `memberOfWorkspace` or `workspaceAuthor` (`@crm/auth/organization`) |
| `organization`, `member`, `invitation`, `ssoProvider` | The tenancy registry itself. Read only through `resolveWorkspace`, `WorkspaceService` and `SsoService`, which check membership |
| `mcpClientRegistration` | OAuth dynamic client registration is per MCP platform, not per agency. Tokens live on the tenant-scoped `mcpConnection` |
| `slackInstallation` | A seconds-long handoff inside Slack's OAuth token callback, which has no session. It is keyed by the SHA-256 of the bot token and the installer's Slack user id, so one exchange matches exactly one handoff even when one Slack user installs into two teams or two agencies at once. The durable rows (`slackConnection`, `slackWorkspaceGrant`) are tenant-scoped |
| `trackingCounter` | Rate-limit counters; their keys carry the organization |
| `install`, `telemetryMilestone`, `telemetryCounter` | Anonymous install-wide telemetry |

## Roles

`owner`, `admin`, `member` (`packages/auth/src/organization.ts`). Admins manage
connections, tracking, currency, settings and invitations. **No one grants a role
above their own; only an owner makes or changes an owner; the last owner cannot be
demoted, removed or leave** (`FOR UPDATE` on the owner rows before counting).

Every `/api/auth/organization/*` endpoint of Better Auth's plugin is **disabled**
(`ORGANIZATION_PLUGIN_PATHS`). Creating workspaces, inviting, accepting and changing
roles go through tRPC, so there is one rule set. Accepting an invitation requires the
invited address, a verified email, a pending unexpired invitation, and an inviter
who can *still* grant that role.

## Sign-up

Self-service: any account may register (`ALLOWED_SIGN_IN` optionally restricts an
install). **A new account joins nothing** — it creates its own workspace, becoming its
owner, or accepts an invitation. Signing in asks for identity scopes only; Gmail,
Calendar and Outlook are separate grants on Settings → Connections. A mailbox syncs
into the workspace where it was connected, never into every workspace the person
belongs to.

## Operating it

- **The runtime database role must own the tables, or be a superuser**, so that
  system scope bypasses row-level security. The migration creates `crm_tenant` and
  grants it to the migrating role; if the runtime role is different, grant it:
  `GRANT crm_tenant TO <runtime role>`.
- Tables created by later migrations inherit the grants through
  `ALTER DEFAULT PRIVILEGES`. A table created by a *different* role does not — grant
  `SELECT, INSERT, UPDATE, DELETE` to `crm_tenant` in that migration.
- **A new tenant table needs**: `organizationId` with
  `@default(dbgenerated("crm_current_org()"))` and the `organization` relation; a
  per-organization uniqueness for every natural key; `ENABLE ROW LEVEL SECURITY` and
  the `tenant_isolation` policy; a `crm_assert_same_org` trigger for each reference to
  another tenant table. Prisma does not model policies or triggers, so write them in
  the migration SQL by hand.

## Migration from a single-workspace install

`20261119120000_multi_tenancy` assigns every existing row to the organization
`workspace` (the old singleton), creating that row first if data exists without it.
`appSetting` and `workspaceProfile` were keyed by a constant; their key column is
renamed to `organizationId`, keeping the data. Existing members keep their roles.

- It runs in one transaction under `prisma migrate deploy`. Back up first; it
  rewrites every tenant table, which takes a lock for the length of the `UPDATE`.
- **Rollback is a restore**, not a down migration: dropping the column would merge
  every agency's data back into one. Before the first second agency signs up, a
  restore from the pre-migration backup is lossless; after it, it is not.
