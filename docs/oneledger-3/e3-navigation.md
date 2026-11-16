# E3 — "Payment requests" in the main navigation (2026-11-16)

**Delivered:** a *Payment requests* entry in the **More → Pay & Services** group (`/pay/requests`), shown only when `PAYMENT_REQUESTS_ENABLED=true` (and the active workspace is in `PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST` if one is set) **and** the experience mode grants the `pay` surface. Plumbed as a new `paymentRequestsEnabled` flag: `app/layout.tsx` → `AppShell` → `MoreSheet` (new `requests` icon key → QR glyph, new `requires: "paymentRequests"` gate). Independent of the outbound Pay & Services flags (`PAY_SERVICES_ENABLED` etc.): turning those off does not hide it, and turning it on does not enable them.

**Verified:** `deno test web/lib` (incl. a new navigation test), full `tsc`, `eslint`, and `next build` all pass.
**Not verified:** the entry was **not seen rendered** — the More sheet only appears for a signed-in user and there is no Supabase here; visibility logic is a one-line filter mirroring the existing `assistedPay` gate. Check it by hand with the flag on and off (and with an allowlist that excludes the workspace).
**Notes:** the page and its actions still re-check the flag server-side, so the menu entry is a convenience, not the gate. No entry on the phone bottom bar or desktop header (only in More), matching the other Pay items.
