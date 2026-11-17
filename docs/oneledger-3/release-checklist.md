# OneLedger 3.0 — Release checklist (S1)

Per slice, all required before enabling a flag beyond the owner allowlist:
- [ ] Contracts frozen; schemas in repo; contract tests green; no `__mock` responses
- [ ] Migration rehearsed on branch DB with anonymised data; counts/sums parity recorded; rollback tested
- [ ] RLS two-tenant + revoked-member tests pass; new tables added to account erasure/export
- [ ] CI green (lint, typecheck, deno, e2e, a11y); skipped checks disclosed
- [ ] Parity test across API/web/PDF/email green
- [ ] Flag default off; allowlist rollout plan; monitoring/alert + runbook entry (`docs/operational-health.md`)
- [ ] Owner approval recorded before any prod migration/deploy (via `deploy-supabase.yml` and Vercel CLI per deploy topology)
Mobile store release additionally: real iOS + Android device test, approved production brand assets (do not redraw logo), Apple developer fee paid, Play SMS-permission policy review, privacy policy current.
Payments: Stage 1 only. Stage 2/3 blocked until provider terms, legal/regulatory review and security review are approved by owner.
Final report must separate implemented / verified / unverified.
