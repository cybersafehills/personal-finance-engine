-- Onboarding work PR7 (email deliverability follow-up): a lightweight
-- audit trail of transactional-email attempts, so a failed invite /
-- confirmation is inspectable after the fact - not just a log line that
-- may have rolled off.
--
-- Deliberately minimal and privacy-preserving:
--   * recipient_domain only, never the full address
--   * no subject, no body, no PII
--   * written by lib/email-log.ts with the service-role client and read
--     only by the operator route GET /api/admin/email-log (also
--     service-role, cron-secret gated) - there is NO authenticated/anon
--     access. It is an ops surface, not a user-facing one.

create table public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 'sent' = provider accepted it; 'skipped' = provider not configured;
  -- 'failed' = provider rejected / errored.
  outcome text not null check (outcome in ('sent', 'skipped', 'failed')),
  -- 'invite' | 'sign_in' | 'lockout' | 'daily_report' | 'other'
  category text not null,
  recipient_domain text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  provider_message_id text,
  error_code text
);

comment on table public.email_send_log is
  'Ops audit of transactional-email attempts (lib/emails.ts). Recipient DOMAIN only, no address/subject/body. service_role-only: written by lib/email-log.ts, read by GET /api/admin/email-log. Never user-facing.';

create index idx_email_send_log_created
  on public.email_send_log (created_at desc);
create index idx_email_send_log_outcome_created
  on public.email_send_log (outcome, created_at desc);

alter table public.email_send_log enable row level security;

-- No policies for authenticated/anon at all - RLS on + zero policies =
-- those roles see nothing. service_role bypasses RLS.
revoke all on public.email_send_log from anon, authenticated;
grant select, insert on public.email_send_log to service_role;
