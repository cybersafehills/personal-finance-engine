-- Rollback for activate_report_scheduler.sql. Safe to run at any time -
-- unschedules both ticks without touching any report_runs/
-- report_preferences/report_deliveries data. Reports already generated
-- or delivered are unaffected; no report is ever generated automatically
-- again until activate_report_scheduler.sql is re-run.
--
-- Does not drop the pg_cron/pg_net extensions or the
-- call_report_cron_route() function - those are inert once no job calls
-- them, and leaving them in place makes reactivation a single re-run of
-- the `cron.schedule(...)` calls rather than the whole setup again.

select cron.unschedule('report-generation-tick');
select cron.unschedule('report-delivery-tick');
