-- Phase U (PR4): ingestion-connection lifecycle - a "paused" state
-- between active and revoked.
--
-- Pause is reversible and keeps the credential intact: a paused
-- connection's device simply stops being able to send transactions in
-- (ingest-momo's authenticateCredential already rejects any status other
-- than 'active'), and resuming restores it with no credential rotation.
-- Revoke stays the one-way door it was.
--
-- Additive: one nullable column, a widened CHECK, no new table / grant /
-- function / policy. The existing ingestion_connections_update_owner RLS
-- policy already scopes who can make this change.

alter table public.ingestion_connections
  add column paused_at timestamptz;

comment on column public.ingestion_connections.paused_at is
  'When this connection was paused (reversible, credential preserved) - null unless status = ''paused''. Distinct from revoked_at, which is the permanent one-way state.';

-- Widen the status domain. The inline CHECK from the Phase C table
-- definition is auto-named <table>_<column>_check by PostgreSQL.
alter table public.ingestion_connections
  drop constraint ingestion_connections_status_check;

alter table public.ingestion_connections
  add constraint ingestion_connections_status_check
  check (status in ('active', 'paused', 'revoked'));

-- Replace the status/timestamp consistency constraint so it also governs
-- paused_at. 'active' has neither timestamp; 'paused' has paused_at and no
-- revoked_at; 'revoked' has revoked_at (paused_at may linger from an
-- earlier pause - revoke never clears it, and it is meaningless once
-- revoked anyway).
alter table public.ingestion_connections
  drop constraint ingestion_connections_revoked_consistent_with_status;

alter table public.ingestion_connections
  add constraint ingestion_connections_status_timestamps check (
    (status = 'active' and revoked_at is null and paused_at is null)
    or (status = 'paused' and revoked_at is null and paused_at is not null)
    or (status = 'revoked' and revoked_at is not null)
  );
