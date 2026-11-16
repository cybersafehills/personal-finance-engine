# E6b — Mobile: People and merchants (2026-11-16)

**Delivered (Expo app, More → People and merchants):**
- **People list** (`/people`): search (debounced), filters (All / People / Merchants / Not sure yet), per person what you sent/received per currency and transaction count, an honest "matched by name only" note, and — when transactions haven't been sorted yet — a banner with **"Sort them now"** (calls the idempotent `backfill_counterparties`). Shows the first 100 with a "search to find others" note.
- **Person** (`/person/[id]`): totals (sent / received / net per currency), first and latest dates, what was **combined into** them, their transactions (each opens the transaction), and four actions — all via the database functions under RLS, all audited:
  - **Rename or change type** (person / merchant / not sure) → marks it "You confirmed this"; original transaction labels never change.
  - **Combine with another** (search, pick; the person you're on is kept) → **Undo** appears right away.
  - **Separate some transactions** (tick them, name the new person) — the only way to split two people who share a name → **Undo** appears right away.
  - A person that was combined into another redirects to the survivor.
- Insights' "People and merchants" rows now open the person (when the group is id-based).
- **Web fix found while building this (E2 bug):** Insights grouped people by the *raw* counterparty id, so a merge did not combine them there. Insights now resolves merged people to their survivor (and its name) — `lib/counterparties/effective.ts` (+4 tests), used by `lib/insights/insights-data.ts`.

**Verified:** mobile `typecheck`, `expo lint`, `jest` (**176 pass**, 11 new), `expo export --platform web`; web `deno test` (**893 pass**), `tsc`.
**NOT verified:** like E6a, **no screen was run** (no device/emulator/browser session against a flag-enabled web API). Untested: layout and touch targets, text scaling/dark mode/screen-reader order of the new screens, the real RPC round trips (merge / split / undo are covered by the migration tests, not through the app), and the Insights merge fix against a real database (unit-tested only).

**Known gaps / decisions**
- Undo is offered right after a change **on that screen only**; leaving the screen drops the handle (the database still keeps the event, but there is no "history" screen to undo from later).
- Splitting by phone number (identifier) isn't in the app — only by transaction. The database supports both.
- The list isn't paged beyond 100 and has no pull-to-refresh (re-loads on focus).
- A person's detail shows the latest 50 transactions.
- Counterparty list is all-time (no period filter) — same as the API.
