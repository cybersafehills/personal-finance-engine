# E6c — Mobile: Payment requests (2026-11-16)

**Delivered (Expo app, More → Payment requests):**
- **List** (`/requests`): your requests with amount, status badge and date.
- **New request** (`/request-new`): amount + currency, Mobile Money number or merchant code, the name the payer will see, optional reference, validity (1/3/7/30/90 days). Early, friendly validation (same rules as the server); the server and database re-validate. Creates via `POST /api/mobile/payment-requests` so only the server generates the secret link token. The link is shown **once** with a **Share link** button (the phone's share sheet — WhatsApp, SMS, copy); an idempotent replay says the link can't be shown again. A double tap or retry creates one request (one idempotency key per opened form).
- **Request** (`/request/[id]`): details; **Link the payment you received** (only settled incoming payments of exactly this amount that no other request has claimed); **Mark as paid yourself** (confirm-twice, worded as your own unverified statement); **Cancel**. Changes go through the audited database functions under RLS.
- Safety in the client too: only an `https://…/r/<64 hex>` link is ever offered for sharing (a malformed or look-alike URL from the server is refused); the share text claims nothing about verification or payment; error text is mapped to fixed sentences.
- `bearerPost` added to the API client.

**Verified:** `typecheck`, `expo lint`, `jest` (**190 pass**, 14 new: input validation, amount/number parsing, request body shape, share-link safety, response and row parsing incl. >2^53), `expo export --platform web`.
**NOT verified:** **no screen was run** (no device/emulator/browser session against a flag-enabled web API); the Share sheet, keyboard types, text scaling, dark mode and screen-reader order are untested; the POST has only been exercised against the stubbed server in #211, not from the app. The database behaviour is covered by the migration tests (#199).

## ⚠️ One item needs your approval: QR code
The web owner screen shows a QR code of the link; **the app does not yet**. Rendering a QR in the app needs a QR library, and adding a dependency to the app was blocked in this session. The web uses `uqr` (MIT, pure JavaScript, zero dependencies, no native code, so no new build is needed). To add it: `cd oneledger-mobile && npm install uqr@0.1.3 --save-exact`, then render `encode(url, { border: 0 }).data` as a grid of squares in a small `QrCode` component with an accessibility label. Until then, sharing works through the share sheet.

**Other gaps:** no pull-to-refresh (re-loads on focus); the list isn't paged beyond 100; USD/EUR requests can be created but can't be matched to a payment (transactions are RWF-only); the link can't be copied from the detail screen (it isn't stored anywhere by design).
