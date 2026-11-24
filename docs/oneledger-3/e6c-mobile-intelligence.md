# E6c — Mobile: forecasts and insights (2026-11-23)

Brings the web's Intelligence surfaces (Home "Insights" card, `/inbox/forecast`) to the Expo app.

**Server:** `GET /api/mobile/insights/intelligence` (`web/lib/intelligence/intelligence-api.ts`, deno-tested). Serialises the same `getIntelligenceInsights()` result the web uses. Read-only.

**App:**
- Home: "Insights" section (RWF only, hidden with no data / feature off): default wallet 30-day projection, spending pace, unusual payments, recurring payments, each with "Why am I seeing this?".
- `/forecast` screen: 7/14/30-day horizon, per wallet SVG chart + text figures, dated commitments, then the three fact blocks.
- Entry points: Home card, Insights screen button, Inbox card (the last two only when `/api/mobile/config` says insights + insightsCenter are on).
- Push/notification tap for `insight.forecast_update` (`resource_type='forecast'`) opens `/forecast`.
- Strict parsers: bigint amounts, a malformed or contradictory payload is refused whole. Privacy mode hides amounts and the chart.

**Follow-up (same day):** More gates for Wallets, People, Payment requests and Insights restored (dark unless the server says on); `POST /api/mobile/insights/intelligence/notify` lets the app raise the forecast notification (shared 12h de-dupe with web); wallet picker and the "where your usual income comes from" prompt (`This is me` / Undo, via the People RPC) on `/forecast`.

**Finding (resolved above):** #310 (preview/live sync) overwrote #294's mobile forecast wiring and the `wallets/people/insightsCenter` More gates. Forecast is restored here via the new screen; the More gates were not restored.

**Not done / not verified:** no run on a device or simulator; the notify POST and the own-account prompt write to the database and were not exercised against a real account.
