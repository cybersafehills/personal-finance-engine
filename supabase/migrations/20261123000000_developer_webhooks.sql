-- Integrations Phase 4, P4-PR4: outbound webhook subscriptions.
--
-- A workspace registers an https endpoint + a subset of event types; when
-- one of those events happens, enqueueWebhookEvent() fans out a
-- webhook_deliveries row per matching active subscription, and the
-- deliver-webhooks cron POSTs a signed JSON envelope (HMAC-SHA256 over
-- `${timestamp}.${body}`, the same scheme as the Phase 2 webhook
-- destination). Same conventions as the rest of the Integrations model:
-- RLS SELECT on integration.view; every write goes through the
-- service-role client; the signing secret is reveal-once and only its
-- SHA-256 hash is stored.

create table public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id),
  -- validated as a public https URL in code (isSafeWebhookUrl); re-checked
  -- here for the shape only.
  url text not null check (url ~ '^https://'),
  -- first 12 chars of the whsec_ secret, for identifying it in the UI. The
  -- signing secret itself lives in webhook_subscription_secrets (below),
  -- which has NO authenticated grant.
  secret_prefix text,
  -- every entry must be one of the known webhook event types; enforced in
  -- code (web/lib/integrations/webhooks/events.ts) and re-checked here.
  event_types text[] not null default '{}'::text[]
    check (event_types <@ array[
      'transaction.created', 'import.committed', 'export.completed',
      'accountant_package.completed', 'ledger.synced',
      'reconciliation.flagged', 'webhook.ping'
    ]::text[]),
  status text not null default 'active' check (status in (
    'active', 'paused', 'failing'
  )),
  description text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);

comment on table public.webhook_subscriptions is
  'A workspace''s outbound webhook endpoint. secret_hash = SHA-256 hex of the reveal-once whsec_ signing secret. status flips to failing after repeated delivery failures. RLS SELECT on integration.view; writes service-role only.';

create index idx_webhook_subscriptions_workspace
  on public.webhook_subscriptions (workspace_id, status);

create trigger set_webhook_subscriptions_updated_at
  before update on public.webhook_subscriptions
  for each row execute function public.set_updated_at();

alter table public.webhook_subscriptions enable row level security;

create policy webhook_subscriptions_select_member on public.webhook_subscriptions
  for select to authenticated
  using (public.has_space_capability(workspace_id, 'integration.view'));

revoke all on public.webhook_subscriptions from anon;
grant select on public.webhook_subscriptions to authenticated;
grant select, insert, update, delete on public.webhook_subscriptions to service_role;

-- ===========================================================================
-- webhook_subscription_secrets: the HMAC signing secret, service-role only,
-- ZERO authenticated/anon grants (same model as
-- integration_destination_secrets). The whsec_ plaintext is revealed to
-- the creator exactly once; the receiver verifies signatures with it
-- directly. Encryption at rest is a follow-up, as elsewhere in this model.
-- ===========================================================================
create table public.webhook_subscription_secrets (
  subscription_id uuid primary key
    references public.webhook_subscriptions (id) on delete cascade,
  secret text not null,
  rotated_at timestamptz not null default now()
);

comment on table public.webhook_subscription_secrets is
  'The whsec_ HMAC signing secret for one webhook subscription. Service-role only - no authenticated/anon grant. Rotated via rotateWebhookSecret; the plaintext is shown to the user once.';

alter table public.webhook_subscription_secrets enable row level security;
revoke all on public.webhook_subscription_secrets from anon, authenticated;
grant select, insert, update, delete on public.webhook_subscription_secrets to service_role;

-- ===========================================================================
-- webhook_deliveries: one attempt-tracked delivery per (event, subscription).
-- Service-role only - the dispatch + cron paths are the only readers.
-- ===========================================================================
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references public.webhook_subscriptions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_type text not null,
  -- opaque ref to the source resource (e.g. an export_job id) - not an FK.
  event_ref text,
  -- the already-redacted `data` object (ids + safe scalars only, never raw
  -- financial text / tokens / storage paths), fixed at enqueue time so the
  -- cron can rebuild and sign the exact same body on every retry.
  payload jsonb not null default '{}'::jsonb,
  -- SHA-256 hex of the exact JSON body that gets signed, for idempotency /
  -- dedupe on the receiver side.
  payload_digest text not null,
  status text not null default 'pending' check (status in (
    'pending', 'delivered', 'failed'
  )),
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz,
  response_status integer,
  error jsonb,
  claim_token uuid,
  claimed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.webhook_deliveries is
  'One outbound webhook delivery and its retry state. Carries a payload digest, not the payload. Service-role only.';

create index idx_webhook_deliveries_subscription
  on public.webhook_deliveries (subscription_id, created_at desc);
create index idx_webhook_deliveries_pending
  on public.webhook_deliveries (status, next_attempt_at)
  where status = 'pending';

alter table public.webhook_deliveries enable row level security;
revoke all on public.webhook_deliveries from anon, authenticated;
grant select, insert, update, delete on public.webhook_deliveries to service_role;
