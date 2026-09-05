-- Reporting follow-up: per-user alert thresholds.
--
-- Until now the six deterministic report alerts (large_transaction,
-- high_daily_spend, elevated_fees, low_balance,
-- sustained_negative_cashflow, excessive_uncategorized) fired against
-- fixed module-level constants in web/lib/report-generation.ts
-- (DEFAULT_ALERT_THRESHOLDS). docs/reporting-engine.md's "Known
-- limitations" called out that making them a stored per-user preference
-- would be "an additive follow-up migration" - this is that migration.
--
-- Purely additive, backward-compatible:
--   * Every column has a default equal to the current DEFAULT_ALERT_
--     THRESHOLDS value, so existing report_preferences rows keep exactly
--     today's behavior with no backfill.
--   * No RLS change: report_preferences' existing row-level
--     select/insert/update-own policies already cover new columns; only
--     the row owner (and service_role) can read or write them.
--
-- Semantics:
--   * alert_low_balance_rwf is NULLABLE - null means "no low-balance
--     check" (matches ReportAlertThresholds.lowBalanceRwf: number | null
--     in web/lib/report-math.ts). Default 10000 keeps the check on.
--   * The other five are NOT NULL - the alert cannot be disabled, only
--     retuned. Set a very high number to effectively silence it.

alter table public.report_preferences
  add column alert_large_transaction_rwf integer not null default 100000,
  add column alert_high_daily_spend_rwf integer not null default 200000,
  add column alert_elevated_fees_rwf integer not null default 5000,
  add column alert_low_balance_rwf integer default 10000,
  add column alert_sustained_negative_cashflow_days integer not null default 3,
  add column alert_uncategorized_percent integer not null default 50;

alter table public.report_preferences
  add constraint report_preferences_alert_thresholds_valid check (
    alert_large_transaction_rwf > 0
    and alert_high_daily_spend_rwf > 0
    and alert_elevated_fees_rwf > 0
    and (alert_low_balance_rwf is null or alert_low_balance_rwf >= 0)
    and alert_sustained_negative_cashflow_days between 1 and 30
    and alert_uncategorized_percent between 1 and 100
  );

comment on column public.report_preferences.alert_low_balance_rwf is
  'Closing-balance threshold for the low_balance alert. NULL disables the check entirely (ReportAlertThresholds.lowBalanceRwf = null). Other alert_* columns are NOT NULL - retune, do not disable.';
