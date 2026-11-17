# Offline-first (mobile app)

Status: **foundation on the Expo app (`oneledger-mobile/`), not yet merged or
device-tested**. Scope is the vertical slice that carries the hardest guarantees:
manual income/expense entry, category edits/confirmations, the transaction
ledger, today's totals and the home balance, working with no connection and
syncing safely afterwards. Migrations: `20270102000000` (create + feed) and
`20270103000000` (category edits). The
other entities in the original brief are listed under *Not yet offline*.

## 1. Audit (what existed)

| Area | Finding |
|---|---|
| Mobile | Expo SDK 58 / RN 0.88, Expo Router, `supabase-js` under RLS. **Online-only**: no local DB, no queue, no cache beyond React state. Session in SecureStore (chunked). |
| Writes | Manual transactions: RPC `create_manual_transaction` (server-generated id, **not idempotent**; a retry creates a second row). |
| Reads | Direct PostgREST queries (`features/transactions/queries.ts`). |
| Server | Supabase Postgres; `transactions.updated_at` maintained by trigger; ingestion dedup is separate (`momo_message_id`, `dedupe_state`). |
| Web | Unchanged by this work. |

Reused: `create_manual_transaction`'s rules (copied verbatim into the sync RPC),
`pickPlausibleBalance`, `sumTodayTotals`, the existing money/time helpers,
`deviceStore` (SecureStore), the design system.

## 2. Architecture

```
Screens → queries.ts / add-transaction (domain functions)
        → offline/local-store.ts  (repository)  ─┐ one SQL transaction
        → offline/outbox.ts       (durable queue) ┘
        → offline/sync-engine.ts  (push, then pull; single-flight)
        → offline/transport.ts    (sync_* RPCs under the user's session)
        → Supabase (RLS + SECURITY DEFINER sync functions)
```

* **Storage:** `expo-sqlite` with **SQLCipher** (config plugin `useSQLCipher`).
  Key = 32 random bytes in Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`,
  never in backups; Android `allowBackup` is already `false`). If the binary has
  no SQLCipher (Expo Go, old build) the database **refuses to open** and the app
  stays online-only. It never falls back to plaintext.
* **Isolation:** one database file per user (`ol-<sha256(userId)>.db`) with its own
  key. Switching accounts closes the previous DB; there is no shared cache.
* **Schema versioning:** `PRAGMA user_version`, each step transactional and
  additive; a DB newer than the app is refused, a failed step leaves the old
  version intact (tests).
* **Serialization:** one lock around all DB access (expo-sqlite shares a
  connection, so concurrent queries would otherwise join an open transaction).
* **Money:** integer minor units end to end (`amount_rwf` etc. are integers;
  bounded at 1e12 server-side so JS numbers stay exact). No floats.

### Authority (brief §5)

| Category | Examples | Rule |
|---|---|---|
| A local | draft form state | immediate |
| B synchronizable | manual transactions (now); categories, budgets, goals (later) | saved locally + outbox, server validates |
| C server/provider | MoMo/bank balances, settlement, entitlements, **external payments** | never produced from local state |

Local balance semantics (`offline/balance.ts`): **confirmed** (provider
`balance_after` on the newest *synced* row) is shown separately from the
**pending effect** of unsynced local entries; the Home card labels the sum as an
estimate. Failed entries are excluded; each row counts once. No confirmed balance
→ no estimate (never a made-up zero).

Pay / USSD / scan-to-pay screens are untouched and remain online: a payment
intent is never recorded as settled by the device.

## 3. Sync protocol

* **Outbox** (`outbox` table): `op_id` (the idempotency key, fixed forever),
  `seq` (order), `depends_on`, `state` ∈ pending / in_flight / retry / rejected /
  stalled, attempts, `next_attempt_at`, a *code* (never a payload) for the last error.
  The local financial row and its outbox row are written in **one SQL transaction**.
* **Server idempotency** (`20270102000000_offline_sync_foundation.sql`):
  `sync_create_manual_transaction(op_id, id, …)` takes an advisory lock per
  op_id, returns the stored outcome on replay (`status: replayed`), applies the
  insert + ledger row atomically, uses the **device-chosen transaction id**
  (stable identity), refuses an op_id reused by another user/entity
  (`op_id_conflict`) and an id that already exists (`entity_exists`). Same
  owner-of-workspace check and validation as `create_manual_transaction`.
  `client_operations` is not readable by any app role.
* **Ordering:** oldest first; an op with `depends_on` waits until its dependency
  has been delivered. (No cross-entity dependency exists yet in the slice; the
  mechanism is tested for when wallets/transfers join.)
* **Retry:** full-jitter exponential backoff (2 s base, 15 min cap). Network
  failures don't count an attempt and stop the run (preserving order); 5xx retry
  up to 8 times then **stall**; auth expiry pauses without penalty; permanent
  refusals (validation/permission/`entity_exists`) are **held, not deleted**.
  Held ops are retried only by the user ("Retry held changes") and discarded only
  by explicit user action.
* **Crash safety:** `in_flight` ops found at start are re-queued; replay is safe
  because of idempotency (tested: lost response, force-quit mid-upload).
* **Incremental pull:** `sync_transactions_changes(after_updated_at, after_id, limit)`
  (security *invoker* → RLS), keyset on `(updated_at, id)`, ≤ 500 rows/page.
  The cursor advances **in the same transaction** as the rows it covers. Each run
  re-reads from `cursor − 2 min` to catch late-committing rows (upserts are
  idempotent). First complete download flips `complete=1`; **reads use the device
  copy only after that**, before it the app behaves as it did.
* **Triggers:** launch, foreground, connectivity change, after each local save,
  30 s while something waits, manual "Sync now". None is needed for correctness.
  Reachability is learned from the sync attempt, not trusted from the OS flag.

## 4. Conflict & deletion policy

| Entity | Policy |
|---|---|
| Manual transaction create | Identity = device UUID; replay-safe; a clash is *held*, never overwritten |
| Pull vs. unsynced local row | **Local wins until acknowledged**; the server copy is never allowed to overwrite a row the device still owes (tested) |
| Server-side change to a synced row (category, merge) | Server wins (the device holds no pending edit to it) |
| Merged duplicates (`dedupe_state = merged`) | Delivered by the feed and removed locally (evidence, not live rows) |
| Balances | Never synced by overwrite; derived (see above) |
| Category edit / confirm | **Field-level compare-and-set** (`sync_set_category`): the device sends the category it believed the server had (base). Server equals base → applied; equals the wanted value → applied no-op; anything else → **conflict**: nothing changes, both values are kept and the user picks *Keep mine* (re-sent with `force`) or *Use OneLedger's* (adopt server, drop the edit). Later edits to the same record wait behind a conflict. Applied via `apply_manual_category_correction` (member+, audit history). Compared on the field, not `updated_at`, which ingestion also moves. A "remember as rule" request is not queued (rules stay server-owned) and the user is told |
| Discarding a refused edit | Restores the category the device believed the server had; never deletes the record |
| Edits/deletes of other fields, budgets, goals | **Not yet offline** (see §7) |

No last-write-wins anywhere.

## 5. Failure scenarios (brief §17) → behaviour

| # | Scenario | Behaviour / evidence |
|---|---|---|
| 1,2 | disconnect during/after create | saved atomically locally first; test "offline create" |
| 3,4,6 | batch stops / force-quit / lost response | replay returns `replayed`; no 2nd row (sync-engine tests + SQL tests) |
| 5 | same op uploaded repeatedly | PG test: 3 deliveries → 1 row, 1 ledger row |
| 7 | auth expires | pause, no attempt penalty, "Sign in to sync", resumes |
| 12 | wrong device clock | an `occurred_at` > now+5 min is refused (`invalid_time`), held with an explanation, record kept |
| 13 | storage full | SQL transaction throws → nothing half-written (rollback test); save surfaces an error |
| 14 | migration fails | old version intact, app stays online-only (test) |
| 15 | key unavailable/unreadable | DB recreated and re-downloaded; **unsynced changes in the unreadable file are lost** (documented risk §7) |
| 16 | logout with pending | the user's DB and key are **kept**; changes sync on next sign-in of the same user |
| 17 | account switch | per-user DB; the other user's data is not opened |
| 18 | weeks offline | cursor still valid (keyset, not time-limited); pull catches up in pages |
| 19 | older client vs new backend | additive migration; old RPC untouched |
| 20 | server rejects | held with plain-language reason, record kept, user can retry/discard |
| 21 | cursor expiry | no expiry; "reset cursor" forces full re-download keeping unsynced work |
| 23 | local ≠ provider balance | shown separately; estimate labelled |
| 25 | reinstall before sync | pending changes are lost (device-only key) — limitation §7 |
| 24 | subscription expiry offline | entitlements are Category C; not cached as authoritative (no change made) |

## 6. Tests run

* `supabase/migrations/tests/run_migration_tests.sh` (PG 17): **953 passed, 0 failed**,
  including 8 new tests (idempotent replay ×3, device-id kept, accounting parity,
  cross-user op_id refusal, id-reuse refusal, non-member refusal, feed under RLS,
  cursor tail, ACLs) plus 4 for category edits (apply+replay, conflict, force,
  non-member). Baseline counts (140 tables/139 RLS, 139 authenticated
  functions) updated for the new objects.
* `oneledger-mobile`: `tsc --noEmit` clean, `expo lint` clean, `jest` **all suites
  pass** (66+ new tests over real SQLite, incl. category conflict flows and the v1→v2 local upgrade: transactions/rollback/serialization,
  migrations, outbox + engine with failure injection, pagination, partial pull,
  single-flight, balance/freshness, status, classification, offline reads).
* `expo export --platform web` builds (a web stub keeps `expo-sqlite` out).

## 7. Known limitations / not yet offline

* **Not yet offline:** editing other transaction fields or deleting (the mobile app
  has no such screens today), budgets, goals, wallets management, merchants/people, scheduled reports, offline insights
  (server-computed Inbox/Insights still need a connection and degrade to their
  existing error state), and *wallet-to-wallet transfers* (none exist as a
  distinct operation in the current model).
* **SMS / capture (decision):** Android capture (`oneledger-capture`) already
  has its own native durable queue with retry, and the server remains the single
  parser and de-duplicator (`momo_message_id`, dedupe states). By design (ADR 0010)
  message content never leaves native code. Parsing messages into the local
  ledger would duplicate the server parser, risk double records and break that
  boundary, so it was **deliberately not done**. Instead the Sync screen shows
  the native queue's counts (waiting / failed) and captured transactions appear
  locally once the server records them and the next pull runs. A message
  captured offline therefore does not change local totals until delivered.
  iOS offers no inbox access; Shortcuts remain the compliant path.
* **Hard deletes** on the server aren't in the feed (merges are). A periodic full
  reconcile is the follow-up; "reset cursor" exists.
* **Key loss / reinstall** loses unsynced entries (the key is deliberately
  device-only). Mitigation: sync runs on every save when online.
* **Cannot run in Expo Go.** Needs a development/preview build (new native
  module + SQLCipher). **No build was made or run on a device in this work.**
* Offline sign-in is not added: an existing stored session opens the app offline
  (supabase-js keeps it through a failed refresh); a signed-out user must be online.
  The app lock (biometrics) still gates the UI.
* No metrics pipeline was added; the Sync screen and per-op error *codes* give
  on-device diagnostics, and no payloads are logged.

## 8. Rollout & rollback

1. Merge → `Deploy Supabase` applies `20270102000000` (additive; old clients unaffected).
2. Build a dev/preview binary (`eas build`); verify on a real device (see §9).
3. Ship. Kill switch: build with `EXPO_PUBLIC_OFFLINE_DISABLED=true` → exactly the
   previous online-only behaviour. Server rollback: the new function/table can
   stay (nothing else depends on them).

## 9. Manual verification (device)

Sign in online → open Transactions (first download) → airplane mode → force-quit
→ reopen: list present → Add a transaction ("Saved on this phone", header chip
"Offline · 1 saved") → Home totals/balance caption update → reconnect: chip clears,
row loses its badge → on a second device (or web) the row appears once.
