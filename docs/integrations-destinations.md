# Integration destinations

Companion to `integrations-architecture.md`. Where an export or a
connected-workbook sync result is delivered. Phase 2, migrations
`20261101000000` (model) onward.

## Kinds

| Kind | Real? | Notes |
| --- | --- | --- |
| `download` | yes | No delivery — the file stays in the Export history for the user to pull. This is the null / default behaviour. |
| `webhook` | yes | A signed HTTPS POST. No external account needed. |
| `cloud_storage` | **dark** | Google Drive / OneDrive / Dropbox. The OAuth flow and the delivery upload are stubbed and return `provider_not_configured` until the provider's `*_CLIENT_ID` / `*_SECRET` env is set. |
| `connected_workbook` | `manual_file` real; Sheets/Excel dark | See `integrations-connected-workbooks.md`. |

## Data

- `integration_destinations` — `kind`, `provider`, redacted `config`
  (webhook URL, folder path, …), `status`
  (`active` / `needs_auth` / `error` / `disabled`), `last_delivery_at`,
  `last_error_code`. RLS SELECT gated on `integration.view`.
- `integration_destination_secrets` — **service-role only, zero
  authenticated/anon grants.** Holds the SHA-256 of the reveal-once
  webhook signing secret (`secret_kind='webhook_hmac'`) or the OAuth
  token blob (`secret_kind='oauth_token'`; encryption at rest is a
  follow-up).
- Every delivery attempt writes an `integration_sync_runs` row.

## Webhook signing

Each POST carries:

```
Content-Type: application/json
X-OneLedger-Timestamp: <unix seconds>
X-OneLedger-Signature: <hex HMAC-SHA256( secret, "<timestamp>.<body>" )>
```

The receiver recomputes the signature with its copy of the secret and
compares. Rotate the secret from the destination's "Rotate secret"
action (the new value is shown once). Bodies:

- `oneledger.export.ready` — `{ export_job_id, filename, row_count,
  period, download_url (1h signed), … }`
- `oneledger.test` — sent by the "Test" action.

## SSRF policy (`web/lib/integrations/destinations/webhook.ts`)

`isSafeWebhookUrl` rejects: non-`https`, embedded credentials, and any
host that is `localhost`, a `.local` / `.internal` name, or a literal
loopback / private / link-local / carrier-metadata address
(`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, …).
The delivery `fetch` also sets `redirect: "error"` and a 15s timeout.
DNS rebinding is a residual risk noted in the code.

## Authorization

`integration.destination_manage` (owner/admin) for every create / update /
rotate / delete / test / OAuth-start. Delivery itself runs service-role
from the export cron.

## Capabilities & flags

- `INTEGRATIONS_DESTINATIONS_ENABLED` (on unless `"false"`, downstream of
  `INTEGRATIONS_SYNC_ENABLED`).
- `INTEGRATIONS_CLOUD_STORAGE_ENABLED` (off unless `"true"`) + a
  per-provider `*_CLIENT_ID` / `*_SECRET` pair.
