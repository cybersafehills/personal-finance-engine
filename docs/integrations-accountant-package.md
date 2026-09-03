# Ready-for-Accountant package

_Integrations Phase 3, P3-PR3 (model) + P3-PR4 (builder)._ A period-scoped
**ZIP** at `/integrations/accountant` that an accountant can open directly:

```
oneledger-accountant-package.zip
├── transactions.csv      every ledger row for the period
├── workbook.xlsx         Summary / Transactions / Income / Expenses / Categories / Accounts
├── cover.pdf             one-page summary (period, contents, reconciliation status)
└── MANIFEST.json         redacted rollup (counts, section list, generated-at)
```

## How it's built

- `web/lib/integrations/accountant/build.ts` → `runAccountantPackageBuild(packageId)`
  (server-only). Reuses the Export Center engine verbatim:
  `export/query.ts:buildExportDataset`, `export/workbook.ts:buildCsv` /
  `buildXlsx`. The PDF cover is `accountant/cover-pdf.tsx`
  (`@react-pdf/renderer`, same approach as `report-pdf.tsx`). Zips with
  `jszip` (DEFLATE level 6), uploads to the private
  `integration-accountant-packages` bucket, marks the row `ready`, and
  writes an `integration_events` `accountant_package.completed` /
  `accountant_package.failed`.
- The **reconciliation summary** on the cover is computed here from
  `balance_reconciliations` (mismatch / pending_review for this workspace's
  accounts) + open `integration_conflicts`. Purely informational — it never
  blocks the build.

## Lifecycle

`accountant_packages` (migration `20261111000000`): `queued → building →
ready | failed`, keyed by `id`, ZIP path
`{workspace_id}/{package_id}/oneledger-accountant-package.zip`.

- **Create**: `createAccountantPackage(input)` server action
  (`integration.accountant_package`). `input` is a relative preset
  (`previous_month`, …) or an absolute `{from,to}` (YYYY-MM-DD). Resolves
  to inclusive date bounds, inserts the row, and — if the period's
  transaction estimate is ≤ 20 000 — builds inline. Larger periods stay
  `queued`.
- **Cron** `web/app/api/cron/build-accountant-packages/route.ts`
  (`isAuthorizedCronRequest`) builds queued packages, re-claims ones stuck
  in `building` past a 15-minute lease, and purges the stored ZIP of
  packages older than 30 days (the history row stays; the download 404s as
  "Expired"). **Not scheduler-wired** — like every other cron here.
- **Download**: `GET /api/integrations/accountant/[id]` — session-auth,
  RLS-scoped row, re-checks `integration.accountant_package`, then a
  300-second signed URL. Never a public object.

## Authorization & gating

- Flag: `INTEGRATIONS_ACCOUNTANT_PACKAGE_ENABLED` (on unless exactly
  `"false"`; also requires `INTEGRATIONS_ENABLED` + the workspace
  allowlist). `gate.ts:isAccountantPackageEnabled`.
- Capability: `integration.accountant_package` (owner/admin only — migration
  `20261111000000`). `accountant_packages` SELECT is RLS-gated on
  `integration.view`; every write is service-role only.
