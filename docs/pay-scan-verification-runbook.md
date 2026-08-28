# Scan to pay: production rollout & device verification runbook

What to check, in what order, before turning `SCAN_TO_PAY_ENABLED` on for
real users. Companion to `docs/pay-and-services.md` ("Scan to pay,
Phases R1–R4") and ADR `docs/adr/0006-qr-scan-payload-trust.md`.

Non-custodial throughout: the scanner **prepares and opens** a payment
instruction. It never settles a payment, and "opening the dialer" is
never shown as a completed payment.

## 0. Before you start

- Branch merged; `pnpm`/`npm` build green; `deno test lib/` green.
- **`supabase/migrations/tests/run_migration_tests.sh` has been run on
  PostgreSQL 17** and passes. Two scan migrations were only
  smoke-applied on pg16 during development (see their headers):
  `20260910000000_phase_r3_scan_payment_source.sql` (the `source`
  column + `create_payment_intent` change) and
  `20260911000000_scan_merchant_pay_codes.sql` (the seeded MTN
  pay-merchant code).
- Generated DB/API types regenerated if your pipeline uses them (this
  repo hand-types its queries, so usually nothing to do).
- The app sets **no** `Content-Security-Policy` or `Permissions-Policy`
  headers today (`next.config.ts` is empty). The scanner needs neither:
  `BarcodeDetector` is native, the QR SVG is inline, no external hosts.
  If you add a CSP / Permissions-Policy later it must allow
  `camera=(self)` and must not block inline SVG.
- Camera only works in a **secure context** — production must be HTTPS
  (localhost is treated as secure for dev).

## 1. Feature flags

| Flag | Effect |
|---|---|
| `SCAN_TO_PAY_ENABLED=true` | shows the "Scan to pay" launcher entry. OFF (unset / anything ≠ `"true"`) = no entry point, no server actions. |
| `PAY_SERVICES_WORKSPACE_ALLOWLIST` | if set, only those workspace ids see it (staged beta). |
| `ASSISTED_PAY_ENABLED` | if `"false"`, the assisted *form* is hidden but a scan intent stays viewable / manageable (`isPaymentIntentSurfaceEnabled`). |
| `SMS_RECONCILIATION_ENABLED` / `_MODE` | governs whether a handed-off scan intent auto-reconciles (§6 below). |

Roll out in order: **(1)** the close-control redesign (always on, no
flag) → **(2)** `SCAN_TO_PAY_ENABLED` for internal / allowlisted
workspaces → **(3)** widen after the device matrix below passes.

## 2. Desktop smoke (Chrome + Safari, macOS / Windows)

1. Open the app → tap **Pay** → the sheet opens with the pinned bottom
   **Close** control (no header "Close"). `Esc`, overlay click, and the
   bottom control all close it; focus returns to the Pay button.
2. **Scan to pay** appears at the top of the sheet. Tap it.
3. Desktop with a webcam: the camera preview starts, status line reads
   "Camera is on…". Desktop without a webcam / permission denied: the
   matching error state with recovery guidance (never "app broke").
4. **Upload a QR image** works where `BarcodeDetector` is present
   (Chrome; Safari 17+). Where it is absent (Firefox, older Safari) the
   scanner is **preview-only** and says "This browser can't read QR
   codes…" — verify that copy, and that Upload is hidden.
5. Scan / upload a **plain URL** → "isn't from a payment provider
   OneLedger has approved". A `javascript:` QR → "tries to open
   something that isn't a payment". Neither ever navigates.

## 3. Mobile device matrix (the real test)

Run each row. A camera that works in Chrome desktop is **not** evidence
for iOS Safari.

| Device / context | Expect |
|---|---|
| Safari, iPhone | rear camera opens after the permission prompt; live decode |
| Installed iOS PWA (if supported) | same; camera survives app switch (stream released on background, resumes on return) |
| Chrome, Android | rear camera; torch button present where the device exposes it |
| Installed Android PWA | same |
| Small screen (SE-class) | no horizontal overflow; footer Close clears the home indicator |
| Landscape | viewfinder + controls usable; no clipping |
| Tablet | layout sane at width |
| Camera **denied** in OS settings | the denied state; "How to enable camera access" guidance; Upload still offered |
| **No camera** | the no-camera state; other payment options still reachable |
| Low light | scanning still resolves within a few seconds, or the user can retry |
| Throttled CPU / old device | detect loop doesn't lock the UI; sheet opens/closes smoothly |
| Slow / interrupted network | classify + prepare show a clear "check your connection" path; nothing half-persisted |
| Browser zoom + large text | review screen readable; controls ≥ 44px; no overlap |

## 4. Telephony hand-off on a physical device (cannot be emulated)

1. Scan a **complete verified USSD** — e.g. build one from the seeded
   `mtn-momo-send` template: `*182*1*1*250781234567*5000#` (encode as a
   QR).
2. Review screen shows: provider, masked recipient (`•••• ••• 4567`),
   amount `RWF 5,000` (read-only), the dial string, and the
   "not officially verified" warning (seed data is unverified).
3. Tap **Prepare payment** → **Open USSD**.
   - iOS: the OS shows its **own** confirm dialog before dialing —
     expected, do not try to bypass it.
   - Android: the dialer opens pre-filled with the exact string.
4. Do **not** complete the payment. Return to the app → state is
   **"Awaiting confirmation"**, never "paid" / "sent".
5. **View in payment activity** → `/pay/[id]` shows the intent with the
   **"From a scan"** badge, state "Awaiting verification".
6. Desktop / no-telephony: instead of Open USSD you get **Copy code** +
   a **QR for your phone**; verify the QR encodes the same `tel:` string.
7. **OneLedger merchant payment (RWF).** Encode
   `{"v":1,"type":"merchant_payment","provider":"mtn_momo","merchant_id":"123456","currency":"RWF"}`
   (no amount). Review shows the merchant (masked), "OneLedger can't
   confirm this merchant's identity", and an **amount field**. Enter
   `5000` → Prepare → Open USSD → the dialer opens
   `*182*8*1*123456*5000#` (the seeded *unverified* pay-merchant code —
   the "Not officially verified" warning is shown). A `"currency":"USD"`
   payload → "only continue a scanned payment in RWF". A
   `"provider":"equity"` payload → "no verified USSD path for this
   provider yet". A `"merchant_id":"KGL-COFFEE"` → same (non-numeric).

## 5. Payload safety spot-checks

Encode each as a QR and scan it. None may ever open or persist anything.

| Payload | Expect |
|---|---|
| `*999*1#` (not in the directory) | "isn't in OneLedger's verified directory" |
| `{"v":1,"type":"merchant_payment","provider":"x","merchant_id":"y","currency":"RWF","expires_at":"2020-01-01T00:00:00Z"}` | "that payment request has expired" |
| A well-formed EMV string (`000201…6304<crc>`) | "doesn't support this merchant QR format yet" |
| Same EMV with one byte flipped | "malformed or was tampered with" |
| `https://user:pw@pay.example/x` | blocked (embedded credentials) |
| Two QR codes in frame | "move closer to a single code" — never picks one |

## 6. Reconciliation (only with `SMS_RECONCILIATION_ENABLED=true`)

1. Hand off a scanned **send-money** USSD (step 4) so an
   `awaiting_verification` `qr_scan` intent exists.
2. Ingest the matching Mobile Money SMS (real or a test fixture): same
   amount, same recipient number, within the window.
3. `MODE=apply`: `/pay/[id]` flips to **Verified**, linked to the
   transaction, "From a scan" badge intact. `MODE=observe`: it appears
   on `/pay/reconciliation` as a candidate to apply.
4. The retry cron (`POST /api/cron/reconcile-pending-payments`) does the
   same for an intent whose SMS arrived late — and emits a
   `scan_attempt_reconciled` analytics event (dev: `console.debug`).
5. A scanned **merchant / bill** code (no recipient number) stays
   awaiting-confirmation — expected, same as assisted `pay_merchant`.
6. **Manual confirmation**: on `/pay/[id]`, "I've confirmed this with my
   provider" → state "Manually confirmed" (NOT "Verified"), auditable,
   `verified_at` still null.

## 7. Expiry

1. Leave a `qr_scan` intent in `awaiting_verification` past
   `PAYMENT_INTENT_TTL_HOURS` (default 24; the UI also lazy-expires).
2. `POST /api/cron/expire-payment-intents` → the intent is `expired`;
   its `payment_events` trail (`created` / `initiated` /
   `awaiting_verification` / `expired`) is intact — nothing deleted. The
   route emits `scan_attempt_expired` with a count.

## 8. Tenant isolation & authorization

- User B cannot open User A's `/pay/[id]` (RLS + membership check in
  every RPC). Confirm a 404 / not-authorized, not a leak.
- `POST` to either cron route without the shared-secret header → 401.
- With `SCAN_TO_PAY_ENABLED` unset: the launcher entry is gone **and**
  `classifyScannedCode` / `prepareScanHandoff` / `recordScanHandoff`
  return `feature_disabled` / `false`.

## 9. Analytics / monitoring / audit

- **Analytics**: no provider is wired; events are `console.debug`
  `[scan-event] …` in non-prod. Confirm no event payload ever contains a
  QR string, a filled USSD, a phone number, an amount, or a URL
  (`sanitizeScanEventProps` + `redactErrorText`, unit-tested).
- **Monitoring**: server failures log `[scan-error] stage=<stage> …`
  (`logScanError`) and `reconcile-pending-payments:` /
  `expire-payment-intents:` from the crons. When a log-based alert sink
  is added, alert on: a spike in `[scan-error]`, elevated
  `scan_payload_rejected` rate, `scan_handoff_unavailable`, cron
  non-200s.
- **Audit**: scan intents reuse the Phase N `payment_events` /
  `payment_audit_events` writers. `payment_intents.source = 'qr_scan'`
  plus `{ method, source: 'qr_scan' }` in the `initiated` event's
  `evidence` distinguish scan flows; manual confirm writes a
  `manual_confirm` event.

## 10. User-facing help

There is no separate help system. The honest in-product copy in
`web/lib/ussd/messages.ts` (`pay.scan.*`) is the help surface, and
covers: how to point the camera; why a review step exists
(`handoffNotice`); why the OS / provider may ask again (`awaitingBody`);
why opening the dialer ≠ confirmed (`awaitingBody`); how OneLedger
confirms via ingestion (§6); how to enable the camera
(`permissionHelp` / `permissionHelpBody`); how to use image upload
(`uploadImage`); what an unsupported / expired code means
(`result.reasons.*`). Keep any future help content consistent with it.

## 11. Rollback

Set `SCAN_TO_PAY_ENABLED` to anything other than `"true"` (or remove the
workspace from the allowlist). The entry point disappears and every scan
server action refuses. The `payment_intents.source` column and the
`create_payment_intent` `source` key are inert without it (existing
callers default to `'assisted'`), so no migration rollback is needed for
a feature-flag disable. Only revert the migration if you are rolling the
whole schema back.

## Completion checklist (master prompt §22)

- [ ] Top-right "Close" removed; header balanced; bottom-centred X +
      "Close" present and reachable without scrolling; safe-area
      respected.
- [ ] All dismissal methods behave consistently; focus + history correct.
- [ ] "Scan to pay" is a prominent entry.
- [ ] Camera permission requested only on explicit intent; every
      permission / device state handled; stream always released.
- [ ] Decode + upload both have full success + failure states.
- [ ] Decoded content passes classify → validate → resolve → allowlist;
      unsupported / suspicious payloads cannot execute.
- [ ] Supported payments always show a review; external hand-off needs an
      explicit tap; a hand-off is never treated as completion.
- [ ] USSD / provider launching respects OS restrictions.
- [ ] Payment attempts appear in payment activity ("From a scan").
- [ ] Confirmation requires reliable evidence or is labelled
      "Manually confirmed".
- [ ] Auth / ownership / tenant boundaries enforced server-side.
- [ ] No sensitive payment data in analytics or unsafe logs.
- [ ] Existing Pay & Services capabilities still work.
- [ ] Automated + manual tests pass; lint / types / build / migrations
      pass; a11y + responsive checks pass.
- [ ] Docs + help copy updated; rollout + rollback documented.

## If something fails

- **Camera never starts on one device only** — almost always a
  browser-level permission / secure-context issue, not the app. Check
  Settings → Safari/Chrome → Camera, and that the origin is HTTPS.
- **`prepareScanHandoff` returns `unsupported` for a code you expect to
  work** — the dial string didn't match a *published, in-window*
  directory template exactly, or its captured amount was ≤ 0. Check the
  seed / directory admin.
- **Reconciliation never links** — confirm the ingested transaction is
  `direction='out' status='success' currency='RWF'`, `source='mtn_momo'`
  for an `mtn`/`airtel` intent, the amount matches exactly, and
  `normalize_rw_msisdn(counterparty_reference)` equals the intent's
  `recipient_msisdn_normalized`.
- **`[scan-error]` spike after deploy** — check the stage tag; `parse` /
  `classify` point at a payload the pipeline mishandles (add a fixture),
  `prepare_handoff` / `record_handoff` at an RPC / RLS problem.
