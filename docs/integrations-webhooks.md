# Webhooks

_Integrations Phase 4, P4-PR4–P4-PR5._ OneLedger POSTs a signed JSON
envelope to a workspace's registered https endpoint when an event happens.
Managed at **`/integrations/developer`** (Webhooks section).

## Enabling it

- `INTEGRATIONS_WEBHOOKS_DEV_ENABLED=true` (exact string; also requires
  `INTEGRATIONS_DEVELOPER_API_ENABLED=true`). `gate.ts:isDeveloperWebhooksEnabled`.
- `integration.developer_manage` (owner/admin) to create/manage endpoints.

## The request

```
POST <your endpoint>
Content-Type: application/json
X-OneLedger-Timestamp: 1788307200          # unix seconds
X-OneLedger-Signature: <hmac-sha256 hex>
```

```jsonc
{
  "id": "<delivery id>",          // stable across retries; use it to dedupe
  "type": "export.completed",
  "created_at": "2026-09-04T00:00:00.000Z",
  "workspace_id": "<uuid>",
  "data": { /* redacted: ids + safe scalars only */ }
}
```

## Verifying the signature

```
expected = HMAC_SHA256(
  key  = <your whsec_ secret>,           // shown once at creation / rotation
  msg  = X-OneLedger-Timestamp + "." + <raw request body>
)   // hex
```

Compare `expected` to `X-OneLedger-Signature` with a constant-time check.
**Also reject** a request whose `X-OneLedger-Timestamp` is more than a few
minutes from now (replay protection).

Node example:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, req) {
  const ts = req.headers["x-oneledger-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${req.rawBody}`)
    .digest("hex");
  const got = req.headers["x-oneledger-signature"] ?? "";
  return got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

## Event catalog

| `type` | Fires when | `data` (redacted) |
| --- | --- | --- |
| `export.completed` | an export job finishes | `export_id`, `format`, `row_count`, `period` |
| `accountant_package.completed` | a Ready-for-Accountant ZIP is built | `package_id`, `period_start`, `period_end`, `row_count`, `byte_size` |
| `ledger.synced` | a connected accounting ledger sync succeeds | `ledger_id`, `provider`, `pushed`, `skipped` |
| `import.committed` | _reserved_ — not yet emitted | — |
| `transaction.created` | _reserved_ — not yet emitted | — |
| `reconciliation.flagged` | _reserved_ — not yet emitted | — |
| `webhook.ping` | you press **Send test** | `{ message }` |

## Delivery, retries, failure

- Each event enqueues one `webhook_deliveries` row per matching **active**
  subscription. The payload and its digest are fixed at enqueue, so every
  retry signs the identical body.
- The `deliver-webhooks` cron (`x-report-cron-secret`; not scheduler-wired)
  claims due rows and POSTs with **no redirects** and a 15-second timeout.
- A `2xx` is success. Otherwise the shared backoff applies: up to 5
  attempts, `min(60·2ⁿ, 3600)` seconds apart.
- After **3 terminal failures within an hour** the subscription flips to
  `failing` (no further deliveries), its owner gets an in-app notification,
  and an `integration_events` `webhook.delivery_failed` is written. Fix the
  endpoint and **Resume** it.
- Delivered rows are purged after 30 days.

## Security notes

- The signing secret lives in `webhook_subscription_secrets`, a
  service-role-only table with no `authenticated` grant — the RLS-readable
  `webhook_subscriptions` row only carries the 12-char prefix.
- SSRF: only public https hosts are accepted (`isSafeWebhookUrl` —
  loopback / private / link-local / `.local` / `.internal` blocked), and
  redirects are refused at delivery time.
- Rotate the secret any time from the UI; the old one stops working
  immediately.
