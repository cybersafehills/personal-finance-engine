# Developer API (`/api/v1`)

_Integrations Phase 4, P4-PR1–P4-PR3._ A **read-only** REST surface for a
workspace's own integrations. First non-session public surface in the
codebase — every route is bearer-key-authenticated, scoped, rate-limited,
and request-logged.

## Enabling it

- Flag `INTEGRATIONS_DEVELOPER_API_ENABLED=true` (exact string; also
  requires `INTEGRATIONS_ENABLED` + the workspace allowlist).
  `gate.ts:isDeveloperApiEnabled` / `isDeveloperApiConfigured`.
- Manage keys at **`/integrations/developer`** — `integration.developer_manage`
  (owner/admin) required. A created key's token is shown **once**.

## Authentication

```
Authorization: Bearer olk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

The token is SHA-256 hashed and matched against `api_keys.key_hash`
(migration `20261121000000`); the plaintext is never stored. A key belongs
to exactly one workspace and carries a subset of the scopes below. Requests
run with a service-role client **pinned to the key's `workspace_id`** — the
key's scopes are the sole authorization check (there is no session).

Failures are `401` with `{ "error": { "code": "...", "message": "..." } }`:
`missing_bearer`, `invalid_key`, `key_revoked`, `key_expired`.
`403 insufficient_scope` when the key lacks the endpoint's scope.
`404 not_found` when the API is disabled for the deployment or workspace.

## Scopes

| Scope | Grants |
| --- | --- |
| `transactions:read` | `GET /transactions`, `GET /transactions/:id` |
| `accounts:read` | `GET /accounts` |
| `categories:read` | `GET /categories` |
| `exports:read` | `GET /exports`, `GET /exports/:id` |
| `sync:read` | `GET /sync-runs` |
| `events:read` | `GET /events` |

## Response shape

```jsonc
{ "data": [ ... ],                 // or a single object
  "meta": { "next_cursor": "..." } // list endpoints only; null when done
}
```
Errors: `{ "error": { "code": "...", "message": "..." } }`.
Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Pagination

List endpoints take `?limit=` (1–200, default 50) and `?cursor=` (opaque;
copy `meta.next_cursor` verbatim). Ordering is newest-first by the
resource's timestamp; the cursor is a keyset over `(timestamp, id)`, so it
is stable across inserts.

## Rate limiting

Fixed window, per key: `API_RATE_LIMIT_PER_MINUTE` requests/minute
(default 120). Every response includes `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` (ISO). Over the limit →
`429 rate_limited` + `Retry-After: 60`.

## Endpoints

| Method & path | Notes |
| --- | --- |
| `GET /api/v1/ping` | echoes `{ workspace_id, scopes }`; no scope required |
| `GET /api/v1/transactions` | `?from &to &account_id &direction=in\|out\|neutral &category`; excludes merged duplicates. Amounts are integer minor units. |
| `GET /api/v1/transactions/:id` | |
| `GET /api/v1/accounts` | unpaginated |
| `GET /api/v1/categories` | workspace category set |
| `GET /api/v1/exports` | export-job metadata |
| `GET /api/v1/exports/:id` | for a completed job, adds `download_url` (a ~5-minute signed URL) + `download_url_expires_in` |
| `GET /api/v1/sync-runs` | workbook + accounting-ledger sync history |
| `GET /api/v1/events` | the redacted `integration_events` feed (no payloads, no stack traces) |

## Example

```bash
curl -s https://<host>/api/v1/transactions?limit=2 \
  -H "Authorization: Bearer olk_..."
```

## Logging & retention

One `api_request_log` row per request (method, path, status, response_ms,
truncated IP hash — no bodies, no query values). Service-role only, purged
after 30 days by `POST /api/cron/purge-api-logs` (`x-report-cron-secret`;
not scheduler-wired).

## Not offered

Write endpoints, OAuth2 client-credentials, third-party app authorization,
per-endpoint quotas beyond the flat rate limit. (Phase 5+.)
