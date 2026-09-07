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
| PR14 | Public verification **API** endpoint `/api/verify/<token>` (JSON; shared rate limiter) | **done** |
| PR15 | Weekly / quarterly schedule cadences (migration `20261215000000`) | **done** |
| PR16 | Scheduled-statement email delivery — link-only, no figures (migration `20261216000000`) | **done** |
| PR17 | Participant (household member) + tag filters | **done** |
| PR18 | `transaction_tags` schema (migration `20261217000000`) + tagging UI on `/transactions/[id]` | **done** |
| PR19 | Provider-original-document management — `provider_statements` + private bucket (migration `20261218000000`), upload / list / download / delete on `/reports/statements` | **done** |

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
| Transaction tags | `web/lib/transaction-tags.ts` *(PR18)* — `normalizeTag` / `add` / `remove` / `getWorkspaceTags`; `TransactionTags` client component on `/transactions/[id]`; backs `filters.tag` |
| Provider-original documents | `web/lib/provider-statements.ts` *(PR19)* — upload / list / delete (service-role after membership check); `ProviderStatements` component + "Provider statements" `<details>` on `/reports/statements`; download via `web/app/api/reports/statements/provider/[id]/route.ts` |

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
  warnings: large `occurred_at` jumps, and `balance_after_rwf` discontinuities checked **per
  account** (grouped by `financial_sources` id — a consolidated statement interleaves several
  running-balance series, so a cross-account comparison is never made) and reported as **one
  summarised note** with a count, not one line per occurrence;
- a footer disclaimer: *generated by OneLedger from records available to the account holder; not an
  official statement issued by the originating financial provider* (§16/§47).

Absence of visible gaps is never presented as proof of completeness.

## Extension points that were subsequently built (PR7–PR19)

- **`statement.generate` capability** (§25) — PR7. **Category + merchant filters** (§24) — PR8.
- **Async / queued generation** (§27) — PR9: a `status='generating'` stub + the
  `run-statement-jobs` worker. **Financial Packs** (§32) — PR10 (`statement_packs`, synchronous ZIP).
- **Scheduled statements** (§30) — PR11 (`statement_schedules` + `run-statement-schedules`; the
  generated statement lands in history). **Weekly / quarterly cadences** — PR15
  (`statement_schedules.cadence` / `day_of_week`, migration `20261215000000`;
  `nextScheduledRunUtc` / `scheduledStatementRange` in `statement-period.ts`).
- **Scheduled-statement email delivery** — PR16 (migration `20261216000000`:
  `statement_schedules.delivery_email`, `statements.notify_email` / `notified_at`). The jobs worker,
  after a statement flips to `ready`, sends **one link-only email** via
  `sendScheduledStatementEmail` (`lib/emails.ts`) — no balances, descriptions or account
  identifiers, ever — and stamps `notified_at`. Non-fatal on failure.
- **Public verification + QR** (§20/§21) — PR12: `/verify/<token>`, an unguessable token per
  statement, a PDF QR, per-IP rate limiting, and RLS is *not* a token bypass. Revocation via
  `verification_revoked_at`. **Verification API** — PR14: `/api/verify/<token>` returns the same
  identity + integrity JSON the page shows, flag-gated, `no-store`, sharing `verifyRateLimited`.
- **Natural-language requests** (§31) — PR13: `lib/statement-nl.ts`, a *deterministic* parser
  feeding the structured form — no AI, no effect on calculations.
- **Participant + tag filters** (§24) — PR17 / PR18. `filters.participantUserId` scopes to one
  household member's `transactions.attributed_user_id` (household spaces only, via
  `getSpaceMemberDirectory`); `filters.tag` scopes to a `transaction_tags.tag` (inner join). Both
  force `scope='filtered'` and render in the "Applied filters" banner
  (`"One member's transactions"` / `"Tag: <tag>"`) — the participant filter never names the member
  in the document. **`transaction_tags`** (migration `20261217000000`) is a member-managed label
  row (`lib/transaction-tags.ts`, `TransactionTags` on `/transactions/[id]`), **not** snapshot
  data — re-tagging never mutates an already-generated statement.

- **Provider-original documents** (§16) — PR19: `provider_statements` + a private
  `provider-statements` bucket (migration `20261218000000`). A member uploads the verbatim PDF/CSV a
  bank or wallet issued and it is listed on `/reports/statements` next to the generated ones. It is
  **never parsed** here (ledger ingestion of uploaded statements is a separate feature,
  `lib/statement-import.ts`) and **never modified** — an evidence record with its own sha256.
  authenticated has SELECT only; `lib/provider-statements.ts` does upload + delete with the
  service-role client after `getActiveWorkspace()` confirms an active, non-viewer member, so the row
  and the stored object never drift. Download is a signed URL from
  `app/api/reports/statements/provider/[id]`.

## Still deferred

- **In-app notification (bell) on scheduled-statement completion** — only the optional email and the
  history row exist today.
- **OCR / field extraction from an uploaded provider document** — deliberately out of scope;
  `provider_statements` is storage + metadata only.

## Deployment

- Migrations `20261210000000` … `20261218000000` apply via `deploy-supabase.yml` on a green `main`:
  `statements` / `statement_transactions` / `statement_artifacts` + private `statement-artifacts`
  bucket; the `statement.generate` capability; `statement_packs`; `statement_schedules` (+ `cadence`
  / `day_of_week` / `delivery_email`); `statements.verification_token` / `verification_revoked_at` /
  `notify_email` / `notified_at`; `transaction_tags`; `provider_statements` + private
  `provider-statements` bucket.
- Set `FINANCIAL_STATEMENTS_ENABLED=true` per Vercel environment. Everything is inert while unset:
  the routes 404, `/verify` 404s, the tab is hidden, the workers no-op, nothing queries the tables.
  Optional: `STATEMENT_ASYNC_THRESHOLD` (default 8000).
- The two cron routes (`run-statement-jobs`, `run-statement-schedules`) are authed by
  `REPORT_CRON_SECRET` and are wired for pg_cron via
  `supabase/scheduling/activate_statement_workers.sql` — a manually-applied file (like
  `activate_report_scheduler.sql`; kept out of `supabase/migrations/` because pg_cron/pg_net can't
  run in the CI Postgres). It schedules `statement-schedules-tick` (`*/15`) and `statement-jobs-tick`
  (`*/5`). **Until that file is run by hand in the Supabase SQL editor, neither tick fires** — so
  scheduled statements don't auto-generate and a queued (async-threshold) statement stays
  `generating`. Synchronous generation needs none of this. Both ticks also hard-check
  `FINANCIAL_STATEMENTS_ENABLED`, so activating the cron before the flag is flipped is harmless.
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
  the `format` CHECK and `UNIQUE (workspace_id, client_token)` all bite; a member tags their own
  transaction but not another tenant's and the tag length CHECK bites; a member sees their
  workspace's `provider_statements` upload but not another tenant's, authenticated has no INSERT
  (upload is service-role), and the `file_sha256` CHECK rejects a malformed hash.
- `e2e/statements.spec.ts` — seed 3 settled transactions → generate a "this month" statement end to
  end → preview count + counterparty, the Ready detail page, PDF/CSV links, the document route
  redirects (3xx), the history row, and a `statement.generated` audit row; plus a no-activity custom
  range that is refused rather than left blank.
