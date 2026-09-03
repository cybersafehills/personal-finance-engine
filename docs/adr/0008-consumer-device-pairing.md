# ADR 0008: Consumer device pairing and a stable capture endpoint

- **Status:** Accepted for staged implementation (PR1: backend foundation)
- **Date:** 2026-09-03
- **Builds on:** ADR 0007 (connector installation / financial source / account /
  device credential are distinct lifecycles). ADR 0005 source-visibility rules
  and ADR 0001 non-custodial boundary remain authoritative.
- **Context:** ADR 0007 gave OneLedger a real device model, but enrollment still
  makes a non-technical user paste a permanent `x-ingest-key` (`pfe_…`), an
  endpoint URL, HTTP headers and a JSON body into Apple Shortcuts
  (`web/components/ConnectionDetails.tsx`). `ONELEDGER_AUDIT.md` F7 and
  `docs/CLAUDE_CODE_HANDOFF.md` §10 both flag this as the top onboarding blocker.

## Decision

### 1. A pairing session is not a credential

Introduce `public.pairing_sessions`: a short-lived (10-minute), single-use
record of an *intent* to connect a device. The web app, on behalf of an
authenticated workspace owner, calls `create_device_pairing_session(...)` and
receives a one-time **pairing token**. Only `sha256(token)` is stored
(`token_hash`, `^[0-9a-f]{64}$`); a short `token_prefix` (`olp_XXXX`) is stored
for display. The plaintext token is shown to the user once and never persisted.

A device redeems the token exactly once. Redemption issues a scoped
`device_credentials` row — the device's own long-lived secret, which the user
never sees. Rotating or losing that credential never invalidates the financial
identity of the source or account (ADR 0007).

**Why short-lived + single-use rather than an attempt counter:** a redemption
that fails raises inside one statement, so any counter increment rolls back.
Replay resistance therefore comes from 128-bit token entropy, a 10-minute TTL,
single use, and the capture endpoint's own rate limiter — not from DB-side
lockout state.

### 2. Redemption runs as `service_role` with session-derived scope

`consume_device_pairing_session(...)` is granted to `service_role` only. It
locks the session row and derives owner, home workspace, intended account,
provider and label **from that trusted row** — never from anything the device
sends (ADR 0007 invariant 8). It then reuses the existing enrollment path:

- `_enroll_ingestion_connection(...)` — the body of
  `create_ingestion_connection_dual_write` factored out so the owner is a
  parameter instead of `auth.uid()`. Creates the legacy `ingestion_connections`
  row plus the canonical installation / source / device-credential mapping in
  one transaction (via `backfill_legacy_ingestion_connection`). Used when the
  session has no `connector_installation_id` (first-time pairing).
- A direct `device_credentials` insert against an existing installation, when
  the session carries a `connector_installation_id` (device replacement / a
  second device).

No Stage E work: `ingestion_connections` stays authoritative for live routing,
and every paired device gets a `legacy_ingestion_connection_id` mapping so
rollback and the Stage C shadow comparison keep working.

Typed failures (`PAIRING_INVALID`, `PAIRING_EXPIRED`, `PAIRING_ALREADY_USED`,
`PAIRING_BAD_CREDENTIAL`, `PAIRING_NO_ROUTE`) are raised as the bare code; the
Edge Function maps them to HTTP status and records a redacted
`connector_pairing_events` row from its catch block (failure-path audit inserts
in the RPC would roll back with the raise).

### 3. A stable capture endpoint, provider-agnostic

New Edge Function `supabase/functions/capture/` (`verify_jwt = false`), dark
unless the exact-match secret `DEVICE_PAIRING_V2=enabled` is set (otherwise a
hard 404). Two operations in PR1:

- `op:"pair"` — body `{ pairing_token, device_secret, client_version, platform,
  device_label? }`. The device generates its own `device_secret` (`pfe_…`
  family, so `device_credentials.credential_prefix` keeps one shape). The
  function hashes both inputs, calls `consume_device_pairing_session`, and
  returns `{ ok, device_id, capture_url }`. The secret is never echoed.
- `op:"test"` — header `x-device-key: <device_secret>`, universal envelope
  `{ message?, received_at?, client_version, metadata? }`. Authenticates via the
  existing `resolve_canonical_ingestion_credential`, validates the envelope,
  bumps `last_used_at`, records `device_test_succeeded`, and returns
  `{ ok:true, test:true }`. **Writes no transaction or raw event** — a safe,
  repeatable proof that setup works.

The real inbound-message path (`op:"capture"`) is a follow-up PR that will share
`ingest-momo`'s parser / raw-event / policy modules; `ingest-momo` stays the
live path meanwhile and is untouched by this PR.

**Stable address.** The function reads `ONELEDGER_CAPTURE_BASE_URL` (e.g.
`https://api.oneledger.me/v1`) and reports `<base>/capture` to paired devices.
Until that subdomain is provisioned it reports its own Supabase Functions URL,
so moving to `api.oneledger.me` later requires no device to be reconfigured —
that is the whole point of returning `capture_url` at pair time and storing it
device-side rather than compiling it into the Shortcut.

### 4. Migration from the manual key

No forced cutover. Existing `x-ingest-key` connections keep working through
`ingest-momo`. A device paired through the new flow simply holds a scoped
`device_credentials` secret instead of a user-visible key. The wizard PR will
offer "upgrade this connection" for legacy rows; this PR only lays the
foundation.

### 5. Cross-device handoff (`/pair`)

Setup often starts on a desktop but must finish on the phone. The desktop wizard
renders a QR of a public, no-auth `https://oneledger.me/pair?c=<token>` page; the
phone scans it, sees the code, and one tap runs the Capture Shortcut. The page
calls no RPC — the Shortcut redeems, and the desktop wizard's existing 3-second
poll advances itself. The single-use ~10-minute token rides in the URL query
(same tradeoff as a magic link): mitigated with `referrer: no-referrer`, and the
DB still enforces single use + TTL on redemption, so the URL is a transport, not
the trust boundary. QR generation is `web/lib/qr.ts`, a thin wrapper over `uqr`
(MIT, zero runtime deps), round-trip verified against the repo's `jsqr` decoder.

## Consequences

- One new short-lived table, one redacted audit table, one authenticated RPC,
  two service-role RPCs, one thin Edge Function, one cleanup cron.
- The enrollment body now has a single implementation shared by the
  authenticated wrapper and the pairing redemption.
- The pairing protocol is platform-neutral: `platform` is a free field and the
  device secret is a generic credential, so a native iOS/Android app can pair
  through the same endpoint later.

## Rejected alternatives

- **Ship the pairing token itself as the ingest credential.** It would become a
  permanent key by another name and defeat single-use.
- **Have the web app create the credential at session time.** The device could
  not then choose its own secret, and the plaintext would transit the browser.
- **Pre-provision `api.oneledger.me` before shipping.** Not required — returning
  and storing `capture_url` at pair time makes the infra move transparent, and
  the DNS/rewrite is an operational task, not a code dependency.
