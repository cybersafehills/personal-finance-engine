# E5 — Prepaid-electricity ("Cash Power") token protection (2026-11-16)

## ⚠️ Read first: format assumption
**No real Cash Power SMS was available.** The token shape the parser looks for — a number of 16–24 digits (optionally grouped by `-` or spaces) introduced by the word "token", and an optional `<n> kWh` — comes from the repo's own airtime comment ("…with token …") and general knowledge, and is tested **only with synthetic messages** (`supabase/functions/ingest-momo/tests/utility_token_test.ts`). Extraction is strict (it returns nothing rather than guess), but **it must be validated against real, anonymised messages before you rely on it**. Please send a few.

## The problem this fixes (real, independent of the feature)
The existing merchant-payment pattern takes everything between "to" and "was completed at" as the merchant label. For a message with a token, that label **contained the token** and from there flowed into `transactions.counterparty_name`, `metadata.original_counterparty_name`, merchant-rule matching, lists, statements and emails; a bare 20-digit token would also have been taken as `counterparty_reference`. The parser now strips any "with token …" tail **before** the reference is derived, so a token can no longer reach a display field — even if its shape isn't recognised (redaction is deliberately broader than extraction). Ordinary merchant payments are byte-identical (tested). Parser version → `momo-parser-v1.2`.
**Not fixed (needs your decision):** the raw SMS (`momo_messages.raw_message`, raw events) still contains the token in plaintext as evidence. Those tables are service-role-only and not returned by any API, but "minimise sensitive data retention" would argue for masking the token in stored raw text. That changes evidence storage and reprocessing, so I did not do it. Also: tokens that were already ingested before this change remain in historical `counterparty_name` values — a one-off clean-up migration is needed once real formats are confirmed.

## What was built (all dark)
- **Extraction / redaction:** `ingest-momo/utility-token.ts`, parser wiring, `sensitive?` field on the parse result (never copied to metadata). Non-sensitive facts only go to `metadata`: `utility_token_present`, `kwh`.
- **Encryption:** `_shared/sensitive-crypto.ts` (+ identical copy `web/lib/sensitive-crypto.ts`, enforced by a CI diff step): AES-256-GCM, fresh nonce per value, the ciphertext bound to `"<transaction_id>:utility_token"` (a copied ciphertext won't open), rotatable keyring (`SENSITIVE_DATA_KEYRING="k2:…,k1:…"`, first key encrypts, all decrypt), generic `decrypt_failed` errors.
- **Storage:** `transaction_sensitive_details` (migration `20261229000000`): ciphertext only, **no grant and no policy for any client role**; service-role write by the ingest function (`sensitive-store.ts`, best-effort, never logs the value, never stores plaintext — with no key or capture switched off the token is simply not kept). Removed with its transaction / on account erasure (tested).
- **Reveal:** `reveal_transaction_sensitive_detail()` — member+ **and** visibility of the transaction's source, 20/hour/user, one audit row per reveal (no value, no ciphertext), identical error for not-found / not-yours / no value; returns only the sealed value. The web server decrypts with its own key. **Web:** a "Show token" panel on the transaction page (step-up MFA, shows for 30 s, held only in component state). **Mobile:** `POST /api/mobile/transactions/{id}/reveal-token` (documented in `docs/mobile-api.md`).
- **Switches:** `UTILITY_TOKEN_CAPTURE_ENABLED=true` on the Supabase Edge secrets (capture) and the web env (viewing), plus the same `SENSITIVE_DATA_KEYRING` on both; see `web/.env.local.example`.

## Verified
- Edge Function tests: **100 pass** (incl. 6 parser + 3 storage tests); `deno check`/`lint`/`fmt --check` clean; `deno test web/lib`: **886+ pass** (crypto: round trip, tamper, wrong key, AAD binding, rotation, malformed keyring).
- Migration harness on disposable PostgreSQL 17: **679 passed, 0 failed** (12 E5 assertions: no client privileges; sealed reveal; audit without value; generic denial for other tenant / viewer / no value / unknown id; household member allowed through source visibility; 20/hour limit; kind constraint; erasure).
- Web `tsc` + `eslint` clean.

## NOT verified
- **Real messages** (see top). **The Edge Function end to end** (insert path was unit-tested with a fake client; no Supabase here). **The web page/button and the mobile route were not exercised** (no Supabase/auth locally; type-checked only). Key generation/rotation procedure untested in deployment. No third-party review of the crypto usage.

## Rollout (when you choose)
1. Send real anonymised Cash Power SMS → add as fixtures → adjust extraction if needed.
2. Generate a key (`openssl rand -base64 32`), set `SENSITIVE_DATA_KEYRING` on Supabase secrets **and** Vercel; set `UTILITY_TOKEN_CAPTURE_ENABLED=true` on both.
3. Decide on masking the raw SMS and on a clean-up of historical labels.
4. Back up the key outside the database: **losing it makes every stored token unrecoverable.**
