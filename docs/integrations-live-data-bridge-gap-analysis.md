# Integration & Live Data Bridge — gap analysis

**Date:** 2026-09-07
**Author:** Claude (discovery pass, no code changes)
**Scope:** Maps the 99-section "OneLedger Integration & Live Data Bridge" master
prompt against the code that already exists on `main`, grades every gap, and
proposes a PR sequence.

---

## 1. Headline finding

The Integration & Live Data Bridge described in the master prompt **is already
built** and deployed dark. It shipped as **Integrations Phases 1–4** (PRs #84,
#90, #100 + follow-ups), is documented in
[`docs/integrations-architecture.md`](integrations-architecture.md) (607 lines),
and lives under:

- `web/app/integrations/**` — 9 sub-areas (dashboard, connections, imports,
  exports, activity, sync, reconciliation, accountant, developer, marketplace)
- `web/app/api/v1/**` — read-only public REST surface
- `web/app/api/integrations/**` — OAuth, signed-download, error-report routes
- `web/lib/integrations/**` — 40+ modules, 19 unit-test files
- `supabase/migrations/2026101100…–20261124000000` — ~25 migrations, all
  workspace-scoped + RLS
- `web/lib/integrations/gate.ts` — 18 feature flags, server-enforced

The architecture matches the master prompt's mandated shape
(`External → Connector → Normalize → Validate → Dedupe → Inbox → Approval →
Ledger → Export → External`), the connector abstraction (ADR 0007), the
canonical field model, staged import lifecycle, conflict review that never
auto-resolves, hashed reveal-once credentials, and honest "dark until
credentials exist" provider stubs.

**Therefore the work here is gap-closure, not implementation.** A rebuild would
violate master-prompt §70 (no parallel importers), §94 (discovery discipline),
and §98 ("Is any functionality duplicated?").

### Verdict by theme

| Theme | State |
| --- | --- |
| Core import pipeline (upload→map→validate→dedupe→preview→commit→rollback) | **Complete** |
| Export (CSV/XLSX, filters, periods, cron, templates, signed download) | **Complete** |
| Connector abstraction + inbound connector SDK | **Complete** |
| Destinations (download, signed webhook, SSRF guard) | **Complete** |
| Connected workbooks (`manual_file` real; Sheets/Excel-365 dark) | **Partial — dark providers** |
| Accounting connectors (QuickBooks/Xero/Zoho/Odoo) | **Partial — all dark, export-only** |
| Reconciliation Center + Accountant package | **Complete** |
| Public REST API (read) + API keys + scopes + rate limit + request log | **Complete (read-only)** |
| Outbound webhook subscriptions | **Complete** |
| Marketplace catalog | **Complete** |
| RLS / tenant isolation / capability gating / audit | **Complete** |
| **Multi-domain import (invoices / expenses / income as first-class)** | **Expense + income done (Track B, PR B5)**; invoices blocked on the Bills schema |
| **Downloadable register templates** | **Done (Track B)** — Daily Sales / Expense / Cashbook; Invoice deferred to G1 |
| **Unified "add a connection" setup wizard** | **Done (Track B, PR B1)** |
| **"Connect existing business records" multi-sheet onboarding** | **Done (Track B, PR B3)** |
| **Public API write endpoints (POST/PATCH)** | **Missing (deferred by design)** |
| **Live spreadsheet sync (Sheets / Excel-365 OAuth)** | **Missing (stubs only)** |
| **E2E test coverage of the Integrations flows** | **Started (Track B, PR B4)** — happy-path + nav; RBAC-member negative deferred |
| **Production rollout (flags are unset)** | **Runbook shipped (PR #164); operator activation pending** |

---

## 2. Section-by-section map (all 99)

Legend — **Status:** ✅ done · 🟡 partial · ❌ missing · ➖ n/a (guidance, not a
deliverable). **Gap severity:** P1 (blocks the master-prompt Definition of
Success §97) · P2 (materially incomplete) · P3 (polish / nice-to-have) · — (none).

| § | Topic | Status | Evidence / gap | Sev |
| --- | --- | --- | --- | --- |
| 1 | Discovery-first mandate | ✅ | This document; `integrations-architecture.md` | — |
| 2 | Product objective: reusable integration platform | ✅ | Phases 1–4; `lib/integrations/**` | — |
| 3 | Integration layer mediates all external data | ✅ | `uploadImportFile` → staging → `commit_import_batch` RPC; no direct writes to `transactions` from external input | — |
| 4 | OneLedger as source of truth; no blind overwrite | ✅ | `integration_conflicts` never auto-resolved; `connected_workbooks.source_of_truth` default `oneledger` | — |
| 5 | Primary UX: Integrations area with view/add/configure/pause/test/health | 🟡 | `/integrations` + `/integrations/connections` + `/integrations/sync`. Per-connection pause/resume/test exist for **destinations & workbooks & webhooks**; there is no single "connected systems" surface unifying inbound connectors + outbound destinations + workbooks + ledgers | P2 |
| 6 | Initial connector types (Excel import, CSV import/export, XLSX export) | ✅ | `xlsx-read.ts` (exceljs), `csv.ts`, Export Center `buildCsv`/`buildXlsx` | — |
| 7 | Explicit direction per integration (in / out / two-way) | ✅ | `connected_workbooks.direction`, `integration_destinations.kind` | — |
| 8 | **Polished setup wizard** (choose connection → direction → data type → file → map → validate → preview → confirm → done) | 🟡→✅ | **Track B / PR B1**: `/integrations/connect` — searchParams-driven server wizard (source → direction → data type) that hands off to Import Studio / Export Center / connected workbooks for steps 4-9. `resolveConnectHandoff` in `connect-wizard.ts` (pure, deno-tested); non-file sources + non-transaction imports shown `coming_soon`, never linked live. | done (steps 1-3; 4-9 were already there) |
| 9 | Canonical financial data model | ✅ | `CANONICAL_IMPORT_FIELDS` (`model.ts`); reuses `transactions` schema, no parallel domain model | — |
| 10 | Reusable field-mapping engine, scoped per workspace/connection/type | ✅ | `mapping.ts` (pure, client+server); `import_templates` matched by `header_signature`, workspace-scoped RLS | — |
| 11 | Intelligent mapping assistance (deterministic → heuristic → AI, user confirms) | 🟡 | `suggestMapping` (header-name heuristics) + `profileTabularData` column guess. **No AI-assisted suggestion** despite `@anthropic-ai/sdk` in deps; acceptable per §11 ("AI must not be required") but listed as a gap | P3 |
| 12 | Data-type detection (dates, currencies, amounts, negatives, refs) | ✅ | `parseAmount` / `parseStatementDate` in `statement-import.ts`; thousands separators, `RWF 1,000,000`, split/signed handled | — |
| 13 | **Integration templates** (Daily Sales Register, Expense Register, Invoice Register, Cashbook) + downloadable formatted templates | 🟡→✅ | **Track B**: `/integrations/imports/templates` + `GET /api/integrations/imports/templates/[key]?format=csv\|xlsx` generate blank Daily Sales / Expense / Cashbook forms that auto-map on re-upload (`register-templates.ts`, `matchRegisterTemplate`). Invoice Register deferred to G1 (invoices aren't an import target). | done (Invoice → G1) |
| 14 | Safe staged import pipeline (RECEIVED→…→IMPORTED + exception states) | ✅ | `IMPORT_BATCH_STATUSES` (9) + `IMPORT_RECORD_STATUSES` (10); `commit_import_batch` is transactional, deterministic `payload_hash` | — |
| 15 | Integration Inbox (exception review) | ✅ | `ImportStagingReview.tsx` (status chips, bulk approve/ignore/reopen); Financial Inbox `import_review` item | — |
| 16 | Duplicate detection, multi-layer, external IDs, uncertain → review | ✅ | `matching.ts` (exact/likely/possible/distinct + explainable signals) + Space fingerprint in `commit_import_batch` → `dedupe_state='possible_duplicate'`, never auto-merged | — |
| 17 | Record provenance | ✅ | `transactions.import_batch_id` FK + `source='import'` CHECK; `integration_events` trail | — |
| 18 | Sync mapping / external record registry | 🟡 | `import_records` links external row → `canonical_transaction_id`; `connected_workbooks.last_sync_run_id`. There is **no general `integration_record_links` table** spanning every connector — fine today (only imports create ledger rows), a gap when live sync lands | P3 |
| 19 | Conflict resolution, explicit policies, high-impact fields → manual | ✅ | `integration_conflicts` + `apply_integration_conflict` RPC restricted to `category`/`description` only; amount/currency/direction never auto-applied | — |
| 20 | Data validation layer | ✅ | `validation.ts` — date/amount/zero/direction/currency/dup-id/description, blocking vs warning vs info. Org-configurable rules not built (§20 says don't overbuild) | — |
| 21 | User-controlled automation safety (default = manual confirm) | ✅ | Import always requires explicit `commitImportBatch`; schedules opt-in, `INTEGRATIONS_SYNC_ENABLED` off by default | — |
| 22 | OneLedger → external export through the same abstraction | ✅ | Export Center; `export_jobs` + `export_schedules` + `integration_destinations` | — |
| 23 | Live data feed architecture (authenticated, revocable, rate-limited, audited) | 🟡 | `/api/v1` read endpoints + signed 300s export URLs satisfy the "feed" concept. **No streaming/long-lived feed or time-limited public feed URL** beyond the per-export signed link | P3 |
| 24 | API foundation (GET/POST transactions, expenses, invoices, accounts, balances, reports) | 🟡 | GET `/api/v1/{ping,transactions,transactions/[id],accounts,categories,exports,exports/[id],sync-runs,events}`. **No expenses/invoices/balances/reports/budgets GET; no POST anywhere** | P2 |
| 25 | API authentication (keys hashed, reveal-once, revoke, rotate, expire, last-used) | ✅ | `api_keys` (`olk_`, SHA-256 `key_hash`, `scopes[]`, `expires_at`, `status`); `ApiKeyManager.tsx` reveal-once + revoke. **Rotation and last-used display are thin** (revoke+recreate only) | P3 |
| 26 | Scoped integration permissions, enforced server-side | ✅ | six `*:read` scopes, `hasScope` check in `withApiV1`; never UI-only | — |
| 27 | Org / workspace authorization on every server path | ✅ | `requireImportAccess` → `has_space_capability`; `/api/v1` pins a service-role client to the key's `workspace_id`; RLS on every table | — |
| 28 | Webhook architecture (signed, delivery IDs, retries, idempotency, disable, redeliver) | ✅ | `webhook_subscriptions` + separate secret table; HMAC-SHA256; `nextAttemptState` retry ≤5; auto-`failing` after 3 terminal/hr; `deliver-webhooks` cron. **Manual redelivery from the UI is not exposed** | P3 |
| 29 | Event-driven architecture (domain events fan out) | 🟡 | `fireWebhookEvent` fans out from emit sites (`export/run.ts`, `accountant/build.ts`, `accounting/sync.ts`). It is **call-site fan-out, not a real event bus** — `transaction.created` etc. are not emitted from the ledger write path, so a webhook consumer can't see imported transactions land. §29 explicitly permits "simplest robust architecture", but the event catalog is narrower than §28's list | P2 |
| 30 | Background jobs for parse / import / export / sync / webhooks | ✅ | crons: `run-export-jobs`, `run-integration-syncs`, `deliver-webhooks`, `build-accountant-packages`, `run-balance-reconciliation`, `purge-api-logs`; claim/lease pattern | — |
| 31 | Retry strategy, bounded, backoff, differentiate error classes | ✅ | `sync-engine.ts` — `classifyFailure` (transient/permanent/needs_auth), `backoffSeconds` (60·2ⁿ ≤1h), `MAX_SYNC_ATTEMPTS=5` | — |
| 32 | Idempotency | ✅ | deterministic `import|batch|row` `payload_hash`; `webhook_deliveries.payload_digest` fixed at enqueue; `api_rate_take` fixed-window | — |
| 33 | Connection status model (no false "Connected") | ✅ | `getConnectedSummary` prefers canonical installations w/ `healthy/error/stale`; dark providers labelled "(not configured yet)", never "connected" | — |
| 34 | Sync history per connection | ✅ | `integration_sync_runs` (counts, cursor, retry state); `/integrations/sync/runs/[id]` | — |
| 35 | Connection activity log | ✅ | `integration_events` (append-only, redacted); `/integrations/activity` | — |
| 36 | Security audit logging (actor, workspace, timestamp, action, resource; no secrets) | 🟡 | `record_space_audit_event` fired from the SECURITY DEFINER RPCs (`import.committed`, `import.rolled_back`, `conflict_resolved`). **Non-RPC paths (upload, mapping, export, template, destination CRUD, key CRUD) write only `integration_events`, not `space_audit_events`** — documented as deferred but is a real §36 gap | P2 |
| 37 | AI responsibility (deterministic transport; AI only for interpretation) | ✅ | No AI in the transport/validation/dedupe path | — |
| 38 | Reconciliation participation | ✅ | Reconciliation Center unifies balance drift + payment matches + import dups + workbook conflicts | — |
| 39 | Spreadsheet change tracking by stable IDs, not row position | 🟡 | `workbooks/diff.ts` matches by external id else amount+direction+day+description. **No injected hidden record-id column** in the generated workbook, so re-matching after a user sorts/inserts rows leans on the heuristic | P2 |
| 40 | OneLedger-generated connector workbook | 🟡 | `connected_workbooks` `manual_file` mode writes a full `.xlsx` (Summary/Transactions/Income/Expenses/Categories/Accounts). **Not surfaced as a one-click "Create OneLedger Workbook"**; requires the dark Workbooks flag | P3 |
| 41 | **"Connect existing business records" onboarding** (upload workbook → analyze sheets → candidate tables → counts → mapping suggestions) | 🟡→✅ | **Track B / PR B3**: `/integrations/imports/analyze` + `workbook-analyzer.ts` (pure, deno-tested) classify every sheet `transactions|unrecognised|empty` with hedged confidence + counts + date range + template match; `analyzeWorkbookUpload` (read-only) then `createImportBatchesFromWorkbook` stages one batch per chosen sheet. Candidate types beyond transactions wait on G1. | done (transactions; other types → G1) |
| 42 | Import preview experience (what will be created, counts, account, categories, dups, invalid; sampled rows, paginated) | 🟡 | `/integrations/imports/[id]` shows ready/review/invalid counts + per-row status/issues. **Sampling/pagination for large batches is limited; category assignment preview is absent** (import doesn't assign categories) | P2 |
| 43 | Error experience (plain language, not `422 INVALID_SCHEMA`) | ✅ | `validation.ts` messages are human ("The amount could not be read."); `xlsx-read` gives ".xls → re-save as .xlsx" | — |
| 44 | Empty states | ✅ | `EmptyState` used across `/integrations/**` | — |
| 45 | Loading & progress states, prevent double-submit | 🟡 | `ImportUploadForm` retryable; `loading.tsx` per route. **No multi-stage progress ("analyzing → validating → importing") and no disable-during-commit is verified across every form** | P3 |
| 46 | Responsive design; no mobile input-zoom regression; usable mapping table on mobile | 🟡 | `ImportMappingForm` documented "16px controls, mobile stacked". **Not verified by an e2e/responsive test**; `responsive-matrix.spec.ts` doesn't cover `/integrations` | P2 |
| 47 | Accessibility (keyboard, labels, focus, SR status, semantic controls) | 🟡 | `aria-labelledby` on sections; project has `accessibility.spec.ts` + `bills-a11y.spec.ts`. **No `integrations-a11y` e2e**; staging review bulk bar / mapping selects unaudited | P2 |
| 48 | Performance (no sync parse of huge files, chunking, virtualization, batched inserts, no N+1) | 🟡 | Server-side parse; `RECORD_CHUNK=500` upserts; batch capped at **5000 rows** and file at **10 MB**. **No streaming/background parse for large files, no virtualized row table**; the cap is a hard limit, not a scale strategy | P2 |
| 49 | File security (MIME/ext/size/parse bounds; no formula execution; safe names) | ✅ | `fileKind` ext allow-list, `MAX_BYTES`, parse-before-persist, `sanitizeFilename`; exceljs reads formulas as their cached `result`, never evaluates | — |
| 50 | CSV/Excel formula-injection protection on export | ✅ | `export/csv-safe.ts` neutralises `= + - @ TAB CR` → `'`-prefix, for CSV and exceljs string cells; `/api/integrations/imports/[id]/errors` guarded | — |
| 51 | Rate limiting on integration endpoints | 🟡 | `/api/v1` per-key fixed-window (`API_RATE_LIMIT_PER_MINUTE=120`). **Server actions (upload/commit/export) have no rate limit**; webhook receiver n/a (outbound only) | P3 |
| 52 | Database design (FKs, indexes, uniqueness, workspace scoping, timestamps, safe delete) | ✅ | ~25 migrations; every table `workspace_id` + RLS + `created_at/updated_at`; `on delete set null` for `import_batch_id` | — |
| 53 | Row-level security on every tenant table; cross-tenant tests | 🟡 | RLS SELECT gated on `integration.view`; writes service-role/RPC only. **Cross-tenant negative tests are unit-level (`*_test.ts` on pure logic), not DB-level pgTAP** — `supabase/migrations/tests` exists but has no integration-table coverage | P2 |
| 54 | Deletion semantics (disconnect ≠ delete imported data; preserve audit) | ✅ | `rollbackImportBatch` removes only un-merged/un-edited batch rows, reports retained; disconnect actions stop sync, keep records | — |
| 55 | Feature flags for staged rollout | ✅ | `gate.ts` — 18 flags, allowlist, server-enforced on every route+action | — |
| 56 | Analytics events | 🟡 | `integration_events` is the durable product-event store (no analytics provider is wired anywhere in the codebase — consistent with the rest of the app). §56's named events are **not all emitted** (`integration_setup_started`, `mapping_changed` are) | P3 |
| 57 | Monitoring (job failures, parse failures, queue backlog, dup-rate spikes) | ✅ | `get_operational_health_snapshot` `integrations` block — batches/exports/schedules/sync-runs/conflicts/accountant/ledger/api/webhook counters, identifier-free | — |
| 58 | Data privacy (don't over-copy; retention on temp files) | ✅ | Import files purged? — **export** files purged after 7d, accountant packages after 30d, api logs after 30d. **Import upload files have no documented retention purge** | P3 |
| 59 | Notifications only when useful | ✅ | in-app `notifications` on schedule failure, workbook/ledger `needs_auth`, webhook `failing`, accountant build failure; no per-success noise | — |
| 60 | Integration dashboard with connection cards | 🟡 | `/integrations` shows a "Connected" list + activity + "Move data" cards. **Not the rich per-connection card** (status / direction / last sync / "34 imported, 2 dup, 1 review" / inline actions) from §60 | P2 |
| 61 | Connection details page (Overview / Mapping / Activity / Issues / Settings tabs) | 🟡 | `ConnectionDetails.tsx` exists for canonical connector installations; workbook/destination detail is a run list. **No tabbed detail page** for the outbound side | P3 |
| 62 | Sync-now action, guarded against duplicate concurrent jobs | ✅ | `syncWorkbookNow`, `createExportJob`; cron claim/lease prevents double-run | — |
| 63 | Pause / resume | ✅ | `setWorkbookStatus`, destination `updateDestination`, webhook pause/resume, `export_schedules.enabled` | — |
| 64 | Credential-expiration states (token expired / revoked / reconnect) | ✅ | `needs_auth` status class + `markNeedsAuth`; OAuth routes 501 while dark | — |
| 65 | Future connector abstraction (connect/validate/disconnect/list/read/write/fetchChanges/refreshAuth) | ✅ | `_shared/connector-adapter.ts` `defineConnectorAdapter`; `WorkbookAdapter`, `AccountingAdapter`, `CloudStorageClient` interfaces | — |
| 66 | Connector responsibility boundary (provider logic stays in the connector) | ✅ | central engine owns normalize/validate/dedupe/jobs/audit/retry; adapters are provider-only | — |
| 67 | Future connectors compatible (Sheets, Excel-365, QB, Xero, Odoo, Zoho, Power BI, n8n, Make, Zapier) | 🟡 | All scaffolded; **Sheets/Excel-365/QB/Xero/Zoho/Odoo are dark** (real OAuth, stubbed read/write). Power BI / n8n / Make / Zapier rely on the read API + webhooks (present) | P2 |
| 68 | n8n / automation readiness (stable payloads) | ✅ | `/api/v1` cursor-paginated redacted JSON; webhook envelope `oneledger.export.ready` etc. stable | — |
| 69 | Don't build an internal spreadsheet replacement; keep canonical model open | ✅ | No Tables feature; canonical model is the ledger schema | — |
| 70 | Consolidate existing import/export; don't fork | 🟡 | Statement import (`lib/statement-import.ts`, `StatementImportFlow.tsx`, migration `20260925…`) and bills extraction still run **outside** the Integrations framework. §70 says migrate carefully — not yet done | P2 |
| 71 | Coexist with existing ingestion (SMS, Shortcuts, Android, statements, invoices, email/PDF) | ✅ | Import Studio is additive; canonical connector model (`20261011…`) already unifies inbound sources; `source` CHECK widened, not replaced | — |
| 72 | Financial integrity (no silent money/currency/dup/delete/conflict changes) | ✅ | see §16, §19, §54; `apply_integration_conflict` scoped to non-financial fields | — |
| 73 | Transaction boundaries for bulk import (atomic / per-row / chunked / resumable) | ✅ | `commit_import_batch` SECURITY DEFINER, per-row FK-violation catch, deterministic hash makes re-run a no-op (resumable) | — |
| 74 | Recoverability (retry / fix mapping / reconnect / resolve / download error report) | ✅ | re-map allowed until committed; `rollbackImportBatch`; `/api/integrations/imports/[id]/errors` CSV | — |
| 75 | Error-report export for failed bulk imports | ✅ | "download invalid rows" CSV in `ImportStagingReview` | — |
| 76 | Import history | ✅ | `/integrations/imports` list; `export` history on `/integrations/exports` | — |
| 77 | File-name privacy | 🟡 | `original_filename` stored (needed for the history UI) and used in `integration_events.summary`. Not sent to analytics (none exist). §77 is "avoid unless necessary" — borderline OK, worth a note | P3 |
| 78 | Export filters (date range, account, category, type, status) | 🟡 | Export Center: period + account + direction. **No category / status filter**; §78 says "reuse existing filtering logic" (transaction filters are richer) | P3 |
| 79 | i18n — don't hardcode date/amount formats | 🟡 | `parseStatementDate` takes an explicit `DateOrder`; `defaultCurrency` configurable. **Supported-currency list is hard-coded** in `validation.ts` (`["RWF","USD","EUR","GBP","KES","UGX","TZS"]`) not read from workspace/config | P2 |
| 80 | Timezones — don't shift date-only records | 🟡 | `schedule.ts` notes "DST not modelled; timezone stored but always UTC". Import `occurred_at` is an ISO instant from `parseStatementDate` — **date-only source rows get a UTC midnight**, which can shift the business-local day | P2 |
| 81 | Currency — never assume RWF | 🟡 | Mapping carries currency; **`validation.ts` still defaults its supported set RWF-first and the Space default is "assumed" silently on missing-currency rows** (warning only) | P3 |
| 82 | Testing strategy (unit + integration + E2E, incl. failure cases) | 🟡→✅ | **Unit: strong** (22 files). **E2E (Track B / PR B4):** `e2e/integrations-nav.spec.ts` (connect wizard, templates picker + download API, analyze page — cross-browser) + `e2e/integrations-import.spec.ts` (upload → map → commit → ledger, file-type rejection, 2-sheet workbook analyze — chromium). DB-level pgTAP + more negatives still open (§84). | done for imports/wizard/templates/analyze |
| 83 | Test data / fixtures (clean, missing cols, malformed dates, dup IDs, multi-sheet, large, mixed currency, empty, formula cells, string-numbers, unknown categories, invalid accounts) | ❌ | No `web/e2e/fixtures/integrations/**` or equivalent spreadsheet corpus | P2 |
| 84 | Security testing (unauth create, cross-tenant reads, manipulated workspace IDs, bad/revoked keys, replayed webhooks, malicious names, oversize, formula injection, malformed files) | 🟡 | `webhook_test.ts` covers SSRF + signing; `csv-safe_test.ts` covers injection. **No cross-tenant / bad-key / oversize / replay e2e or integration tests** | P2 |
| 85 | Performance testing / documented limits | 🟡 | Limits exist (10 MB, 5000 rows, 20000-row inline-export threshold) but are **not benchmarked or documented as a limits table** | P3 |
| 86 | Concurrency testing (double import, overlapping sync, simultaneous mapping edits, repeated sync-now, disconnect mid-sync) | 🟡 | Cron claim/lease + deterministic hash make these safe by construction; **no test proves it** | P3 |
| 87 | Build quality (typecheck, lint, tests, prod build; no suppressed errors) | ✅ | `eslint.config.mjs`, `tsconfig.json`, deno unit tests, Playwright; CI green on `main` (per project memory) | — |
| 88 | Regression review across transactions/categorization/reporting/budgets/invoices/auth/onboarding/mobile | ➖ | Process item — run at rollout | — |
| 89 | Migration safety (deterministic, reversible where practical, prod-safe, tenant-aware) | ✅ | 25 forward migrations already applied to prod per project memory; additive `source` CHECK, nullable FK | — |
| 90 | Deployment order (backward-compatible migration → backend → frontend → flag) | ✅ | documented per phase in `integrations-architecture.md`; `gate.ts` is the activation lever | — |
| 91 | Documentation (architecture, dev docs, API ref, connector guide, env vars, webhook signing, file requirements, troubleshooting) | 🟡 | 13 `docs/integrations-*.md` files exist. **No consolidated API reference page, no public "import file requirements" doc, no operator troubleshooting runbook** | P3 |
| 92 | In-product help content | ❌ | No seeded help/《how import mapping works / what duplicates mean》content in the Integrations UI | P3 |
| 93 | Admin / support visibility into connection health | 🟡 | `get_operational_health_snapshot` feeds ops; `/admin` exists. **No admin surface for per-workspace connection health** | P3 |
| 94 | Implementation discipline (discovery → architecture → impl → integrate → QA → refine → validate) | ✅ | this pass = discovery/architecture stage of the remaining work | — |
| 95 | No client-specific code | ✅ | nothing tenant-hardcoded; RWF-first currency list (§79/81) is the only whiff | — |
| 96 | Progressive adoption (spreadsheet → connected → OL authoritative → spreadsheet optional) | ✅ | manual import → saved templates → schedules → connected workbooks is exactly this ladder | — |
| 97 | **Definition of success** (business owner does the full self-serve import + export round-trip) | 🟡 | Steps 1, 4–14 work for a **CSV/XLSX of transactions**. Steps 2–3 ("find Integrations", "choose spreadsheet import") need the area **turned on** (flags unset) and the §8 wizard; multi-domain (invoices/expenses) fails | **P1** |
| 98 | Final engineering review checklist | ➖ | Run at the end of gap-closure | — |
| 99 | Final implementation report | ➖ | Deliverable of the eventual work | — |

**Tally:** ✅ 48 · 🟡 38 · ❌ 6 · ➖ 7 _(as of the discovery pass)_. **Track B shipped since:** §13 ❌→✅ (#165), §8 🟡→✅ (#166), §41 🟡→✅ (#167), §82 🟡→✅ (e2e, #168), §9/§24 category + expense/income import (PR B5). Track B complete bar invoice import (Bills-schema-blocked). See the gap register rows for detail.

---

## 3. Consolidated gap register (severity-ranked)

### P1 — blocks the Definition of Success (§97)

| ID | Gap | Sections | Notes |
| --- | --- | --- | --- |
| G1 | **Multi-domain import.** | 8(step 3), 13, 24, 97 | **PARTLY DONE (Track B, PR B5)** — `import_batches.target_object` (`transaction`/`expense`/`income`, migration `20261125000000`); expense/income are constrained modes over the `transactions` target (server forces `all_out`/`all_in` + requires a category). `commit_import_batch` now also persists the mapped category (`category_source='system'`), fixing a pre-existing silent drop. Connect wizard's expense/income data types are live. **Invoices deferred** — `public.bills.bill_document_id` is `NOT NULL` + `bills_one_per_document`, so a bill needs an uploaded document; spreadsheet invoice import would be a Bills-program schema change. |
| ~~G2~~ | ~~**Unified "add a connection" setup wizard.**~~ **DONE (Track B, PR B1)** — `/integrations/connect` (searchParams server wizard, `StepWizard` chrome) + `connect-wizard.ts` (pure resolver, 10 deno tests). Source → direction → data type, then `<Link>` straight into `/integrations/imports/new` / `/integrations/exports` / `/integrations/sync`. "Connect a system" CTA added to the `/integrations` header. No action/table/flag. | 5, 8, 60, 97 | Was "mostly a shell". |
| ~~G3~~ | ~~**Downloadable register templates** (Daily Sales, Expense, Invoice, Cashbook) + "download a blank template".~~ **DONE (Track B, PR B2)** — `register-templates.ts` (pure, deno-tested) + `register-templates-workbook.ts` (server-only xlsx) + `/api/integrations/imports/templates/[key]` + `/integrations/imports/templates` picker; auto-maps on re-upload via `matchRegisterTemplate`. Invoice Register → G1 (not an import target yet; shipping it would break §6/§8). | 13 | Was "Small". |
| ~~G4~~ | ~~**"Connect existing business records" onboarding** — multi-sheet workbook analyzer.~~ **DONE (Track B, PR B3)** — `workbook-analyzer.ts` (`analyzeSheet`/`analyzeWorkbook`, 7 deno tests) + `/integrations/imports/analyze` + `WorkbookAnalyzeForm` + `analyzeWorkbookUpload` (read-only) / `createImportBatchesFromWorkbook` actions (refactor extracts `parseUploadFile` + `stageImportBatch` from `uploadImportFile`). One batch per chosen sheet, `detected.sheetName` recorded. No migration. | 41 | Was P1. |
| G5 | **E2E + integration test coverage** for the Integrations flows. | 82, 83, 84, 86 | **PARTLY DONE (Track B, PR B4)** — `integrations-nav.spec.ts` + `integrations-import.spec.ts` (upload→map→commit→see txn happy path, file-type rejection, workbook analyze; `ensureImportTargetSource` / `cleanupImportArtifacts` seed helpers). **Still open:** RBAC-member negative, re-commit idempotency spec, export/webhook/API/reconciliation e2e, DB-level pgTAP cross-tenant. |
| ~~G6~~ | ~~**Production rollout** — every `INTEGRATIONS_*` flag is unset.~~ **Runbook DONE** — [`integrations-rollout-runbook.md`](integrations-rollout-runbook.md) + [`activate_integration_export_worker.sql`](../supabase/scheduling/activate_integration_export_worker.sql), shipped as docs-only PR #164 (branch `docs/integrations-rollout-runbook`). Remaining is operator execution (flip flags per the staged sequence, run the smoke test + regression pass), not an engineering task. | 55, 88, 90, 97 | Was the cheapest P1. |

### P2 — materially incomplete

| ID | Gap | Sections |
| --- | --- | --- |
| G7 | Rich per-connection dashboard cards + unified "connected systems" view (inbound + outbound + workbooks + ledgers in one place). | 5, 60 |
| G8 | `space_audit_events` from the non-RPC integration paths (upload, mapping, export, template, destination/key CRUD). | 36 |
| G9 | Domain-event emission from the ledger write path (`transaction.created` etc.) so webhook/API consumers see imported data, not just export lifecycle. | 28, 29 |
| G10 | Public API breadth: GET `/expenses`, `/invoices`, `/balances`, `/budgets`, `/reports`; decide on write endpoints (currently deferred). | 24 |
| G11 | Timezone / date-only handling on import — preserve business-local day, don't UTC-shift. | 80 |
| G12 | Workspace-configured supported-currency list instead of the hard-coded set in `validation.ts`. | 79, 81 |
| G13 | Large-file strategy — streaming/background parse + virtualized preview table; raise or justify the 10 MB / 5000-row caps. | 42, 48 |
| G14 | Consolidate statement import + bills extraction under the Integrations framework (or document why they stay separate). | 70 |
| G15 | Stable hidden record-id column in generated/round-tripped workbooks for reliable re-matching. | 39 |
| G16 | Responsive + a11y e2e for `/integrations/**` (mapping table on mobile, bulk bar, selects). | 46, 47 |
| G17 | DB-level (pgTAP) cross-tenant RLS tests for the integration tables. | 53 |
| G18 | Finish or formally defer the dark connectors (Sheets, Excel-365, QuickBooks, Xero, Zoho, Odoo) — real `readRecords`/`writeRecords`. | 7, 67 |

### P3 — polish / nice-to-have

| ID | Gap | Sections |
| --- | --- | --- |
| G19 | AI-assisted mapping suggestions (optional, behind the existing `@anthropic-ai/sdk`). | 11 |
| G20 | General `integration_record_links` registry spanning all connectors. | 18 |
| G21 | Multi-stage progress UI + verified double-submit guards on every form. | 45 |
| G22 | Manual webhook redelivery from `WebhookManager`; API-key rotation + last-used display. | 25, 28 |
| G23 | Import-upload-file retention purge cron. | 58 |
| G24 | Export category/status filters (reuse transaction filters). | 78 |
| G25 | Rate-limit the mutating server actions. | 51 |
| G26 | Consolidated API reference doc + import file-requirements doc + operator troubleshooting runbook. | 91 |
| G27 | In-product help content in the Integrations UI. | 92 |
| G28 | Admin per-workspace connection-health surface. | 93 |
| G29 | "Create OneLedger Workbook" one-click surface (outside the dark Workbooks flag). | 40 |
| G30 | Documented limits table + benchmark + concurrency test notes. | 85, 86 |
| G31 | Tabbed connection-detail page for the outbound side (Overview/Mapping/Activity/Issues/Settings). | 61 |
| G32 | Long-lived / time-limited public data-feed URL beyond per-export signed links. | 23 |
| G33 | Emit the remaining named analytics events (`integration_connected`, `sync_completed`, …) into `integration_events`. | 56 |

---

## 4. Recommended PR sequence

Ordered for value-per-risk. Each is independently shippable behind the existing
flags; nothing here reshapes the core.

**Track A — turn on what exists (do first, ~1 PR + ops)**

1. ~~**PR A1 — Rollout runbook & staging activation (G6).**~~ **DONE — PR #164**
   (docs-only). `integrations-rollout-runbook.md` (flag sequence
   `INTEGRATIONS_ENABLED` → import/export → allowlist beta → GA, prerequisite
   verification SQL, §97 smoke test, §88 regression pass, rollback) +
   `activate_integration_export_worker.sql`. Operator executes the runbook to
   unblock §97 steps 2–3 for the transaction happy path.

**Track B — Definition-of-Success gaps (core value)**

2. ~~**PR B1 — Unified connect wizard (G2).**~~ **DONE.** `/integrations/connect`
   — a searchParams-driven server wizard (source → direction → data type) over
   `components/ds/StepWizard`, then `<Link>` straight into
   `/integrations/imports/new` / `/integrations/exports` / `/integrations/sync`.
   `connect-wizard.ts` (pure resolver + catalogs, 10 deno tests); non-file
   sources and non-transaction imports are `coming_soon`, never linked live
   (§5/§6). "Connect a system" CTA added to the `/integrations` header. No
   action, table, capability or flag.
3. ~~**PR B2 — Register templates + blank-template download (G3).**~~ **DONE.**
   Shipped as static, code-defined templates (not per-workspace seed rows):
   `register-templates.ts` (Daily Sales / Expense / Cashbook, each with its
   mapping) + `register-templates-workbook.ts` (xlsx) + a download route + a
   `/integrations/imports/templates` picker. `matchRegisterTemplate` slots
   into the `/integrations/imports/[id]` pre-fill chain so a filled-in
   template auto-maps. Invoice Register moves to PR B4/B5 (G1).
4. ~~**PR B3 — Multi-sheet workbook analyzer / "connect existing records" (G4).**~~
   **DONE.** `workbook-analyzer.ts` (pure classifier) + `/integrations/imports/analyze`
   (`WorkbookAnalyzeForm` client) + `analyzeWorkbookUpload` (read-only) and
   `createImportBatchesFromWorkbook`. `uploadImportFile` refactored to share
   `parseUploadFile` + `stageImportBatch`. Each chosen sheet -> its own batch ->
   the normal map/validate/review/commit flow. No migration/flag.
5. ~~**PR B4 — Multi-domain import: expenses (G1, slice 1).**~~ / ~~**PR B5 — invoices + income.**~~
   **DONE as one PR (B5).** `import_batches.target_object` + a `commit_import_batch`
   `create or replace` (also fixes the mapped-category silent drop);
   `validation.ts requireCategory`; `applyImportMapping` forces the amount mode
   + category requirement server-side; `/integrations/imports/new?target=…`,
   `ImportMappingForm` lock, connect-wizard routing. **Invoices stay deferred** —
   `bills.bill_document_id NOT NULL` blocks spreadsheet invoice import without a
   Bills-domain change. Original note kept below:
   `target_object`
   column on `import_batches`; expense canonical fields + validation + commit
   RPC reusing the bills/expense tables. Prove the pattern on one domain.
6. **PR B5 — Multi-domain import: invoices + income (G1, slice 2).** Same
   pattern, remaining domains.
7. ~~**PR B6 — E2E + fixtures (G5).**~~ **STARTED as PR B4** (moved ahead of G1
   to back the multi-domain work). `integrations-nav.spec.ts` +
   `integrations-import.spec.ts` cover the connect wizard, templates,
   analyzer, and the upload→map→commit→ledger happy path. Remaining G5 scope
   (RBAC-member negative, export/webhook/API e2e, pgTAP cross-tenant) folds
   into later PRs. Original note kept below:
   `integrations.spec.ts` happy path +
   cross-tenant / bad-key negatives; `web/e2e/fixtures/integrations/**` corpus
   from §83; `integrations-a11y.spec.ts` (also closes G16).

**Track C — correctness & platform hardening**

8. **PR C1 — Timezone/date-only + configurable currencies (G11, G12).** Preserve
   business-local day on import; read supported currencies from workspace config.
9. **PR C2 — Audit completeness (G8).** Route the non-RPC integration writes
   through `record_space_audit_event` (move them behind SECURITY DEFINER RPCs
   or add a service-role-callable audit shim).
10. **PR C3 — Domain events + API breadth (G9, G10).** Emit `transaction.*` /
    `invoice.*` / `expense.*` from the ledger write path into the webhook
    dispatcher; add the missing read endpoints. Decide write-endpoint policy.
11. **PR C4 — Dashboard cards + connected-systems view (G7).** Rich per-connection
    cards (status/direction/last-sync/result/actions) and one unified list.
12. **PR C5 — Large-file strategy (G13).** Background/streamed parse for files
    over a threshold; virtualized preview table; revisit the caps.
13. **PR C6 — Consolidate statement import + bills extraction (G14, G15).**
    Bring them under the framework or document the boundary; add the hidden
    record-id column for round-trip matching.
14. **PR C7 — pgTAP cross-tenant RLS tests (G17).**

**Track D — connectors & polish (schedule against demand)**

15. **PR D1 — Finish or formally defer dark connectors (G18).** Pick the first
    real provider (likely Google Sheets), implement `readRecords`/`writeRecords`,
    or write an ADR deferring all of them with the criteria to revisit.
16. **PR D2 — Polish batch (G19–G33).** Group the P3s into 2–3 small PRs
    (docs+help; UI progress/redelivery/rotation; retention+filters+rate-limits).

---

## 5. Verification performed & limitations

**Read:** `docs/integrations-architecture.md`; `web/lib/integrations/`
`model.ts`, `gate.ts`, `mapping.ts`, `validation.ts`, `matching.ts`,
`sync-engine.ts`, `activity.ts`; `web/lib/xlsx-read.ts`, `web/lib/csv.ts`;
`web/app/integrations/page.tsx`, `imports/new/page.tsx`, `imports/actions.ts`,
`connections/setup/page.tsx`; `web/lib/api/handler.ts`; `web/lib/navigation.ts`
(integration entries); migration filenames; `web/e2e/` listing;
`web/lib/integrations/**` test-file listing; `web/components/` integration
components listing; `web/package.json`.

**Not read (assumed correct from the architecture doc + tests):** the SECURITY
DEFINER RPC bodies (`commit_import_batch`, `rollback_import_batch`,
`apply_integration_conflict`), the migration SQL, `queries.ts` (794 lines),
the webhook/destination/workbook/accounting runtime modules, every
component's JSX, the cron route handlers.

**Not verified at runtime:** nothing was executed; no DB was queried; flag
state in prod is inferred from `web/.env.local.example` (all `INTEGRATIONS_*`
keys present but unset) and project memory, not from Vercel.

**Confidence:** high on "the platform exists and matches the master-prompt
architecture"; medium on the exact P2/P3 gap boundaries (some may already be
half-addressed inside files not read).
