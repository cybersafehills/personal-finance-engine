# E4 — Counterparty split (2026-11-16)

**Delivered:** migration `20261228000000_counterparty_split.sql` — `split_counterparty`, `undo_counterparty_split`, `counterparty_split_events`, internal `_counterparty_txn_key` — and 19 harness assertions (counters: tables 137, authenticated table grants 176, authenticated function EXECUTE 132).

**Verified:** full `run_migration_tests.sh` on disposable PostgreSQL 17 — **667 passed, 0 failed** (including the two-fresh-application reproducibility check and erasure with split events present). **Not verified:** CI, a Supabase branch apply, volume (5,000-transaction cap per call is untested at size), any UI (there is no counterparty UI in web or mobile yet — only the mobile API from #211; the RPCs are listed in `docs/mobile-api.md`).

## Behaviour
`split_counterparty(counterparty, identifier_ids[], transaction_ids[], new_name?)` (member+, audited) moves chosen **identifiers** (and every transaction carrying them) and/or chosen **transactions** to a new counterparty:
- by identifier: separates two numbers that were grouped together; kind/confidence follow the strongest moved identifier (phone → person/high, merchant code → merchant/high, label → unknown/low); name = latest raw label of what moved;
- by transaction: the only way to separate **two people who share one name label** (no identifier tells them apart). The result has no identifiers; naming it makes it `user_confirmed`. Caveat: later transactions with that same label still resolve to the *original* (the label identifier stays there).
- After a split, new transactions with a moved identifier resolve to the split-off counterparty on the next `backfill_counterparties`.
- Raw labels/references on transactions are never changed.
- Refused: empty request; identifiers/transactions not belonging to the source; moving everything (`split_would_empty` — rename instead); merged source; name > 120; non-members (same error as not found).

**Undo** (`undo_counterparty_split`): returns **everything currently on the split-off counterparty — including items that joined after the split** — to the source, then *retires* the empty row (soft-merged into the source; not deleted, so history stays). Refused if already undone, or if the split-off counterparty has since been merged away or has merged children (`split_state_changed` — undo that merge first).

## Limits / open
- A weak (label-only) counterparty can't be split *by identifier* (it only has one label) — use the by-transaction form.
- Retired split-off rows accumulate as merged rows (harmless; invisible in summaries).
- No bulk "split by selection" UX exists yet; the app must pass the ids.
