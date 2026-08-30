-- Phase 0 hardening: evidence/provider identifiers are unique within their
-- owning ingestion scope, never across unrelated customers.

-- Legacy rows predate connections and remain nullable. New ingest-momo rows
-- always stamp the authenticated connection before any duplicate decision.
alter table public.momo_messages
  add column ingestion_connection_id uuid
    references public.ingestion_connections (id) on delete restrict;

-- Recover connection provenance wherever the canonical transaction already
-- carries it. Unprocessed historical messages remain intentionally unknown.
update public.momo_messages m
set ingestion_connection_id = t.ingestion_connection_id
from public.transactions t
where t.momo_message_id = m.id
  and t.ingestion_connection_id is not null
  and m.ingestion_connection_id is null;

alter table public.momo_messages
  drop constraint momo_messages_fingerprint_unique;

create unique index idx_momo_messages_connection_fingerprint_unique
  on public.momo_messages (ingestion_connection_id, message_fingerprint)
  where ingestion_connection_id is not null and message_fingerprint is not null;

create index idx_momo_messages_connection_received
  on public.momo_messages (ingestion_connection_id, server_received_at desc);

comment on column public.momo_messages.ingestion_connection_id is
  'The authenticated device/connector scope that supplied this SMS. NULL only for legacy evidence that predates ingestion connections.';

-- Raw evidence may originate from a connection (SMS/API), a financial source
-- (statement), or neither (future system/manual evidence). Preserve retry
-- idempotency inside that identity without allowing one customer to suppress
-- another customer's event with the same payload text.
alter table public.raw_financial_events
  drop constraint raw_financial_events_payload_hash_key;

create unique index idx_raw_events_connection_payload_unique
  on public.raw_financial_events (ingestion_connection_id, payload_hash)
  where ingestion_connection_id is not null;

create unique index idx_raw_events_source_payload_unique
  on public.raw_financial_events (financial_source_id, payload_hash)
  where ingestion_connection_id is null and financial_source_id is not null;

create unique index idx_raw_events_unscoped_payload_unique
  on public.raw_financial_events (channel, payload_hash)
  where ingestion_connection_id is null and financial_source_id is null;

-- Provider transaction references are account/workspace identifiers, not a
-- globally namespaced OneLedger identifier.
alter table public.transactions
  drop constraint transactions_external_id_unique;

alter table public.transactions
  add constraint transactions_workspace_external_id_unique
  unique (workspace_id, external_transaction_id);
