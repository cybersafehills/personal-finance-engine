# Bills & Expenses — deployment, verification & failure-recovery runbook

Companion to `docs/bills-and-expenses-design.md`. Covers turning the
module on in a controlled way, verifying it end to end, and recovering
from the failure modes.

The module is **dark by default**: with `BILLS_ENABLED` unset, `/bills`
is `notFound()`, every action throws `FeatureDisabledError`, and no
background job does anything.

---

## 1. Release order (master prompt §24)

1. **Migrations bake.** `20261110000000` … `20261116000000` apply
   additively on top of Phase U. No data migration. Confirm with the
   pg17 harness (`supabase/migrations/tests/run_migration_tests.sh`) —
   the full chain + the seven "Bills Phase 1–7" blocks must be green
   (276 assertions total as of Phase 7).
2. **Backend + web deploy.** `web/lib/bills/**`, the actions, the API
   routes, the two cron routes. All inert while the flags are unset.
3. **Storage.** The migration creates the private `bill-documents` /
   `bill-derivatives` buckets. Confirm `public = false` on both.
4. **Provider config** (only for extraction): `AI_PROVIDER` +
   `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, or `AI_PROVIDER=mock` for a
   keyless dev run).
5. **Internal enable.** Set in production:
   - `BILLS_ENABLED=true`
   - `BILLS_WORKSPACE_ALLOWLIST=<one internal workspace id>`
   Leave `BILLS_EXTRACTION_ENABLED`, `BILLS_NOTIFICATIONS_ENABLED`, and
   `BILLS_AUTO_APPROVAL_ENABLED` unset for a first pass (upload +
   preservation + lifecycle + audit only).
6. **Extraction enable.** Add `BILLS_EXTRACTION_ENABLED=true`, then run
   the manual scheduler activation (§3).
7. **Notifications.** Add `BILLS_NOTIFICATIONS_ENABLED=true` once
   `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are verified.
8. **Beta → GA.** Widen / clear `BILLS_WORKSPACE_ALLOWLIST`. Consider
   adding `bills` to `MOVABLE_NAV_KEYS` at GA (it is a Settings link
   until then).

`BILLS_AUTO_APPROVAL_ENABLED` is **dark for the entire first release** —
`isBillsAutoApprovalEnabled()` returns `false` unconditionally and no
code path honours `bill_processing_policies.auto_approval_enabled`.

---

## 2. Configuration reference

| Var | Effect | Default |
|---|---|---|
| `BILLS_ENABLED` | The whole surface | off unless `"true"` |
| `BILLS_WORKSPACE_ALLOWLIST` | Comma-separated workspace ids; empty = all | empty |
| `BILLS_EXTRACTION_ENABLED` | The Phase 2+ worker (classify/extract/validate/candidates) | off unless `"true"` |
| `BILLS_NOTIFICATIONS_ENABLED` | "ready for review" emails (link only) | off unless `"true"` |
| `BILLS_AUTO_APPROVAL_ENABLED` | **dark** | never honoured |
| `BILLS_MAX_UPLOAD_BYTES` / `BILLS_MAX_PAGE_COUNT` / `BILLS_SIGNED_URL_TTL_SECONDS` | intake limits / signed-URL TTL | 15 MiB / 25 / 300 s |
| `BILL_WORKER_BATCH_SIZE` | documents per cron tick | 5 |
| `AI_PROVIDER` | `anthropic` (default) / `openai` (images only) / `mock` | anthropic |
| `REPORT_CRON_SECRET` | shared secret for **all** `app/api/cron/*`, incl. the Bills workers | — |

---

## 3. Activating the workers (manual, one-time)

The Bills workers are **not** auto-scheduled. Run
`supabase/scheduling/activate_bill_workers.sql` by hand once, after:

- `REPORT_CRON_SECRET` is set in Vercel production **and** stored in this
  project's Vault as `report_cron_secret` (already done if the reporting
  scheduler is live).
- `BILLS_ENABLED=true` (+ `BILLS_EXTRACTION_ENABLED=true` for extraction).

It creates two 5-minute `pg_cron` jobs → `bill-processing-tick` and
`bill-monitoring-tick`. To pause: `select cron.unschedule('bill-processing-tick');`.

---

## 4. End-to-end verification (in the allowlisted workspace)

1. **Upload.** `/bills` → add a PDF. It appears as `stored` (extraction
   off) or `queued` (extraction on). Re-upload the same bytes → surfaced
   as a duplicate, still one row.
2. **Original preservation.** Open the document → "Open the original in a
   new tab" returns a working signed URL that expires after
   `BILLS_SIGNED_URL_TTL_SECONDS`. Confirm `bill_document_artifacts` has
   exactly one `kind='original'` row and it cannot be updated/deleted.
3. **Worker tick** (extraction on): `POST /api/cron/process-bill-documents`
   with `x-report-cron-secret`. The document reaches `needs_review` with
   `doc_class`, extracted fields, a "Checks" result, supplier candidates,
   duplicate candidates, and transaction-match candidates.
4. **Review.** Edit a field → "(corrected)" marker, the raw value kept on
   hover, checks re-run. Approve → refused with a clear reason if there's
   a blocking finding / unresolved probable duplicate / (multi-member
   workspace) self-approval / stale validation; otherwise the `bills` row
   is created and status → `approved`.
5. **Post.** Select a matching transaction → `matched` + a
   `bill_transaction_links` row; or "Post as unpaid bill" → `posted`.
   Re-run `post_bill` with the same selection → no-op (idempotent).
6. **Audit.** With `bill.audit.view`, the Processing history shows every
   step; `space_audit_events` has `bill.uploaded` / `bill.approved` /
   `bill.posted` rows.
7. **Isolation.** A member of another workspace sees none of the above at
   the DB or the API layer.
8. **Monitoring.** `POST /api/cron/bill-monitoring` → a
   `[bill-metrics] {…}` log line; a `[bill-metrics] … processing_failed`
   error line when any document is stuck failed.

---

## 5. Failure recovery

| Symptom | Cause | Action |
|---|---|---|
| Document stuck at `queued` / `validating` | worker not scheduled, or a tick died mid-run | The next tick re-claims `queued` and re-validates `validating` automatically. If nothing runs, activate the scheduler (§3) or `POST` the route manually. |
| Document at `processing_failed` | provider unavailable / unsupported input / corrupt / OpenAI+PDF | The reviewer clicks **Retry processing** (`retry_bill_extraction`, `bill.review`) → back to `queued`. The original is never lost. For OpenAI+PDF, switch `AI_PROVIDER=anthropic` first. |
| Storage object with no `bill_document_artifacts` row (orphan) | upload put the object but the RPC failed | The upload action deletes its own object on RPC failure; a periodic sweep of `bill-documents` for keys with no row is a Phase 8 follow-up (`get_bill_document_fingerprints`-style). |
| `approve_bill` returns `stale_validation` | a field was corrected after the last check | Re-run the checks (the correction action does this automatically; the "checks out of date" prompt has a button). |
| Posting failed after `approved` | transient error mid-`post_bill` | `post_bill` is idempotent on its key and the document is left at `approved` (or `posting`); re-invoke with the **same** transaction selection — no duplicate `bills` row or link. |
| Emails not arriving | `BILLS_NOTIFICATIONS_ENABLED` unset, or `RESEND_*` missing | Notifications are best-effort and non-load-bearing; the review still works via the in-app queue. Set the flag + verify the Resend domain. |

---

## 6. Rollback

- **Pause without data loss:** unset `BILLS_ENABLED` (or narrow
  `BILLS_WORKSPACE_ALLOWLIST`), and `cron.unschedule` both Bills jobs.
  All rows stay; `/bills` becomes `notFound()`.
- **Full rollback:** the migrations are additive with no data migration,
  so a point-in-time restore to before `20261110000000` is clean. There
  is no destructive down-migration (this repo does not write them).

---

## 7. Known limitations (carried into GA planning)

- **Malware scanning** — no infrastructure; `security_scan_status`
  defaults to `skipped` and is a documented integration point.
- **Background processing** — pg_cron cadence (5 min), not a queue.
- **Upload rate limiting** — relies on the per-workspace checksum-unique
  guard; a true per-user upload rate limit is a follow-up.
- **Document rendering** — native `<object>`/`<img>`; a client-side
  pdf.js viewer with source-region (bbox) highlighting is a follow-up.
- **Notification preferences** — recipients are owner/admin + explicit
  `bill.review` grantees; per-member opt-out via
  `space_member_notification_prefs` is a follow-up.
- **Allocations** — `bill_transaction_links.allocation_minor` exists;
  the split-allocation UI and currency/fee-diff reconciliation are
  follow-ups.
