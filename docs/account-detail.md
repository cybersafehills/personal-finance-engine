# Account detail — the account as a first-class object

- **Status:** implemented (branch `feat/account-detail-tabs`).
- **Master prompt:** §16, §24. Closes gap **G3** of
  `docs/oneledger-onboarding-architecture-audit.md`.
- **Route:** `/settings/accounts/[id]` — reached by clicking an account name on
  `/settings/accounts`.

## Sections

One server-rendered page with `?tab=` sections (plain links, deep-linkable,
no client JS for the nav):

| Tab | Shows | Manage via |
| --- | --- | --- |
| **Overview** (default) | provider, currency, status, masked identifier, added date, and count tiles (connections / account rules / Spaces shared with) | — |
| **Transactions** | the 20 most recent transactions on this account (`getAccountTransactions`, reuses `TransactionList`) | link to `/transactions` |
| **Connections** | the `ingestion_connections` bound to this account — label, status, key prefix, last received | link to `/integrations/connections` |
| **Rules** | categorization policies scoped to this account (`scope_type='source'`, `scope_source_id` = the account's `financial_source_id`); notes that Space-wide rules also apply | link to `/categories/rules` |
| **Access** | which Spaces the account's source is shared into and at what visibility (`source_space_links`). Hidden unless `SPACES_ENABLED`. | link to `/settings/sources` |
| **Settings** | rename / set primary / archive — `AccountSettingsControls`, reusing the existing `renameAccount` / `setPrimaryAccount` / `archiveAccount` server actions | — |

## Design notes

- **Read-only aggregation.** The detail page composes existing RLS-scoped reads
  (`getAccountDetail` in `web/lib/queries.ts`) and never introduces a parallel
  management path — every mutating control routes through the same account /
  source / rule surfaces that already own them. Only `getAccountDetail` and
  `getAccountTransactions` are new; `AccountRow` gained `financial_source_id` +
  `created_at`.
- **The list still works standalone.** `/settings/accounts` keeps its inline
  Rename / Set primary / Archive controls (an e2e relies on the "Rename" button
  as its "an account exists" probe); the account name is now also a link into
  the detail object. A later cleanup could slim the list row to just a link.
- **No migration, no new RPC, no routes moved.**
