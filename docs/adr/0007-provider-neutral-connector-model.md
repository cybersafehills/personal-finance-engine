# ADR 0007: Separate connector installations, financial sources, accounts, and device credentials

- **Status:** Accepted for staged implementation
- **Date:** 2026-08-30
- **Supersedes:** The one-connection/one-account binding from Phase C; ADR 0005's source ownership and visibility rules remain authoritative
- **Context:** OneLedger currently stores provider, lifecycle, account routing, and a credential hash together in `ingestion_connections`. That is adequate for one phone sending one mobile-money feed, but it cannot faithfully represent one bank authorization exposing several accounts, several devices feeding one source, or a connector being reauthorized without changing the financial identity of its accounts.

Implementation status: Stage A is encoded in
`20261011000000_connector_model_stage_a.sql`; Stage B preflight and reversible
legacy backfill are encoded in
`20261012000000_connector_model_stage_b_backfill.sql`; Stage C atomic
enrollment, lifecycle mirroring, canonical provenance, and shadow comparison
are encoded in `20261013000000_connector_model_stage_c_dual_write.sql`;
durable service-only shadow-health counters are encoded in
`20261014000000_connector_stage_c_shadow_health.sql`; the default-off Stage D
canonical credential resolver is encoded in
`20261017000000_connector_stage_d_canonical_auth.sql`; the additive
multi-source discovery and deterministic route resolver are encoded in
`20261018000000_connector_stage_d_multi_source_routing.sql`, with the adapter
boundary in `supabase/functions/_shared/connector-adapter.ts`. The first
concrete adapter, `mtn_momo_sms_v1`, is implemented in
`supabase/functions/ingest-momo/adapter.ts`; its deterministic event-envelope
route is guarded by the exact-match, default-off
`ONELEDGER_MTN_MOMO_ADAPTER=enabled` Edge Function secret. Redacted rollout
counters are encoded in
`20261019000000_connector_adapter_route_health.sql`.
Authentication and routing remain authoritative in `ingestion_connections`;
Stage C verifies the equivalent canonical route and fails closed on drift, but
does not cut reads over to the canonical model. Stage D remains gated on a
representative production observation window with every active connection
seen, zero unexplained mismatches/errors, and exercised lifecycle operations.
The Stage D UI read projection is prepared in
`web/lib/connector-read-model.ts` and `getCanonicalConnectorInstallations()`;
the canonical installation/source/account/credential cards are guarded by the
server-only, default-off `ONELEDGER_CANONICAL_CONNECTIONS_UI=enabled` preview
flag. The production Connections page remains on the legacy view until the
gate passes and canonical lifecycle RPCs are ready.

## Decision

Use four distinct domain objects:

```text
Connector installation
  1 ─── * Financial source
             1 ─── 1..* Account

Connector installation
  1 ─── * Device credential
             0..1 ─── Account scope
```

The first path describes discovery and ledger routing. The second describes
how a device or external agent authenticates. A credential does not own money,
transactions, or visibility.

### 1. Connector installation

A `connector_installation` is one configured relationship between OneLedger
and an ingestion mechanism: an SMS-forwarding device, a bank API consent, an
email import mailbox, or a statement-import adapter.

Proposed fields:

```sql
connector_installations (
  id uuid primary key,
  owner_user_id uuid not null,
  home_workspace_id uuid not null,
  connector_key text not null,
  external_installation_id text,
  display_name text not null,
  status text not null,              -- setup | testing | healthy | stale | paused | error | revoked
  auth_mode text not null,           -- device_secret | oauth | api_key | mailbox | none
  sync_cursor_encrypted text,        -- server-only; never exposed through user RLS
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
```

`connector_key` identifies an adapter contract such as `mtn_momo_sms_v1`,
`bank_open_api_v1`, or `statement_csv_v1`; it is not a provider enum embedded
throughout the ledger. Provider-specific configuration belongs in a validated,
versioned adapter configuration object, with secrets stored outside ordinary
application tables.

`home_workspace_id` is the installation's administrative home and default
routing context. It does not grant visibility to the sources the installation
discovers; ADR 0005's source ownership and explicit Space links still decide
that.

### 2. Financial source

`financial_sources` remains the stable, person-owned privacy boundary: one
mobile-money wallet, one bank deposit account, one card feed, one cash source,
or one import source. It survives connector rotation, reauthorization, and
device replacement.

Add a nullable `connector_installation_id`. A manual/cash source may have none.
One installation may own many sources. A source has at most one active
installation in the first implementation; connector history is preserved in
audit/raw-event metadata rather than by rewriting transaction provenance.

Provider identity must be scoped and non-secret:

- `provider_key`: canonical institution/provider identifier.
- `external_source_ref_hash`: keyed or plain hash of the provider's stable
  account reference when available.
- `masked_identifier`: display-only suffix, never used as identity.
- uniqueness: `(connector_installation_id, external_source_ref_hash)`, not a
  global provider reference.

The existing `owner_user_id`, visibility ceiling, lifecycle, currency, and
`source_space_links` rules remain unchanged.

### 3. Account

An `account` is the ledger/balance destination within a Space. Every account
belongs to exactly one financial source and one workspace. The existing
`accounts.financial_source_id` becomes the mandatory canonical relationship.

For the first release, a financial source normally has one account per target
Space. The schema must permit multiple accounts when the provider exposes
distinct sub-ledgers or currencies; uniqueness should therefore be based on a
source-scoped external account hash rather than `financial_source_id` alone.

Routing always resolves in this order:

1. Authenticate the installation/device credential.
2. Resolve or require the financial source.
3. Resolve the account within the trusted source and target Space.
4. Write raw evidence with all resolved provenance.
5. Normalize into the canonical transaction.

No request may supply a workspace/account pair that bypasses these relations.

### 4. Device credential

`device_credentials` contains revocable authentication material for agents
that push events into an installation. It replaces the credential columns in
`ingestion_connections`.

```sql
device_credentials (
  id uuid primary key,
  connector_installation_id uuid not null,
  account_id uuid,                    -- optional least-privilege route scope
  label text not null,
  credential_hash text not null unique,
  credential_prefix text not null,
  status text not null,               -- active | paused | revoked
  last_used_at timestamptz,
  expires_at timestamptz,
  rotated_from_id uuid,
  created_by uuid,
  created_at timestamptz,
  paused_at timestamptz,
  revoked_at timestamptz
)
```

Plaintext secrets remain reveal-once and are never persisted. Rotation creates
a new row and revokes the prior row atomically, preserving credential history.
An optional `account_id` narrows a device to one account; null means the
installation's adapter must provide a trusted source/account discriminator.

OAuth/API credentials are installation secrets, not device credentials. They
belong in the platform secret store or an encrypted server-only relation and
are referenced by opaque secret identifiers.

## Provider-neutral adapter contract

Every connector implements the same conceptual operations:

```ts
type ConnectorAdapter = {
  validateConfiguration(input: unknown): ValidatedConfiguration;
  testConnection(installation: InstallationContext): TestResult;
  discoverSources(installation: InstallationContext): DiscoveredSource[];
  pull?(installation: InstallationContext, cursor?: string): EventBatch;
  normalize(raw: RawFinancialEvent): NormalizedFinancialEvent[];
};
```

Push connectors authenticate first and submit an envelope containing adapter
version, event time, source discriminator, provider event reference, and raw
payload. Pull connectors produce the same internal envelope. Both enter the
same tenant/source-scoped raw-event and deduplication pipeline.

Adapters may classify and normalize evidence; they may not decide Space
membership, source visibility, final duplicate merging, or user attribution.

## Hard invariants

1. Every credential belongs to one installation; every credential is hashed,
   scoped, rotatable, revocable, and auditable.
2. Every automated raw event identifies its installation and financial source
   before canonical transaction creation.
3. Account, source, installation, and workspace relationships are enforced by
   composite foreign keys or trusted resolver RPCs—not UI assumptions.
4. Provider identifiers and deduplication keys are tenant/source scoped.
5. Connector lifecycle never deletes financial evidence or changes historical
   transaction ownership.
6. A source remains the visibility boundary. Installing a connector or joining
   a Space never shares a source.
7. Raw payloads and connector secrets remain service-role-only and follow an
   explicit retention policy.
8. `service_role` ingestion must resolve explicit installation/source/account
   scope before writes; it may not perform broad unscoped lookup fallbacks.

## Staged migration plan

### Stage A — additive foundation

- Create `connector_installations` and `device_credentials` with RLS enabled.
- Add nullable `financial_sources.connector_installation_id`.
- Add nullable `raw_financial_events.connector_installation_id` and
  `device_credential_id` while retaining `ingestion_connection_id`.
- Add composite uniqueness/FKs needed to prove installation → source → account
  and optional credential → account scope.
- Expose secrets only through MFA-step-up server actions/RPCs.

No existing ingestion behavior changes in this stage.

### Stage B — deterministic backfill

For each existing `ingestion_connections` row:

1. Create one connector installation using its owner/workspace/provider,
   lifecycle, label, and health timestamps.
2. Attach the connection's existing financial source to that installation.
3. Create one device credential carrying the existing credential hash/prefix,
   lifecycle timestamps, and current account scope.
4. Store the generated installation and credential IDs on the legacy row for
   reversible dual-read verification.

Abort rather than guess when a connection lacks a source, crosses workspaces,
or maps ambiguously. Produce a preflight report before applying constraints.

### Stage C — dual write and shadow resolution

- New connection enrollment writes both the canonical model and compatibility
  fields required by the old application.
- Ingestion authenticates against `device_credentials`, resolves the canonical
  route, and compares it with the legacy `ingestion_connections` route.
- Mismatches emit a redacted metric and reject the event; they never silently
  choose one route.
- Raw events write both old and new provenance IDs.

Exit criteria: zero unexplained shadow mismatches through a representative
production window and verified pause/rotate/revoke behavior.

### Stage D — canonical reads and multi-account enablement

- Move settings/health UI to connector installations and their discovered
  sources/accounts.
- Route reversible installation pause/resume and rename through owner-scoped
  canonical RPCs that atomically maintain Stage C compatibility rows. An
  installation pause records which credentials it paused so resume never
  reactivates a credential paused independently.
- Rotate device credentials by inserting a successor linked through
  `rotated_from_id`, revoking but retaining the predecessor, and atomically
  advancing any Stage C compatibility mapping. Permanent installation revoke
  disables every credential without deleting historical provenance. Both
  operations enforce progressive MFA at the database boundary.
- Permit adapters to discover multiple sources and accounts.
- Require an explicit selection or deterministic provider discriminator when
  more than one route exists.
- Cut ingestion and reporting to canonical provenance fields while continuing
  compatibility writes.

### Stage E — retire the legacy aggregate

- Stop creating `ingestion_connections` rows.
- Make canonical provenance columns non-null for automated channels.
- Retain a compatibility view for one release if needed.
- Remove legacy credential/provider/account columns only after code search,
  telemetry, migration tests, rollback rehearsal, and backup verification show
  no readers.

Historical IDs remain available through an immutable mapping table or audit
metadata. No transaction or raw event is rewritten merely to simplify names.

## Rollback strategy

Stages A–C are additive. Rollback switches authentication/routing to the legacy
resolver while preserving canonical rows for diagnosis. Stage D rollback uses
the maintained dual-write fields. Stage E is irreversible and requires a
separate approval, tested restore point, and confirmed compatibility-window
expiry.

## Required verification

- One SMS installation, one source, one account, multiple rotated credentials.
- One bank installation discovering at least two sources/accounts.
- Two devices scoped to different accounts under one installation.
- Identical provider references in two installations coexist.
- A credential cannot route to another installation/source/workspace.
- Pause, expiration, rotation, and revoke take effect atomically.
- Reauthorization preserves source/account identity and transaction history.
- Source sharing remains unchanged after connector/device changes.
- Raw events retain legacy and canonical provenance throughout dual write.
- Service-role resolvers reject missing or ambiguous scope.

### Discovery and routing contract

Adapters validate their provider response before calling
`apply_connector_discovery`. Raw provider references are hashed at the adapter
boundary; only stable `source_ref_hash` and source-scoped `account_ref_hash`
values reach ordinary database metadata. Unknown fields are rejected so access
tokens, balances, or raw payloads cannot be accidentally persisted there.
Discovery is idempotent and may update display labels/masks, but a changed
provider, type, or currency for an existing discriminator is an identity error,
not an in-place mutation.

`resolve_connector_event_route` applies the following precedence:

1. An account-scoped credential always resolves to that account; conflicting
   discriminators fail closed.
2. An installation-wide credential may omit a source/account discriminator
   only when exactly one active candidate exists at that step.
3. Multiple active candidates require their stable hash discriminator. Masked
   identifiers and display names are never routing keys.

Both RPCs are service-role-only. `mtn_momo_sms_v1` now produces discovery and
event discriminators through the same domain-separated hash contract. Its live
event-route RPC remains dormant unless the provider-specific rollout flag and
the exact installation's service-only canary row are both enabled. Initial
pairing accepts hashes only, attaches them to the existing legacy-backed
source/account in one transaction, verifies the deterministic route, and
requires the installation owner to be a platform admin. It allows only one
enabled installation per connector key. Five clean post-enable
matches are required before the redacted status projection declares the canary
ready for broader rollout. Existing account-scoped credentials need no client
discriminator; if a future unscoped device supplies raw source and account
references, the adapter hashes them in memory and the resolver rejects missing,
unknown, ambiguous, or conflicting routes before evidence is written.

## Rejected alternatives

- **Keep expanding `ingestion_connections`:** retains conflicting lifecycle,
  authentication, discovery, and routing responsibilities and still cannot
  model multi-account consent cleanly.
- **Make accounts the connector boundary:** couples provider authorization to a
  ledger projection and makes reauthorization/history fragile.
- **Make credentials the connection:** device rotation would falsely create a
  new financial identity.
- **Create provider-specific ledger tables:** fragments normalization, RLS,
  reporting, and reconciliation.
- **Big-bang replacement:** creates avoidable ingestion downtime and weakens
  provenance verification.

## Consequences

The model adds tables and a temporary dual-write period, but each lifecycle now
has one owner. It supports mobile-money forwarding without making that special
case the architecture, enables multi-account connectors, and preserves the
privacy and evidence invariants already established by ADRs 0001, 0003, and
0005.
