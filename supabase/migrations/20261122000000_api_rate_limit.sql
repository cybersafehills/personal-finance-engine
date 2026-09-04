-- Integrations Phase 4, P4-PR2: a fixed-window rate limiter for the
-- developer API.
--
-- api_rate_take() is called once per /api/v1 request with the caller's
-- api_key_id. It buckets by a floored window start, atomically increments,
-- and returns whether the request is within the per-key limit plus the
-- standard RateLimit-* header values. Service-role only - the developer
-- API's request path is the sole caller.

create table public.api_rate_buckets (
  api_key_id uuid not null references public.api_keys (id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (api_key_id, window_start)
);

comment on table public.api_rate_buckets is
  'Fixed-window request counters for the developer API, one row per (api_key_id, window_start). Written only by api_rate_take(); old windows are GC''d opportunistically. Service-role only.';

alter table public.api_rate_buckets enable row level security;
revoke all on public.api_rate_buckets from anon, authenticated;
grant select, insert, update, delete on public.api_rate_buckets to service_role;

create or replace function public.api_rate_take(
  p_key_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
  v_limit integer := greatest(1, coalesce(p_limit, 120));
  v_window integer := greatest(1, coalesce(p_window_seconds, 60));
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window) * v_window
  );

  insert into public.api_rate_buckets (api_key_id, window_start, request_count)
  values (p_key_id, v_window_start, 1)
  on conflict (api_key_id, window_start)
  do update set request_count = public.api_rate_buckets.request_count + 1
  returning request_count into v_count;

  -- Opportunistic GC: drop this key's windows older than an hour.
  delete from public.api_rate_buckets
  where api_key_id = p_key_id
    and window_start < v_window_start - interval '1 hour';

  return jsonb_build_object(
    'allowed', v_count <= v_limit,
    'limit', v_limit,
    'remaining', greatest(0, v_limit - v_count),
    'reset_at', to_char(
      v_window_start + make_interval(secs => v_window),
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  );
end;
$$;

comment on function public.api_rate_take(uuid, integer, integer) is
  'Fixed-window rate check for one developer API key. Increments the current window and returns { allowed, limit, remaining, reset_at }. Service-role only.';

revoke all on function public.api_rate_take(uuid, integer, integer) from public;
grant execute on function public.api_rate_take(uuid, integer, integer) to service_role;
