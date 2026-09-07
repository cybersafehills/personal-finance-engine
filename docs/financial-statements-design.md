# OneLedger Financial Documents Engine — Statements

A **Statement** is a factual, period-scoped, per-account (or consolidated) record of financial
activity, generated **from** the OneLedger ledger and rendered as an immutable **PDF** (primary) or
**CSV** (secondary). It is built for accountants, lenders, employers, auditors and visa/documentation
processes: reproducible, traceable, financially correct, with clear source attribution.

Statements are the first family in a broader **Financial Documents Engine**. The engine deliberately
leaves clean extension points (see [Deferred](#deferred--extension-points)) for further document
types without a rewrite, but does not build speculative machinery now.

> **Statements are not Reports.** `/reports` produces an *analytical* daily summary — trends,
> category breakdowns, budget health, forecasts. A Statement makes **no interpretation**: it lists
> what happened, in order, with correct totals. This distinction is kept sharp in navigation, UI
> copy, API names and schema even though the routes nest under `/reports/statements`.

Everything ships dark behind `FINANCIAL_STATEMENTS_ENABLED` (`web/lib/financial-statements.ts`),
downstream of the existing `reports` experience surface.

## Status

| Phase | Scope | State |
|---|---|---|
| PR1 | Schema foundation + flag + this doc | **done** |
| PR2 | Pure engine: period presets, statement id, calculation, coverage | **done** |
| PR3 | Generation + immutable snapshot persistence + authorization + idempotency | **done** |
| PR4 | PDF + CSV rendering, private storage, signed-URL download, integrity hash | **done** |
| PR5 | Statements UI: landing, staged generate flow, preview, detail, download, regenerate, delete | **done** |
| PR6 | Audit (`space_audit_events`) + reconcile/render monitoring + in-app help + regression sweep | **done** |
| PR7 | Per-member `statement.generate` capability (migration `20261211000000`) | **done** |
| PR8 | Category + merchant filters | **done** |
| PR9 | Queued (async) generation for large statements — `status='generating'` stub + `run-statement-jobs` worker | **done** |
| PR10 | Financial Packs — ZIP bundle of statements (`statement_packs`, migration `20261212000000`) | **done** |
| PR11 | Scheduled statements (`statement_schedules`, migration `20261213000000`) + `run-statement-schedules` worker | **done** |
| PR12 | Public verification page `/verify/<token>` + PDF QR (migration `20261214000000`) | **done** |
| PR13 | Deterministic natural-language request parsing (`lib/statement-nl.ts`) | **done** |

## Where each piece lives

| Concern | Location |
|---|---|
| Schema, RLS, private bucket | `supabase/migrations/20261210000000_financial_statements.sql` |
| Runtime flag | `web/lib/financial-statements.ts` — `isFinancialStatementsEnabled()` |
| Period / timezone presets | `web/lib/statement-period.ts` *(PR2)* — built on `web/lib/report-period.ts` primitives (`localMidnightUtc`, `shiftDateKey`, `zonedDateKey`); never the Kigali fixed-offset shortcut |
| Public statement id | `web/lib/statement-id.ts` *(PR2)* — `OL-ST-YYYYMMDD-XXXXXX`, 6 Crockford-base32 chars |
| Deterministic calculation | `web/lib/statement-math.ts` *(PR2)* — opening/closing/credits/debits/fees/net/count/running balances/`reconciles`/per-currency; zero-import, `deno test` |
| Source & coverage disclosure | `web/lib/statement-coverage.ts` *(PR2)* |
| Generation + snapshot (service role, after explicit membership check) | `web/lib/statement-generation.ts` — plus `getStatementFormOptions()` for the new-statement form |
| Shared request/outcome contracts | `web/lib/statement-types.ts` — no `server-only`, safe to import from the client flow |
| Pure snapshot shaping | `web/lib/statement-snapshot.ts` — scope resolution, row/record builders |
| Server actions | `web/app/reports/statements/actions.ts` — `previewStatementAction`, `createStatementAction`, `regenerateStatementAction`, `deleteStatementAction` (each re-checks the flag) |
| Render model + CSV | `web/lib/statement-document.ts` — `StatementDocData`, `buildStatementCsv`, amount/date formatters (deno-tested) |
| PDF renderer | `web/lib/statement-pdf.tsx` — `@react-pdf/renderer`, new document family (not `report-pdf.tsx`) |
| Document download route | `web/app/api/reports/statements/[id]/document/route.ts?format=pdf\|csv` — cloned from `web/app/api/reports/[id]/pdf/route.ts` |
| Read helpers | `web/lib/queries.ts` — `getStatements`, `getStatementDetail` (session/RLS) |
| Statements UI | `web/app/reports/statements/{page,new/page,[id]/page}.tsx`; components `GenerateStatementFlow`, `StatementActions`, `StatementsTabs`, `StatementStatusBadge`; a "Reports / Statements" tab strip on `/reports` |
| Audit trail | `recordStatementAudit()` in `web/lib/statement-generation.ts` — service-role insert into `space_audit_events` (`resource_type = 'statement'`) for `statement.generated` / `.regenerated` / `.downloaded` / `.deleted` / `.access_denied`; non-fatal; metadata carries no balance / description / counterparty |
| Monitoring | `console.warn("[statement.monitor] reconcile_mismatch", …)` at generation when `reconciles === false`; `console.warn("[statement.monitor] render_failed", …)` in the document route's render try/catch |
| In-app help | "About statements" `<details>` on `/reports/statements` — what a statement is, that it is not an official provider statement, why transactions can be missing, Standard vs Detailed |

## Data model

Three additive tables + one private Storage bucket (`statement-artifacts`). Full column comments live
in the migration.

```
statements                      one generated (or generating) statement
  ├─ statement_transactions      frozen per-row snapshot (the document's line items)
  └─ statement_artifacts         rendered PDF/CSV metadata: storage_path, sha256 checksum, byte_size
```

- **`statements`** — params (`statement_type` standard|detailed, `scope` single_account|all_accounts|filtered,
  `account_ids uuid[]`, `filters jsonb`, `period_start/period_end/timezone`, `currency`), computed
  totals (`opening/closing_balance_minor` nullable = *unavailable, never zero*, `total_credit/debit/fees_minor`,
  `transaction_count`, `per_currency jsonb`), disclosure (`source_metadata`, `coverage_metadata`),
  `reconciles boolean` (null = uncheckable, false = checked-and-failed → flagged + logged),
  `status`, `supersedes_id`, `client_token`, `statement_id` (public id, format-checked).
- **`statement_transactions`** — a **copy** of every rendered field (both `display_description` and
  verbatim `original_description`, `reference`, `direction`, `principal_effect_minor`,
  `fee_effect_minor`, `running_balance_minor`, `category`, `sort_index`). `transaction_id` kept for
  traceability with `ON DELETE SET NULL`.
- **`statement_artifacts`** — mirrors `report_artifacts` exactly, incl. `unique (statement_id, format)`
  and **zero anon/authenticated grants**.

### Immutability / snapshot strategy

A generated statement must re-download **byte-identical** later even after the underlying ledger
changes (master prompt §17/§18). Chosen approach: a **junction table with frozen display fields**
(not a re-run query, not one JSON blob):

- reproducible after the source `transactions` row is edited, recategorised or erased;
- one bounded join to render the table;
- storage bounded by `transaction_count`;
- `transaction_id … ON DELETE SET NULL` keeps the frozen line through a Right-to-Erasure run.

`status = 'ready'` and the row are written in one transaction; `authenticated` has **no
INSERT/UPDATE** — the snapshot is un-forgeable and un-editable from the client. "Generate updated
version" creates a **new** row (`supersedes_id` → the old one); the old row is never touched.

## Security posture

Mirrors the Reporting engine (Phase J/K):

- **Snapshot writes** — `statement-generation.ts` runs `is_workspace_member` / active-workspace
  resolution explicitly, then writes via the **service-role** client. Explicit workspace scoping in
  trusted server code *is* the boundary (same as `report-generation.ts`).
- **Reads** — `authenticated` gets `SELECT` on `statements` / `statement_transactions` via
  `is_workspace_member(workspace_id)` RLS, and `DELETE` on `statements` (min role `member`).
- **Household per-source visibility** — applied at snapshot build time via `withSourceVisibility` /
  `visible_source_ids_for_user` (reused from `report-generation.ts`), so a member's statement only
  ever contains rows they may see.
- **Documents** — private `statement-artifacts` bucket, `public = false`, no `storage.objects`
  policy for anon/authenticated. The download route verifies ownership through the `statements` RLS
  first, then issues a **300 s signed URL**; the file is never a stable public URL. sha256 of the
  exact bytes is stored as the integrity fingerprint (§20).
- **Untrusted input** — every provider description / reference / counterparty / category is treated
  as untrusted and escaped per output format (PDF text nodes, CSV via `csv-safe.ts`).
- **No leakage** — no balances/descriptions/account numbers in URLs, logs, analytics or error
  messages; unauthorized/absent sources return a generic not-found (no existence oracle, §33).
- **Authorization** — the workspace membership + role model *is* the existing permission system
  (§54: don't invent a parallel RBAC). Generate / regenerate / delete require a non-`viewer` role
  (`resolveContext`); view / download require workspace membership (RLS `statements_select_member`);
  delete additionally requires the `member` minimum (RLS `statements_delete_member`). A per-member
  `statement.generate` capability in `spaces_capability_matrix` is a clean future refinement — the
  single enforcement point is `resolveContext` — but is **not** built, since the role gate already
  expresses the intent.
- **Audit** — `recordStatementAudit()` writes a `space_audit_events` row (owner/admin-readable) for
  every generate / regenerate / download / delete and for each denied attempt
  (`forbidden_role`, `unauthorized_source`, cross-workspace regenerate). Non-fatal; the metadata is
  ids + counts + period only.

## Financial correctness

- Totals come only from `statement-math.ts` (deterministic, unit-tested), never the render layer.
- Only `settlement_state = 'settled'`, `dedupe_state <> 'merged'` rows count — same filter as
  `report-generation.ts`.
- `balance_after_rwf` is provider-reported and frequently `NULL`; opening/closing/running balances
  are shown only when genuinely derivable, otherwise a dash — **never fabricated** (§14/§15).
- `opening + credits − debits − fees == closing` is asserted when all are known; a mismatch still
  generates the document but flags it and logs the discrepancy for monitoring (§43).
- Currency: RWF-first, zero-decimal. A mixed-currency consolidated statement reports **per
  currency** and never sums or auto-converts across currencies (§23).

## Coverage & honesty

A OneLedger statement may be built from SMS/notification capture, imports, or manual entry — not an
authoritative provider ledger. Documents therefore always carry:

- a **data-source** line ("MTN MoMo notifications captured by OneLedger", etc.);
- a **coverage** statement ("Complete for available OneLedger records") plus any detected-gap
  warnings (large `occurred_at` jumps, `balance_after_rwf` discontinuities);
- a footer disclaimer: *generated by OneLedger from records available to the account holder; not an
  official statement issued by the originating financial provider* (§16/§47).

Absence of visible gaps is never presented as proof of completeness.

## Extension points that were subsequently built (PR7–PR13)

- **`statement.generate` capability** (§25) — PR7. **Category + merchant filters** (§24) — PR8.
- **Async / queued generation** (§27) — PR9: a `status='generating'` stub + the
  `run-statement-jobs` worker. **Financial Packs** (§32) — PR10 (`statement_packs`, synchronous ZIP).
- **Scheduled statements** (§30) — PR11 (`statement_schedules` + `run-statement-schedules`; the
  generated statement lands in history — email/notification delivery still deferred).
- **Public verification + QR** (§20/§21) — PR12: `/verify/<token>`, an unguessable token per
  statement, a PDF QR, per-IP rate limiting, and RLS is *not* a token bypass. Revocation via
  `verification_revoked_at`.
- **Natural-language requests** (§31) — PR13: `lib/statement-nl.ts`, a *deterministic* parser
  feeding the structured form — no AI, no effect on calculations.

## Still deferred

- **Scheduled-statement email / notification delivery** — the schedule only "saves to OneLedger"
  today (§30).
- **Tag / participant filters** (§24) — need a `transaction_tags` schema (none exists) and the
  member directory in the flow UI; only direction / category / merchant shipped.
- **A public verification API endpoint** beyond the HTML page; **weekly/quarterly schedule
  cadences** (monthly only); **provider-original-document management** — ingestion of uploaded
  provider statements is a separate existing feature (`lib/statement-import.ts`).

## Deployment

- Migrations `20261210000000` … `20261214000000` apply via `deploy-supabase.yml` on a green `main`:
  `statements` / `statement_transactions` / `statement_artifacts` + private `statement-artifacts`
  bucket; the `statement.generate` capability; `statement_packs`; `statement_schedules`;
  `statements.verification_token` / `verification_revoked_at`.
- Set `FINANCIAL_STATEMENTS_ENABLED=true` per Vercel environment. Everything is inert while unset:
  the routes 404, `/verify` 404s, the tab is hidden, the workers no-op, nothing queries the tables.
  Optional: `STATEMENT_ASYNC_THRESHOLD` (default 8000).
- The three cron routes (`run-statement-jobs`, `run-statement-schedules`, and the existing
  `generate-reports` pattern) are **not scheduled** — they exist for a later, explicitly-approved
  rollout step and are authed by `REPORT_CRON_SECRET`. Async generation is unreachable until one is
  wired; synchronous generation needs none of them.
- Rollback = unset the flag. Generated statements, packs and schedules remain but are unreachable.

## Test coverage

- `deno test web/lib` — `statement_period` / `statement_id` / `statement_math` / `statement_coverage`
  / `statement_snapshot` / `statement_document` suites (period presets + validation + DST, id format
  + rejection sampling, all totals + `reconciles` + running-balance basis + per-currency, coverage
  gap/discontinuity heuristics, scope resolution + row/record builders, CSV columns + BOM + formula
  injection + RFC-4180).
- `supabase/migrations/tests/run_migration_tests.sh` — a member reads their workspace's statement +
  rows but never another tenant's; authenticated cannot INSERT/UPDATE `statements` or INSERT
  `statement_transactions`; `statement_artifacts` has zero authenticated access; a viewer reads but
  cannot delete; another tenant cannot delete; a member delete cascades; the `statement_id` CHECK,
  the `format` CHECK and `UNIQUE (workspace_id, client_token)` all bite.
- `e2e/statements.spec.ts` — seed 3 settled transactions → generate a "this month" statement end to
  end → preview count + counterparty, the Ready detail page, PDF/CSV links, the document route
  redirects (3xx), the history row, and a `statement.generated` audit row; plus a no-activity custom
  range that is refused rather than left blank.
