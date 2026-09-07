-- Scheduled Statements - optional email delivery (master prompt section
-- 30). A schedule may carry a delivery_email; the statement-jobs worker,
-- after a scheduled stub flips to 'ready', emails a LINK (never the
-- document or any figure - section 26) and stamps notified_at so it is
-- sent once. Additive columns; no new table, no new grant.

alter table public.statement_schedules
  add column delivery_email text
    check (
      delivery_email is null
      or delivery_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    );

comment on column public.statement_schedules.delivery_email is
  'Optional. When set, a "your scheduled statement is ready" email with a link (no financial detail) is sent once the generated statement is ready.';

alter table public.statements
  add column notify_email text,
  add column notified_at timestamptz;

comment on column public.statements.notify_email is
  'Set by the schedule tick on a stub whose statement_schedules row has a delivery_email. The statement-jobs worker emails a link on ''ready'' and sets notified_at. NULL for interactively-created statements.';
