# OneLedger Spaces — production readiness

Phase W PR6. Security + performance + rollout review for the Spaces
program (Phases Q–W). Every row is a claim about what is built, plus
where it is enforced and tested.

## Rollout

| Gate | Default | Where |
| --- | --- | --- |
| `SPACES_ENABLED` | off (opt-in, `=== "true"`) | `web/lib/spaces/gate.ts` |
| `SPACES_WORKSPACE_ALLOWLIST` | empty (everyone, once `SPACES_ENABLED`) | `web/lib/spaces/gate.ts` |
| `NOTIFICATION_EMAIL_ENABLED` + `RESEND_API_KEY` | off | `supabase/functions/send-notifications/lib.ts` |

`SPACES_ENABLED` blocks the server actions (`createHousehold` no-ops;
`setSourceVisibility` / `allocateSourceToSpace` / `setShareLinkStatus`
return `{ ok: false }`), not just the buttons. Household-only surfaces
(`/settings/notifications`, per-member attribution) never render without a
household, which cannot be created while the flag is off. Statement
import, the `/notifications` inbox, and duplicate review are deliberately
**not** gated — they work for personal workspaces.

Sequence: internal (`SPACES_ENABLED=true`, `SPACES_WORKSPACE_ALLOWLIST` =
staff workspace ids) → beta (widen the allowlist) → GA (clear the
allowlist). Email delivery is a separate switch, flipped once a Resend
key and a schedule are in place.

## Security

| Concern | Enforcement | Test |
| --- | --- | --- |
| Membership never confers source visibility | `can_view_source_in_space()` gate on `accounts_*` / `transactions_*` RLS for `household` kind; per-source `visibility_mode` + `source_space_links` | `pfe_rls` Phase Q/S blocks (household member cannot read an unshared source's transactions; access dies on link pause / removal) |
| Cross-Space / guessed-id reads | RLS composes `is_workspace_member()` with `AND`; every RPC re-checks membership / capability | Phase R/S blocks (non-member RPC calls raise; forged `workspace_id` insert rejected) |
| Capability escalation | `space_role_has_capability()` IMMUTABLE matrix + additive `space_member_capability_grants`; `has_space_capability()` primitive; owner-affecting ops stay owner-only, last-owner guard | Phase R/S PR2d blocks |
| Stale / forwarded / revoked invite | `invite_preview()` + `accept_workspace_invite()` reject non-pending / expired / revoked; `accepted_by` recorded | Phase R block; `web/e2e` invite states |
| Access after removal | membership → `removed`, capability grants deleted, `getActiveWorkspaceId()` falls back to Personal, `member.removed` notifies the removed user | Phase R + Phase W PR2 blocks |
| Service-role-only surfaces | `revoke all from public` + `grant … to service_role` on `compute_transaction_fingerprint`, `resolve_ingestion_target`, `record_budget_threshold_crossing`, `pending_notification_emails`, `mark_notification_emails_delivered`, `visible_source_ids_for_user` | privilege-count assertions + per-fn `as_user` refusal checks |
| Internal helpers not authenticated-callable | `revoke all from public`, no `authenticated` grant on `record_space_activity`, `record_space_audit_event`, `enqueue_notification` | Phase R + Phase V PR1 blocks |
| `anon` lockdown | `revoke all … from anon` on every Spaces table | **Phase W PR6 block** (zero `anon` grants across all 12 Spaces tables) |
| Duplicate merge never destroys evidence | `merge_duplicate_transaction` sets `dedupe_state='merged'` + `merged_into_transaction_id`, never `DELETE`; audited | Phase U PR1 block |
| Statement import is owner-scoped | `import_statement_transactions` requires `owns_financial_source()`; per-line `payload_hash` idempotency | Phase U PR7 block (non-owner refused; re-import no-op) |
| Analytics / logs leak no PII | `sanitizeSpacesEventProps` drops id/name/amount keys and scrubs identifier-shaped values; `redactErrorText` scrubs ids/emails/urls/digit-runs | `analytics_test.ts`, `monitoring_test.ts` |
| Existing ledger untouched by the migrations | Phase Q backfill is additive; `accounts.financial_source_id` / `transactions.financial_source_id` stay nullable | **Phase W PR6 block** (a pre-Spaces transaction's `amount` / `fee` / `net_effect` byte-identical after the full Q→W chain); `pfe_k` backfill refuse-to-guess test |

## Performance

- Every fan-out / sweep is **idempotent and best-effort**:
  `record_budget_threshold_crossing` alerts once per upward crossing;
  `enqueue_notification` is gated per channel by `should_notify`;
  `sweep_budget_thresholds` and the raw-event / reconciliation calls in
  `ingest-momo` are wrapped so a failure never fails an ingest.
- Indexes added for the new access paths: `source_space_links(workspace_id)`
  / `(financial_source_id)`, `raw_financial_events(payload_hash)` unique +
  `(financial_source_id, received_at desc)`,
  `transactions(dedupe_fingerprint)` partial, `notifications` per-user
  unread + pending-email partials, `categorization_policies(scope_source_id)`
  partial.
- Report generation reuses the existing single-pass `report-math.ts` and
  adds one `visible_source_ids_for_user` call per household candidate;
  the `merged`-exclusion and visibility filters are plain `WHERE` clauses,
  no extra round trips.
- `send-notifications` batches ≤ 50 rows per run; a failed send retries
  next tick (a duplicate email, never a dropped one).

## Migration validation

`supabase/migrations/tests/run_migration_tests.sh` applies the full
chain to a disposable PostgreSQL 17 cluster on every CI run:

- **254 assertions, byte-identical schema reproducibility** across two
  independent applications.
- Privilege counters pinned: 72 tables / 116 `authenticated` table grants
  / 76 `authenticated` function grants (a stray grant fails the build).
- Phase W PR6 invariants: existing-ledger money fields unchanged; `anon`
  has zero access to any Spaces table.

## Known follow-ups (not blockers)

- Email delivery is dark until `RESEND_API_KEY` + `NOTIFICATION_EMAIL_ENABLED`
  are set and `send-notifications` is scheduled (Dashboard, or `pg_cron`
  once enabled).
- `member` scope for categorization policies is deferred (attribution is
  unknown at ingestion time).
- Two-user household attribution e2e; `/spaces/{id}/…` routes;
  "available across shared accounts" balance semantics.
- Design-doc §11 section letters run past `z`; cosmetic only.
