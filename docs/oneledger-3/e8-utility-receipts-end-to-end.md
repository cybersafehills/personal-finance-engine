# E8 — Cash Power receipts, end to end (2026-11-16)

**Delivered:** the capture backend and Android matcher recognise vendor receipts; the processor records them as `utility_receipts` (token encrypted, meter last-4 only); the database links them to the MoMo payment (now or later, ambiguity left to the user); web and mobile show the kWh and reveal the token on request (audited, rate-limited, MFA); a web review page for receipts that need a decision; and a service-role scrub for tokens ingested before the fix. Design and rules: **ADR 0020**.

## Verified
- **Real database, real code, together:** `supabase/migrations/tests/e2e_utility_receipts.ts` (run by the migration harness) drives the real processor (parse → encrypt → store), the real linking including the trigger, and the real reveal path (authorised RPC → decrypt with the id-bound key) against a PostgreSQL 17 with every migration applied: English and Kinyarwanda receipts, payment-first and receipt-first, re-delivery, no plaintext token anywhere in the table, only the last 4 meter digits, owner name never stored, the same ciphertext failing under another row's binding, audit rows, a stranger refused, capture-off keeps the receipt without a token. **22 checks, all pass.**
- **Migration harness: 730 passed, 0 failed** (25 receipt assertions + 4 scrub assertions + the e2e).
- Edge tests (117) incl. provider detection cases for both formats (receipt routed before MTN; OTP / token-without-kWh rejected), processor tests, `deno check/lint/fmt`.
- Web: `deno test` 894, `tsc`, `eslint`, `next build`. Mobile: `typecheck`, `expo lint`, `jest` 197, web export.

## Not verified (and why)
- **No HTTP hop:** the capture endpoint, PostgREST and Supabase Auth could not be run — Docker Desktop's engine would not start on this machine, and downloading a PostgREST/Supabase binary was out of bounds without approval. The Edge handlers are covered by unit tests with injected dependencies and by the real-DB script above; the wiring between them (`process-raw-events/index.ts` calling the RPC) is type-checked only.
- **Kotlin port:** no Android toolchain here; the Kotlin matcher mirrors the TypeScript regexes exactly and shares `provider-cases.json`, but `ProviderCasesTest` was not run.
- **Screens:** the web transaction panel and receipts review page and the mobile receipt card were type-checked/linted/built, not rendered.
- **Real SMS:** only the two wordings supplied are handled, tested with synthetic values in the same layout.

## What you do to turn it on (when ready)
1. `supabase db push` (migrations `…228`, `…229`, `…230`) — to the test project first.
2. Supabase secrets **and** Vercel env: `UTILITY_TOKEN_CAPTURE_ENABLED=true`, `SENSITIVE_DATA_KEYRING=k1:<openssl rand -base64 32>` (back the key up outside the database).
3. Deploy `process-raw-events`; update the mobile app for the new Android matcher.
4. Optionally `select public.scrub_utility_tokens(true);` (dry run) then `(false)` to clean old rows.
