# S6c — Web: People and merchants (2026-11-17)

**Delivered (dark unless `COUNTERPARTIES_ENABLED=true`, optional `COUNTERPARTIES_WORKSPACE_ALLOWLIST`; no migration):**
- `/people`: search, type filter (All / People / Merchants / Not sure yet), per person what you sent/received per currency, transaction count, the "matched by name only" caveat, 50 per page, and a **Sort them now** banner while transactions are unsorted (idempotent `backfill_counterparties`).
- `/people/[id]`: totals per currency (sent / received / net), first and latest dates, what was **combined into** them, their transactions (50 per page, each opens the transaction), and three actions: **rename / change type**, **combine another into this one** (search, pick, confirm), **separate some transactions** (tick, name the new person). Combine and separate show an **Undo** straight away. A person that was combined away redirects to the survivor.
- A "People and merchants" entry in More > Manage money, **absent** (not disabled) when the flag is off. Flag off elsewhere = a 404 page, same as Wallets and Insights.

**One loader, two surfaces.** `lib/counterparties/directory-data.ts` (`loadCounterpartyList`, `loadCounterpartyDetail`) is used by both `/api/mobile/counterparties[/id]` and the web pages, so the app and the web can't disagree about who someone is. Response bodies of the mobile routes are unchanged, with one superset edge: a person with no summary rows now carries `txn_count: 0, first_at: null, last_at: null`.

**Same words as the app.** `lib/counterparties/directory.ts` mirrors `oneledger-mobile/src/features/people/display.ts` (kind labels, confidence copy, flow text, one safe sentence per database refusal).

## Rules it keeps
- Every change is a database function under RLS: member-or-above, validated, audited, and for merge/split an undo handle. Nothing edits a raw transaction; original labels never change.
- Server actions re-check the signed-in user, the flag + allowlist and a non-viewer role. Viewers see the pages but no edit controls.
- Search text has ILIKE wildcards stripped and is capped at 80 characters (same rule as the API); URL params are parsed leniently, never trusted.
- Amounts are minor units of the row's currency; an unsupported currency is shown as `CODE 1234`, never rescaled.
- No step-up (MFA) prompt, matching the mobile app, which calls the same functions directly. These are labelling changes, reversible and audited; say so if you want them gated like payment requests.

## Not built / known gaps
- Undo is offered right after a change **on that page only** (same as the app). The database keeps the event; there is no history screen.
- Splitting by phone number (identifier) isn't in the UI, only by transaction; the database supports both.
- A person's transaction list is paged (50), and "Separate" only offers the page on screen.
- The list is all-time (no period filter), same as the API.
- Insights rows don't link to a person yet.

**Verified:** `tsc`, `eslint`, `deno test web/lib`. **Not verified:** nothing was rendered locally (no Docker/Supabase here); the e2e (`e2e/people.spec.ts`: sort, search, filter, rename, combine, undo, redirect, 404, More entry, axe) is covered by the CI job only.
