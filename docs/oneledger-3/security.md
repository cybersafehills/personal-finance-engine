# OneLedger 3.0 — Security & privacy review (S1, pre-implementation)

## Threats and controls
| Threat | Control |
|---|---|
| Cross-tenant/household read | RLS on every new table via `is_workspace_member`; capability checks for sensitive reads; two-tenant tests per table in migration suite; aggregate endpoints take scope server-side from membership, never trust client scope |
| Revoked member keeps access | Authz evaluated per request (no cached role in token); test: revoke → 403 immediately |
| Counterparty over-merge leaks identity | merges workspace-only; same-name never auto-merge; merge/undo audited; confidence label shown |
| Payment-link enumeration / phishing | 128-bit random token, only SHA-256 stored, constant-time compare, per-IP rate limit, expiry + revoke, public view minimal; QR encodes only the validated `https://<own-origin>/r/<token>`; no open redirects; clear "unverified, check recipient" banner |
| False "paid" status | state machine forbids paid transitions from public endpoints; only owner-marked or human-confirmed transaction match |
| Sensitive tokens (Cash Power) | stored encrypted (pgsodium/Vault or app-level AEAD — decision needed), redacted by default, capability-gated, excluded from logs (`_shared/log.ts` redacts "token") and from exports unless explicit |
| Raw SMS exposure | existing raw-event store not returned by default APIs; new APIs never select raw payload |
| Mobile token theft | secure storage, existing lock/MFA; deep links validated against allowlist of routes/hosts |
| Replay / retries | Idempotency-Key on POSTs (reconcile, request create, merge) |
| Over-broad queries | max range (e.g. 400 days), limit ≤100, allowed filter keys whitelist |
| Notification email/push abuse | existing cron-secret auth (verified S0) |

## Privacy
- Minimise: counterparty stores masked identifier for display and normalised value for matching (hash if feasible — decision for owner; hashing blocks display-search by number).
- Retention/deletion: new tables must be covered by `account_deletion` flow (`20261203000000_account_erasure.sql`) — **add each new table to erasure + `account-data.ts` export in the same PR**.
- Consent/regulatory: Rwanda data-protection and any payment-regulatory posture need qualified counsel review before expanding data collection or Stage 2/3. No compliance claims are made here.
- Tests/screenshots use synthetic data only.

## Open decisions (owner)
1. Token encryption mechanism. 2. Identifier hashing vs masked-plaintext. 3. Stale threshold value. 4. Whether `view_sensitive_tokens` is a new capability or reuses an existing one.
