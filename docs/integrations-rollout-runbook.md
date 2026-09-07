# Integrations rollout runbook — Track A

**Purpose:** turn on the already-built Integrations platform for production,
starting with the read/import/export core. This is the "PR A1" of
[`integrations-live-data-bridge-gap-analysis.md`](integrations-live-data-bridge-gap-analysis.md)
— **no application code changes**, only environment variables, one optional
`pg_cron` job, and a regression pass.

Everything referenced here is deployed to production already (dark). The
platform's own docs: [`integrations-architecture.md`](integrations-architecture.md).
Flag reference: [`web/lib/integrations/gate.ts`](../web/lib/integrations/gate.ts)
and the `# Integrations area` block in
[`web/.env.local.example`](../web/.env.local.example).

---

## 0. Scope of Track A

**Turned ON in this track (safe, session-authed, no external attack surface):**

| Surface | Flag | Why it's safe now |
| --- | --- | --- |
| Integrations area + nav | `INTEGRATIONS_ENABLED` (on unless `"false"`) | gate only; every route/action re-checks it server-side |
| Import Studio | `INTEGRATIONS_IMPORT_STUDIO_ENABLED` | upload → map → validate → review → **explicit** commit → rollback; nothing enters the ledger without `commitImportBatch` |
| Export Center | `INTEGRATIONS_EXPORT_CENTER_ENABLED` | read-only over the ledger; formula-injection-guarded; small exports inline, large via cron |
| Reconciliation Center | `INTEGRATIONS_RECONCILIATION_CENTER_ENABLED` (on unless `"false"`) | **read-only** hub linking to queues that already exist; balance-drift section stays empty until `BALANCE_RECONCILIATION_ENABLED` (not this track) |
| Accountant package | `INTEGRATIONS_ACCOUNTANT_PACKAGE_ENABLED` (on unless `"false"`) | read-only ZIP built inline from the Export engine; 300 s signed download |
| Marketplace catalog | `INTEGRATIONS_MARKETPLACE_ENABLED` (on unless `"false"`) | static catalogue; `coming_soon` entries have no reachable config link |

**Deliberately left OFF (later tracks / need credentials):**

`INTEGRATIONS_SYNC_ENABLED`, `INTEGRATIONS_DESTINATIONS_ENABLED`,
`INTEGRATIONS_WORKBOOKS_ENABLED`, `INTEGRATIONS_CLOUD_STORAGE_ENABLED`,
`INTEGRATIONS_ACCOUNTING_CONNECTORS_ENABLED`, `INTEGRATIONS_DEVELOPER_API_ENABLED`,
`INTEGRATIONS_WEBHOOKS_DEV_ENABLED`, `BALANCE_RECONCILIATION_ENABLED`, and every
`*_CLIENT_ID` / `*_CLIENT_SECRET` / `*_APP_KEY`. These are the first non-session
attack surface (developer API) or depend on OAuth apps that do not exist yet.
Turning them on is out of scope here — see Tracks C/D in the gap analysis.

---

## 1. Prerequisites — verify BEFORE touching any flag

### 1.1 Code is on production

Web prod deploys by **Vercel CLI only** (Git integration is off). Confirm the
current production deployment is built from an `origin/main` commit that
includes the Phase 1–4 Integrations work (the `feat(statements)` /
`developer platform` commits and everything before them). If in doubt,
redeploy from a clean checkout:

```bash
git -C /tmp/ol-prod clone --depth 1 https://github.com/<owner>/personal-finance-engine.git . 2>/dev/null || \
  git -C /tmp/ol-prod fetch origin main
# from a fresh origin/main checkout of web/:
vercel pull --environment=production
vercel deploy --prod
```

Do **not** deploy from this worktree or any feature branch.

### 1.2 Database migrations are applied

All Integrations tables/RPCs/buckets ship as tracked migrations that
`deploy-supabase.yml` pushes on green `main` CI. Confirm the production
Supabase project has every migration through `20261124000000`:

```sql
select name
from supabase_migrations.schema_migrations
where name >= '20261026000000_integrations_capability_catalog'
order by name;
```

Expected (28 rows):

```
20261026000000_integrations_capability_catalog
20261027000000_integrations_foundation
20261028000000_integration_import_storage
20261029000000_integration_import_commit
20261030000000_integration_export_storage
20261031000000_integration_sync_and_health
20261101000000_integration_destinations
20261102000000_integration_workbook_storage
20261103000000_integration_conflicts
20261104000000_device_pairing_v2
20261105000000_capture_ingestion
20261106000000_raw_events_processor
20261110000000_bills_phase_1_intake_and_lifecycle
20261111000000_bills_phase_2_extraction
20261112000000_bills_phase_3_validation
20261113000000_bills_phase_4_duplicates
20261114000000_bills_phase_5_suppliers
20261115000000_bills_phase_6_matching_posting
20261116000000_bills_phase_7_review
20261117000000_balance_reconciliation_access
20261118000000_integration_accountant_packages
20261119000000_integration_accounting_connectors
20261120000000_integration_phase3_health
20261121000000_developer_api_keys
20261122000000_api_rate_limit
20261123000000_developer_webhooks
20261124000000_developer_platform_health
```

(The connector-model migrations `20261011000000`–`20261024000000` are earlier
still and are a hard dependency of `/integrations/connections`.)

### 1.3 Storage buckets exist and are private

Created by migrations `20261027`, `20261028`, `20261030`, `20261102`, `20261118`.

```sql
select id, public
from storage.buckets
where id in (
  'integration-imports', 'integration-exports',
  'integration-workbooks', 'integration-accountant-packages'
);
```

Every row must have `public = false`. Only `integration-imports` and
`integration-exports` matter for Track A; the other two are harmless when the
Workbooks / (large) Accountant paths are unused.

### 1.4 Capability catalog carries the `integration.*` family

```sql
-- owner should have every integration capability; member should have only view.
select public.space_role_has_capability('owner', 'integration.import');       -- t
select public.space_role_has_capability('owner', 'integration.import_approve'); -- t
select public.space_role_has_capability('owner', 'integration.export');       -- t
select public.space_role_has_capability('member', 'integration.view');        -- t
select public.space_role_has_capability('member', 'integration.import');      -- f
select public.space_role_has_capability('owner', 'integration.made_up_name'); -- f (fails closed)
```

### 1.5 Cron secret (only if you schedule the export worker in §4)

The export worker reuses the shared `/api/cron/*` secret
([`web/lib/cron-auth.ts`](../web/lib/cron-auth.ts)): `REPORT_CRON_SECRET` in
Vercel **production** env, and the byte-identical value in Supabase Vault as
`report_cron_secret`. Both already exist if the reporting, statement, or
account-deletion schedulers were ever activated (they were — see
[`supabase/scheduling/README.md`](../supabase/scheduling/README.md)). Confirm:

```sql
select name from vault.secrets where name = 'report_cron_secret';  -- 1 row
```

---

## 2. Rollout sequence

Do these in order. Each step is independently reversible (§6).

### Step 1 — Staged beta (single workspace)

In Vercel **production** environment variables, set:

```
INTEGRATIONS_ENABLED                        = true
INTEGRATIONS_WORKSPACE_ALLOWLIST            = 585655e8-...   # your own workspace id, comma-separated for more
INTEGRATIONS_IMPORT_STUDIO_ENABLED         = true
INTEGRATIONS_EXPORT_CENTER_ENABLED         = true
INTEGRATIONS_RECONCILIATION_CENTER_ENABLED = true
INTEGRATIONS_ACCOUNTANT_PACKAGE_ENABLED    = true
INTEGRATIONS_MARKETPLACE_ENABLED           = true
```

Leave every other `INTEGRATIONS_*`, `BALANCE_RECONCILIATION_ENABLED`, and every
`*_CLIENT_ID` / `*_SECRET` **unset**.

> The allowlist applies to **every** integration sub-flag, so a non-allowlisted
> workspace sees nothing regardless of the other flags. `"true"` is also the
> default for the "on unless `false`" flags — setting them explicitly just makes
> the intent auditable in the Vercel dashboard.

Redeploy production (`vercel deploy --prod` from the clean `origin/main`
checkout — flag-only changes still require a redeploy to take effect).

Run the smoke test (§3) as a user in the allowlisted workspace.

### Step 2 — Widen the beta

Add more workspace ids to `INTEGRATIONS_WORKSPACE_ALLOWLIST` (comma-separated,
no spaces). Redeploy. Give it a few days; watch the health snapshot (§5).

### Step 3 — General availability

Clear `INTEGRATIONS_WORKSPACE_ALLOWLIST` (empty = everyone). Redeploy. The area
is now visible to every Space owner/admin (and `/integrations` + Reconciliation
+ activity to members via `integration.view`).

### Step 4 — (optional) schedule the export worker

See §4. Not required for GA — small exports run inline; only >20 000-row
exports queue, and the 7-day file-retention purge is deferred — but recommended
before you advertise large exports.

---

## 3. Smoke test — the Definition of Success (§97) happy path

Run as a Space **owner** in an allowlisted workspace, on production.

1. **Find it.** Top nav / "More" → **Integrations**. The dashboard loads with a
   "Connected", "Recent activity" (may be empty), and "Move data" section.
2. **Import a file.** Move data → **Import Studio** → **Import data**. Upload a
   small real CSV of bank/MoMo transactions (10–50 rows). Expect a redirect to
   `/integrations/imports/<id>` showing detected structure.
3. **Map.** Columns are pre-filled from header names. Fix any wrong guess; the
   "N of M sample rows parse" counter updates live. Optionally **Save as
   template**.
4. **Validate.** Apply the mapping. Expect ready / to-review / invalid counts
   and a per-row issue list. Introduce a bad row (blank amount) in a second
   file to confirm it lands as `invalid` with a plain-language reason.
5. **Choose the account.** Set the target financial source.
6. **Review + commit.** In the staging review, approve the ready rows →
   **Commit**. Expect `created: N`. If you re-upload the same file and commit,
   expect `created: 0` (deterministic `payload_hash` — idempotent).
7. **See the ledger rows.** `/transactions` shows the imported rows;
   `source = import`; a near-duplicate lands in `/transactions/review` as
   `possible_duplicate`, never auto-merged.
8. **History.** `/integrations/imports` lists the batch with its counts.
   `/integrations/activity` shows `import.uploaded` / `import.mapped` /
   `import.committed`.
9. **Undo.** Open the committed batch → **Undo import**. Expect the un-edited
   rows removed and any hand-edited ones reported as retained.
10. **Export round-trip.** Move data → **Export Center** → pick XLSX, previous
    month, all accounts → generate → download the signed-URL file → open it:
    Summary / Transactions / … sheets, numeric cells are numbers, no cell
    starts with a raw `=`/`+`/`-`/`@`.
11. **Accountant package** (optional): `/integrations/accountant` → build a
    previous-month package → download the ZIP → confirm the PDF cover +
    `MANIFEST.json` + CSVs.
12. **Reconciliation Center**: `/integrations/reconciliation` loads; the
    balance-drift section is empty (expected — that source is off); other
    sections mirror the existing review queues.

**Negative checks:**

- As a Space **member** (not owner/admin): `/integrations` and
  `/integrations/reconciliation` load read-only; **Import data** / **Export**
  actions are absent and the server actions refuse (`integration.import` /
  `integration.export` not granted).
- As any user in a **non-allowlisted** workspace (during Steps 1–2):
  `/integrations` shows the "isn't enabled for this Space" empty state and every
  action refuses.
- File safety: uploading a `.xls`, a 12 MB file, or a `.txt` is rejected with a
  clear message and **nothing is written** (no `import_batches` row, no storage
  object).

---

## 4. Optional — schedule the export worker (`run-export-jobs`)

Only `run-export-jobs` is relevant to Track A. It: (a) runs `export_jobs` left
`queued` because the row estimate exceeded the 20 000-row inline threshold,
(b) re-claims jobs stuck `processing` past a 15-minute lease, (c) purges the
stored file of exports older than 7 days (history row kept). It is
cron-secret-authed and **not scheduler-wired**.

Activation SQL lives in
[`supabase/scheduling/activate_integration_export_worker.sql`](../supabase/scheduling/activate_integration_export_worker.sql)
— same manually-applied, non-tracked pattern as the other schedulers (it is
kept out of `supabase/migrations/` on purpose; see
[`supabase/scheduling/README.md`](../supabase/scheduling/README.md)).

### 4.1 Smoke-test the route first

```bash
curl -X POST https://www.oneledger.me/api/cron/run-export-jobs \
  -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"
```

Idempotent; with no queued/stuck jobs it returns zeroed counters. A `401` means
the header/secret is wrong; a `200` with counts means it's wired.

### 4.2 Schedule it

Run
[`supabase/scheduling/activate_integration_export_worker.sql`](../supabase/scheduling/activate_integration_export_worker.sql)
once, in full, in the production Supabase SQL editor. It creates
`pg_cron`/`pg_net`, re-declares the shared `call_report_cron_route()` helper
idempotently (byte-identical to the reporting scheduler — safe to run even if
that one already exists), and schedules `integration-export-jobs-tick`
(`*/10 * * * *`). Change the `base_url` in the file first only if the
production domain ever moves off `https://www.oneledger.me`.

### 4.3 Verify

```sql
select jobid, jobname, schedule, active from cron.job
  where jobname = 'integration-export-jobs-tick';
select * from cron.job_run_details
  where jobname = 'integration-export-jobs-tick'
  order by start_time desc limit 10;   -- status = 'succeeded'
```


---

## 5. Regression pass (§88) — run during Step 1 beta

Exercise each area as a normal user with Integrations on; confirm no behaviour
change vs. before the flags flipped:

| Area | Check |
| --- | --- |
| Transactions | list, detail, new, review queue, transfers — unchanged; imported rows carry `source = import` and a batch link |
| Categorization | rules still fire on non-import ingestion; imported rows are **uncategorised** (import doesn't assign categories — expected) |
| Reporting / daily report | figures unchanged; a committed import is reflected in the next period's totals |
| Budgets | actuals unaffected except by the (real) imported spend |
| Invoices / Bills | `/bills` unchanged (still its own gate; not folded into Integrations in Track A) |
| Auth / MFA | login, `/auth/*` unchanged |
| Workspace switching | switching Spaces re-scopes `/integrations` correctly; no cross-Space leakage of batches / templates / exports |
| Onboarding | first-run flow unchanged; no new mandatory step |
| Mobile | `/integrations`, Import Studio upload + mapping table, Export config are usable at 375 px; **no input-zoom on focus** (16 px controls) |
| Nav | "Integrations" entry appears only when `INTEGRATIONS_ENABLED` and the workspace is allowlisted; `/settings/connections` still redirects to `/integrations/connections` |
| Existing imports | statement import (`StatementImportFlow`) and bill extraction still work — they run **outside** the Integrations framework and are untouched |

Health snapshot (identifier-free, service-role):

```sql
select get_operational_health_snapshot() -> 'integrations';
```

Watch `import_batches_failed`, `import_review_backlog` + age,
`export_jobs_failed` / `_stuck`, `sync_runs_failed` (should stay 0 — sync is
off).

---

## 6. Rollback

Flag flip, no data touched, at any granularity:

- **Whole area off:** set `INTEGRATIONS_ENABLED = false` in Vercel prod,
  redeploy. Every `/integrations` route shows the disabled empty state and every
  server action + the RPC-gated commits refuse. Uploaded files, staged batches,
  committed transactions, templates, exports, and `integration_events` are all
  retained.
- **One surface off:** set just `INTEGRATIONS_IMPORT_STUDIO_ENABLED = false`
  (or `_EXPORT_CENTER_ENABLED`, etc.), redeploy.
- **Back to closed beta:** re-populate `INTEGRATIONS_WORKSPACE_ALLOWLIST`.
- **Unschedule the export cron:**
  ```sql
  select cron.unschedule('integration-export-jobs-tick');
  ```
  Leaves `call_report_cron_route()` and all export data untouched; large
  exports simply queue again with no worker, small ones still run inline.

A committed import that needs undoing is a **product** action, not a rollback:
open the batch → **Undo import** (`rollback_import_batch`).

---

## 7. Exit criteria for Track A

- [ ] §1 prerequisites all verified on production.
- [ ] Smoke test (§3) green, including negative checks, in the beta workspace.
- [ ] Regression pass (§5) shows no change outside Integrations.
- [ ] Beta widened to ≥3 workspaces for ≥3 days with `import_batches_failed`
      and `export_jobs_failed` at 0 in the health snapshot.
- [ ] `INTEGRATIONS_WORKSPACE_ALLOWLIST` cleared (GA).
- [ ] (optional) `integration-export-jobs-tick` scheduled and succeeding
      (`supabase/scheduling/activate_integration_export_worker.sql`).
- [ ] Gap analysis updated: G6 marked done, Track B (multi-domain import,
      connect wizard, register templates, workbook analyzer, E2E) is next.

---

## Verification performed while writing this runbook

Read: `web/lib/integrations/gate.ts`, `web/lib/cron-auth.ts`,
`web/app/api/cron/run-export-jobs/route.ts` (+ `deliver-webhooks`,
`run-integration-syncs` heads), `web/app/integrations/**` page/action files,
`web/.env.local.example` (Integrations block), `supabase/scheduling/README.md`
+ `activate_statement_workers.sql`, the `supabase/migrations/` listing, and
`docs/integrations-architecture.md`.

**Not verified at runtime:** production flag state, migration state, and Vault
contents were **not** queried (the Supabase MCP connection is a different
account) — §1 is written for the operator to run. The production domain
`https://www.oneledger.me` and the `585655e8-…` beta workspace id are taken
from existing docs / project history; confirm both before running §2.
