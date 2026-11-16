# E6c — Mobile: Payment requests (2026-11-16)

**Delivered (Expo app, More → Payment requests):**
- **List** (`/requests`): your requests with amount, status badge and date.
- **New request** (`/request-new`): amount + currency, Mobile Money number or merchant code, the name the payer will see, optional reference, validity (1/3/7/30/90 days). Early, friendly validation (same rules as the server); the server and database re-validate. Creates via `POST /api/mobile/payment-requests` so only the server generates the secret link token. The link is shown **once** with a **Share link** button and a **QR code** (the phone's share sheet — WhatsApp, SMS, copy); an idempotent replay says the link can't be shown again. A double tap or retry creates one request (one idempotency key per opened form).
- **Request** (`/request/[id]`): details; **Link the payment you received** (only settled incoming payments of exactly this amount that no other request has claimed); **Mark as paid yourself** (confirm-twice, worded as your own unverified statement); **Cancel**. Changes go through the audited database functions under RLS.
- Safety in the client too: only an `https://…/r/<64 hex>` link is ever offered for sharing (a malformed or look-alike URL from the server is refused); the share text claims nothing about verification or payment; error text is mapped to fixed sentences.
- `bearerPost` added to the API client.

**Verified:** `typecheck`, `expo lint`, `jest` (**190 pass**, 14 new: input validation, amount/number parsing, request body shape, share-link safety, response and row parsing incl. >2^53), `expo export --platform web`.
**NOT verified:** **no screen was run** (no device/emulator/browser session against a flag-enabled web API); the Share sheet, keyboard types, text scaling, dark mode and screen-reader order are untested; the POST has only been exercised against the stubbed server in #211, not from the app. The database behaviour is covered by the migration tests (#199).

## QR code (added after approval)
`uqr@0.1.3` (MIT, pure JavaScript, zero dependencies, no native code, so no new native build) was approved and added; `QrCode` draws the link as dark-on-white squares with a 4-module quiet zone, announced to screen readers as an image (the link text is shown next to it). Verified: unit test of the grid, and an independent check that the grid rendered as an image **decodes back to the exact link with `jsQR`**. Not verified: scanning it from a real phone camera.

**Other gaps:** no pull-to-refresh (re-loads on focus); the list isn't paged beyond 100; USD/EUR requests can be created but can't be matched to a payment (transactions are RWF-only); the link can't be copied from the detail screen (it isn't stored anywhere by design).
