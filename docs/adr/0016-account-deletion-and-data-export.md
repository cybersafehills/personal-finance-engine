# ADR 0016: Account deletion and data export

- **Status:** Accepted, fully implemented.
  - Request + export: `20261201000000`, behind `ACCOUNT_DELETION_ENABLED`.
  - Irreversible erasure: `20261203000000` (`execute_account_deletion` +
    `pending_account_deletions` + `account_deletion_log` + the
    `process-account-deletions` cron), behind the **separate**
    `ACCOUNT_DELETION_EXECUTE_ENABLED`.
- **Date:** 2026-09-06
- **Closes:** audit **F12**, master prompt §94–§95.
- **Guardrail:** account deletion and data export are **never** behind a
  plan (assessment §7). Free forever.

## Decision

### 1. Data export — self-serve, now

`/settings/privacy/data` → "Download my data": a JSON bundle
(`assembleAccountDataExport`) of the signed-in user's profile,
memberships, owned `financial_sources`, `accounts`, `transactions` (capped
at 10 000, truncation flagged in the bundle), `categorization_policies`,
`budgets`, `financial_goals`. Assembled through the ordinary RLS-scoped
session client, so it can only ever return rows the caller could already
read. No new table, no new grant.

Bulk / scheduled / formatted exports remain `/integrations/exports`.

### 2. Deletion — a 30-day scheduled request

`request_account_deletion(reason?)` writes one
`account_deletion_requests` row, `status='scheduled'`,
`scheduled_for = now() + 30 days`. `cancel_account_deletion()` withdraws
it any time before then. Both are `SECURITY DEFINER`, `auth.uid()`-scoped,
`authenticated`-callable; the row is SELECT-own via RLS, no client write.

**Blocked** while the caller is the **sole owner of a shared Space
(`kind <> 'personal'`) that still has other active members** — erasing the
account would orphan a ledger other people depend on. They must transfer
ownership or remove those members first. A solo household/organization,
and the personal Space, are fine.

### 3. Irreversible erasure — the follow-up (`execute_account_deletion`)

**Implemented in `20261203000000`.** `execute_account_deletion(p_user_id)`
is a `SECURITY DEFINER`, service-role-only function; the
`process-account-deletions` cron calls `pending_account_deletions()` for
the due ids and runs it per user, isolating per-user failures.

**Schema prep:** five tenant-scoped tables (`accounts`,
`categorization_policies`, `transactions`, `transaction_category_history`,
`learned_policy_suggestion_decisions`) were left `ON DELETE NO ACTION` on
their `workspace_id` FK by older migrations and are converted to
`CASCADE`, matching every other workspace-scoped table — so the
Personal-Space delete is one statement once the RESTRICT chain is
cleared.

The function, in order:

0. Re-checks both request guards (sole owner of a populated shared Space →
   `P0001`; an owned source still shared into a populated Space → `P0004`,
   a check also added to `request_account_deletion`).
1. For each **solo workspace** (the only active member is this user):
   dismantles the RESTRICT-guarded chain bottom-up — raw events →
   transaction-graph NO-ACTION rows → transactions → `momo_messages` →
   device credentials / pairing sessions → ingestion connections →
   connector installations — then `delete from workspaces` cascades the
   ~46 CASCADE children.
2. Deletes the user's own `financial_sources` / `pairing_sessions` /
   `connector_installations` (now unblocked).
3. Neutralises every remaining single-column NO ACTION / RESTRICT
   `auth.users` FK, discovered from `pg_constraint`: nullable columns are
   nulled (the shared-ledger row stays, the actor becomes "a former
   member"); a NOT NULL column means the row is meaningless without its
   user, so the row is deleted.
4. Writes `account_deletion_log` (no FK to `auth.users`, so it survives).
5. `delete from auth.users` — cascades profiles, memberships, and the ~20
   other CASCADE user FKs.

Historical spec (kept for context) — the function must, in order:

1. For each workspace the caller **solely owns with no other active
   member** (their personal Space + any solo household/org):
   - delete `connector_installations` where `home_workspace_id` = ws
     (**`on delete restrict`**), which cascades `device_credentials`,
     pairing rows, adapter health;
   - delete the `workspaces` row — **`on delete cascade`** then removes
     accounts, transactions, budgets, goals, reports, `ui_preferences`,
     payment intents, notifications, integrations, categories, and the
     rest of the tenant schema.
2. Null or delete every **plain `NO ACTION`** `auth.users` FK that would
   otherwise block `delete from auth.users` (inventory below).
3. `delete from auth.users where id = <uid>` — cascades `profiles`,
   `workspace_memberships`, `financial_sources`
   (→ `source_space_links`, `raw_financial_events`), and the other
   `on delete cascade` user FKs.
4. Flip the request row to `status='completed'`, `completed_at=now()`
   (the row survives on `on delete cascade`? no — it's
   `user_id → auth.users on delete cascade`, so write `completed` in a
   separate audit table, or flip it *before* step 3).

#### `auth.users` FK inventory (must be handled before step 3)

**`on delete cascade` (safe, handled automatically):** `profiles.id`,
`workspace_memberships.user_id`, `financial_sources.owner_user_id`,
`*_reporter_user_id`, `*_suggester_user_id`, `account_deletion_requests.user_id`.

**`on delete set null` (safe, auto-nulled):** `*_actor_user_id`,
`*_created_by` (most), `*_author_id`, `*_changed_by`, `*_confirmed_by`,
`*_corrected_by`, `*_granted_by` (some), `*_approved_by`, `*_resolved_by`
(some), `*_manually_confirmed_by`, `*_posted_by`, `*_uploaded_by`,
`*_verified_by`, `webhook_deliveries.consumed_installation_id`.

**plain `NO ACTION` (BLOCKS the delete — must be nulled/deleted first):**
`workspaces.created_by`, `workspace_invites.invited_by` /
`.accepted_by`, `transaction_member_attributions.attributed_user_id`,
`*_performed_by_user_id`, `*_record_created_by_user_id`, `*_decided_by`,
`*_added_by`, `*_linked_by`, `*_granted_by` (the non-null-action ones),
`*_resolved_by` (the non-null-action ones), `*_reviewed_by`,
`space_member_directory` seeds, plus any added after 2026-09-06 — the
follow-up must re-run the grep in this ADR's commit message against the
current schema, not trust this list.

Because most of these are in **shared** workspaces the user only
*participated* in (not owns), the follow-up nulls them (preserving the
shared ledger's integrity — the row stays, the actor becomes "a former
member") rather than deleting the rows.

### 4. Not doing

- No "download link emailed later" flow — the export is synchronous.
- No partial/tombstone retention for legal hold — out of scope; revisit
  only if a real compliance requirement appears.
- No admin-initiated deletion.

## Consequences

- `account_deletion_requests` adds one table (+1 `authenticated` SELECT
  grant, +2 `authenticated` functions): migration-suite guards move
  118→119 / 149→150 / 110→112.
- The request flow is usable immediately once `ACCOUNT_DELETION_ENABLED`
  is set; nothing is actually erased until the follow-up ships and its own
  cron is enabled — same "dark until a human flips it" posture as the
  connector cutover.
