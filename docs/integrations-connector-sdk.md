# Inbound connector SDK

_Integrations Phase 4, P4-PR6._ The documented contract for an **inbound**
connector — one that brings provider data *into* OneLedger — plus a
reference implementation you can copy.

This is the SDK-level companion to
[`integrations-connector-howto.md`](integrations-connector-howto.md): the
howto is the operational checklist ("what tables, what gate, what
monitoring"); this doc is the code contract and a worked example.

Outbound delivery (export destinations, connected workbooks, accounting
push) uses a **different, parallel** set of contracts — see the "Outbound
adapters" section of the howto. `connector-adapter.ts` is not involved
there.

## The contract

Every inbound connector implements
`supabase/functions/_shared/connector-adapter.ts:ConnectorAdapter<Configuration, RawEvent, NormalizedEvent>`
and nothing else. Provider logic never leaks into an Edge Function body, a
web service, or SQL.

```ts
type ConnectorAdapter<Configuration, RawEvent, NormalizedEvent> = {
  validateConfiguration(input: unknown): Configuration;

  testConnection(
    installation: ConnectorInstallationContext,
    configuration: Configuration,
  ): Promise<{ ok: true } | { ok: false; errorCode: string }>;

  discoverSources(
    installation: ConnectorInstallationContext,
    configuration: Configuration,
  ): Promise<unknown>;

  pull?(
    installation: ConnectorInstallationContext,
    configuration: Configuration,
    cursor?: string,
  ): Promise<{ events: RawEvent[]; cursor?: string }>;

  normalize(raw: RawEvent): NormalizedEvent[];
};
```

| Method | When it runs | Rules |
| --- | --- | --- |
| `validateConfiguration` | at install and on every edit | **Fail closed on unknown keys.** Never copy a token/secret into the returned object. Normalise here (upper-case currency, canonical URL) so nothing downstream re-parses. Throw a stable string error code. |
| `testConnection` | on demand from the UI | Cheap readiness probe. **Return** `{ ok: false, errorCode }` for an expected failure; only throw on a bug. Push-only connectors that have no upstream to probe return `{ ok: true }`. |
| `discoverSources` | after a successful `testConnection` | Return the source/account tree in the shape `buildConnectorDiscoveryPayload` accepts (see below). Raw provider references are hashed out before they touch the database. |
| `pull` | optional; each scheduled/manual sync | Fetch **one page** of raw provider evidence plus the `cursor` to resume from. Omit entirely for push connectors (SMS forwarding, inbound webhooks). All network I/O lives here. |
| `normalize` | once per raw event, in the pipeline | **Pure.** No I/O, no `Date.now()`. Map one `RawEvent` to zero or more canonical `ConnectorEventEnvelope`s. Return `[]` to drop an event. |

### Types you build on

- `CONNECTOR_ADAPTER_VERSION` — the string every envelope stamps as
  `adapter_version`. Use it unless your connector needs a version
  independent of the envelope shape, in which case keep a local constant
  (`ingest-momo` does: `MTN_MOMO_SMS_ADAPTER_VERSION`).
- `defineConnectorAdapter<C, R, N>(adapter)` — identity helper. Wrap your
  adapter literal in it so it is type-checked at the definition site with
  clear errors, while callers still see concrete `C` / `R` / `N`.
- `ConnectorEventEnvelope<Payload>` — the canonical event: `connector_key`,
  `adapter_version`, `event_time`, `provider_event_reference`,
  `source_external_ref`, `account_external_ref`, `payload`. The `payload`
  is **redacted**: ids and safe scalars only, never raw counterparty text,
  balances, or provider blobs.
- `buildConnectorDiscoveryPayload(input, hashConnectorReference)` — takes
  your `discoverSources` output, validates it, domain-separates and
  SHA-256-hashes every raw `externalRef`, and returns the exact payload
  `resolve_connector_event_route` accepts. Unknown fields **fail closed**
  (this is what stops an adapter accidentally forwarding an access token
  into a metadata table).
- `buildConnectorEventRouteDiscriminators(envelope)` — the matching hash
  step for an event at pull time; an account discriminator without its
  source throws.

### Provider / source-type vocabulary

`buildConnectorDiscoveryPayload` only accepts:

- `provider` ∈ `mtn_momo`, `airtel_money`, `bank`, `card`, `cash`,
  `statement`, `other`
- `sourceType` ∈ `mobile_money`, `bank_account`, `card`, `cash`, `import`
- `providerKey` matches `^[a-z][a-z0-9_]{1,63}$` (your `connector_key`)
- `maskedIdentifier` — display only, ≤ 4 digits, **never** part of routing
  identity

## Reference adapter: `example-csv`

`supabase/functions/_shared/connectors/example-csv/` is a complete,
deno-tested adapter over a flat public CSV file
(`id,date,description,amount`). It is **not wired into anything** — no
Edge Function, no migration, no `connector_installations` row. It exists
to be read and copied.

What it demonstrates:

- **The pure / I/O seam.** `csv.ts` is a pure RFC 4180 reader.
  `adapter.ts:toRawEvents` is a pure table → `RawEvent[]` mapping,
  exported and tested on its own. Only `pull` / `testConnection` touch the
  network.
- **Injectable `fetch`.** `createExampleCsvAdapter({ fetchImpl })` — the
  whole adapter is unit-tested with a stub; production callers use the
  default `globalThis.fetch`. A real adapter should do the same so its
  tests never open a socket.
- **Cursor-based incremental `pull`.** The cursor is the last row index
  seen; the next `pull` returns only newer rows.
- **Redaction.** `normalize` emits ids + `{ description, amount_minor,
  currency }` only. A token in the CSV URL's query string never reaches
  `source_external_ref` (only host + path do) and never reaches the
  envelope — there is a test asserting exactly that.
- **Fail-closed config.** `validateConfiguration` rejects unknown keys,
  non-https URLs, URLs carrying credentials, and non-ISO currency codes.

Run it:

```sh
deno check supabase/functions/_shared/connectors/example-csv/adapter.ts
deno test  supabase/functions/_shared/connectors/example-csv/tests
```

Both run in CI (`deno-quality` job).

## Turning a copy into a real connector

`example-csv` is deliberately inert. A shipped connector additionally
needs, in roughly this order (full detail in the howto):

1. **A migration** — any new provider table + RLS, and a `connector_key`
   the canonical connector tables (`connector_installations`,
   `financial_sources`, `device_credentials`) recognise. Chain-tested.
2. **The adapter** — your `ConnectorAdapter` implementation next to
   `example-csv/`, with fixtures and a **two-tenant collision test**
   (identical provider text for two workspaces must stay independent).
3. **An Edge Function** that owns the pull/receive loop and calls the
   shared ingestion pipeline — the adapter itself never talks to Supabase.
4. **Dedup** — a deterministic `payload_hash` on `raw_financial_events`
   that includes the `financial_source_id` (tenant-scoped). Transaction
   -level ambiguity lands in `/transactions/review` via
   `compute_transaction_fingerprint`; never auto-merge.
5. **Auth config** — an `auth_mode` (`device_secret` / `oauth` /
   `api_key` / `mailbox`). Credentials are reveal-once, hashed, scoped,
   rotatable, revocable, audited — never in a user-facing table.
6. **A rollout gate** — an env flag following `web/lib/pay/gate.ts`
   conventions, default-off with an allowlist until an observation window
   passes.
7. **Health + activity** — emit redacted `integration_events` rows so
   `/integrations/activity` and `get_operational_health_snapshot` see the
   connector. No raw payloads, no secrets, no financial values in
   `context`.

## Where NOT to start

Do not add Airtel / bank-API / email / receipt connectors as enum values
or half-adapters. Each needs a real adapter, fixtures, monitoring,
onboarding, and production verification before it is a shipped connector —
drive it from a design-partner use case, not a catalogue. `example-csv`
being easy to copy does not make "add ten connectors" a one-PR task.
