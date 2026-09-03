# Scheduled Financial Reporting: scheduler activation

This directory holds the pg_cron setup for the Daily Financial Report
engine's automatic generation/delivery ticks (Phase F). **Nothing here is
applied automatically.** It is deliberately kept out of
`supabase/migrations/` and is not run by CI or `deploy-supabase.yml`.

## Why this isn't a normal migration

`pg_cron` and `pg_net` require `shared_preload_libraries` set at Postgres
server startup - something only the Supabase platform itself can
configure for a project's actual database. The disposable Postgres this
repo's `supabase/migrations/tests/run_migration_tests.sh` spawns (and the
`postgres:17` service container CI uses) is a vanilla server with no such
preload, so `create extension pg_cron;` fails there. If this were a
tracked migration:

- `run_migration_tests.sh`'s full-chain test would break locally and in
  CI for everyone, not just for reporting work.
- `deploy-supabase.yml` pushes every migration unconditionally once CI is
  green on `main` - scheduling would activate in production the moment
  this branch merges, before the required manual Vault secret (below)
  could ever be set up first.

Keeping it as a standalone, manually-reviewed SQL file avoids both
problems and matches the master prompt's own requirement that scheduler
activation be a separate, deliberate, explicitly-approved production
step (not bundled into the schema/code merge).

## Rollout sequence

1. Everything in `web/app/api/cron/*` and `web/lib/report-generation.ts` /
   `report-delivery.ts` must already be deployed and working - verify by
   calling both routes manually with `REPORT_CRON_SECRET` first (see
   below).
2. Set `REPORT_CRON_SECRET` in Vercel's **production** environment
   variables (`openssl rand -hex 32` for the value).
3. In the Supabase SQL editor for the linked project, store the exact
   same value in Vault:
   ```sql
   select vault.create_secret(
     '<paste the exact REPORT_CRON_SECRET value here>',
     'report_cron_secret',
     'Shared secret for the report-generation/delivery cron routes'
   );
   ```
   Never commit the real secret value to any file, including this one.
4. Run `activate_report_scheduler.sql` once, in full, in the SQL editor.
   It already targets the confirmed production URL
   (`https://www.oneledger.me` - see `SITE_URL` in
   `web/.env.local.example` and `supabase/config.toml`'s own
   `site_url`); only change it there first if that domain ever changes.
5. Verify (see below).

## Manual verification before activating pg_cron

Call each route directly first, so a scheduling problem and a
generation/delivery problem are never debugged at the same time:

```bash
curl -X POST https://www.oneledger.me/api/cron/generate-reports \
  -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"

curl -X POST https://www.oneledger.me/api/cron/deliver-reports \
  -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"

# Device pairing v2 cleanup (ADR 0008): flips lapsed `pending` pairing
# sessions to `expired`. Redemption already refuses a stale token, so this
# is housekeeping. Idempotent; returns {"expired":<n>}.
curl -X POST https://www.oneledger.me/api/cron/expire-pairing-sessions \
  -H "x-report-cron-secret: <the REPORT_CRON_SECRET value>"
```

Both are safe to call at any time, any number of times - every candidate
is independently idempotent. With zero users opted into
`report_preferences.daily_report_enabled`/`email_enabled`, both currently
return `{"candidatesEvaluated":0,...}` and do nothing else.

## Verifying pg_cron after activation

```sql
select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 20;
```

## Rollback

Run `deactivate_report_scheduler.sql`. This unschedules both ticks
immediately without touching any report data - reports already
generated/delivered are unaffected, and no report generates automatically
again until `activate_report_scheduler.sql` is re-run. It does not drop
the `pg_cron`/`pg_net` extensions or the `call_report_cron_route()`
function, so reactivating later is just re-running the two
`cron.schedule(...)` calls.

## Operational notes

- Generation and delivery are two independent jobs/ticks, matching
  `report_runs`/`report_deliveries`' own separation - a delivery problem
  never blocks generation, and vice versa.
- Precision guarantee: due work is discovered within 5 minutes of a
  user's configured local generation/delivery time, not exact-minute
  (master prompt §12).
- `call_report_cron_route()` is `SECURITY DEFINER`, owned by `postgres`
  (this project's convention for application-owned objects -
  `supabase/migrations/README.md`), and has no privileges granted to
  `anon`/`authenticated` - only `cron.schedule`'s own job execution ever
  calls it.
