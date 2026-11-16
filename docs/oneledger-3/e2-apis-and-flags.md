# E2 — Mobile APIs and feature flags (2026-11-16)

**Delivered (all dark):** `GET /api/mobile/insights/overview`, `/insights/drilldown`, `/accounts`, `/counterparties`, `/counterparties/{id}`, `POST /api/mobile/payment-requests`; one flag helper (`lib/oneledger3-flags.ts`: `INSIGHTS_CENTER`, `BALANCE_PROVENANCE`, `COUNTERPARTIES`, `PAYMENT_REQUESTS`, each `*_ENABLED` opt-in + `*_WORKSPACE_ALLOWLIST`); shared create core for payment requests (web action and mobile route now use one path); `MobileApiError` + `mobilePost` in the mobile guard; contract documented in `docs/mobile-api.md`; env variables listed in `web/.env.local.example`.

**Brought into this stack (not new work):** the Insights core (`web/lib/insights`) and `transfer-exclusion.ts` from #195, because the S3→S5 stack branched from `main` and doesn't contain them. They are byte-identical to #195's, so merging both is clean.

## Verified
- `deno test web/lib`: **880 passed**; full `tsc` and `eslint` clean.
- Dev server with the Supabase **auth + REST stubbed** (canned rows; filters are NOT evaluated by the stub): 401 without a token; overview numbers match hand calculation (money out 60,600 = 10,100 + 50,500; own-account transfer pair excluded; pending excluded; cash-out and "consumption" split; previous-period comparison; weekly trend); drill-down returns exactly the rows behind cash-out and transfers; account balance derived as *estimated* (80,000 − 1,100 = 78,900); counterparties grouped with net per currency; bad ranges/ids/bodies give 400/404; payment request created once with a `https://…/r/<64-hex>` link while the stub saw only a 64-char digest; invalid destination → 422 with a safe message.
- With flags unset or the workspace not in an allowlist, **every** new endpoint returns `404 not_found`; an unknown `workspace_id` is also `404`.

## NOT verified
- **No real Supabase:** the queries/filters/RLS behind these routes (the stub ignores filters) and the PostgREST column types were not exercised. The SQL objects they read are covered by the migration tests (#196/#198/#199/#209), but the route→query wiring is only type-checked and stub-tested. **Run each endpoint once against a Supabase branch with the flags on.**
- MFA step-up (`aal2`) path, CORS, production build, CI, Playwright, performance at 20k rows.

## Limitations / decisions
- Counterparties list is **all-time**; the period filter in the contract isn't implemented (the view has no date dimension). Insights' own `top_counterparties` are period-scoped.
- Insights groups counterparties by `counterparty_id` when present else lower-cased name, so *pre-backfill* history groups by name (low confidence).
- `merged_into:<id>` is returned inside the `error` string for a 409 (kept simple; consider a structured field).
- Mobile payment-request creation re-uses the web rules and one-time link semantics; there is no endpoint to re-show a link (by design).
- Per-IP limiter is per instance (as for the existing mobile endpoints).
