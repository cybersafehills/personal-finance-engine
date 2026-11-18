# S7 — Web Wallets page: balance labels and "I checked my balance" (2026-11-17)

Workstream B, web surface. The database layer (S3), the mobile API and the mobile Wallets screen already exist; the web app had no place to see a balance's status or to state one. **Dark**: `/wallets` renders the app 404 unless `BALANCE_PROVENANCE_ENABLED=true` (optional `BALANCE_PROVENANCE_WORKSPACE_ALLOWLIST`). No migration. Not enabled in any environment.

## What it adds

| Path | Purpose |
|---|---|
| `web/app/wallets/page.tsx` (+ `loading.tsx`) | Each active wallet: balance, label (Confirmed / Estimated / Out of date / Not available), what the label means, as-of time and source, the reasons, recent hand-entered balances, links to that wallet's Transactions / Insights / details. With more than one wallet: known balances added up per currency, stating how many figures are uncertain or missing |
| `web/app/wallets/actions.ts` | `recordBalanceAction` → `record_manual_balance_observation` RPC |
| `web/components/wallets/RecordBalanceForm.tsx` | The "I checked my balance" form |
| `web/lib/wallets/wallets-data.ts` | `loadWallets` (shared loader) and `loadEnteredBalances` |
| `web/lib/wallets/wallets-display.ts` | Pure: wording, exact balance parsing, per-currency totals |
| `web/app/api/mobile/accounts/route.ts` | Now calls `loadWallets`; response shape unchanged |
| `web/app/settings/accounts/page.tsx` | "Balances" link in the header, only when the flag is on |
| `web/components/insights/InsightAmount.tsx` | `kind="balance"` also honours the hide-balance toggle |

## Rules

1. **One derivation.** Web and the mobile API both call `loadWallets` → `deriveBalance` (`web/lib/balance-status.ts`). The labels and their explanations are the same words the app uses.
2. **A typed balance is never "Confirmed".** Only a provider message can confirm. A hand-entered balance shows as Estimated, says it was entered by a member of the Space, and is listed in an append-only history (corrections are new entries).
3. **No number without evidence.** "Not available" shows no figure. "Out of date" shows the last known balance with its time, not a projection.
4. **The total is not a live balance.** It adds only wallets that have a figure, per currency, and says how many of those figures are estimated or out of date and how many wallets are left out.
5. **Exact input.** The amount is typed as text and parsed on the server by digit arithmetic. A fraction the currency cannot hold is refused, not rounded; a currency whose decimal places are unknown is refused; zero is valid. The currency comes from the wallet in the active workspace, never from the form.
6. **Authorization is the database's.** The RPC requires member or above (a viewer is refused), takes workspace and currency from the account, rejects a future time, and writes a `balance.manual_observation` audit event. The page reads through the session client. The wallet list is source-filtered by the database (`accounts_select_member` requires `can_view_source_in_space`, and the baselines view is `security_invoker`), and hand-entered balances are only shown under a wallet that is in that list. **Fixed by `20270104000000_balance_observations_source_visibility.sql`** (the first version of this slice shipped with the table readable by every member; the policy now also requires `can_view_source_in_space`, and the RPC refuses an account the caller cannot see).
7. **Privacy.** Balances are masked by both privacy mode and the hide-balance toggle.
8. **No partial page.** A failed read shows an error state, not a shorter wallet list.

## Known limits

- "Wallet switching" in this slice is per-wallet links into Transactions and Insights filtered to that wallet. There is no global selected-wallet state that follows the user across Home, Transactions and Insights.
- Only a negative-free balance can be entered (the table allows negative for overdrawn bank accounts; the form does not yet).
- The entry time is "now"; a past as-of time cannot be chosen.
- History shows the latest three entries per wallet from the newest 50 in the Space, without who entered each.
- A viewer sees the form and gets a permission message on save (role is not pre-checked on the page).
- No navigation entry; the only entry point is the link on Accounts.
- The stale threshold (7 days) is the S3 default and is still awaiting an owner decision.

## Verification

- `deno test --config web/lib/deno.json web/lib`: 977 pass (4 new wallet tests: exact parsing incl. refusal to round, unknown currency, size bound; per-currency totals; label parity with the app).
- `tsc --noEmit`, `eslint`: clean.
- **Not run locally:** any render (Docker unavailable). `e2e/wallets.spec.ts` (label shown, invalid input refused, a typed balance comes back as the user's statement and never "Confirmed", axe at desktop and phone width) runs in CI against the disposable Supabase stack; see the PR's e2e check.
- **Not verified:** a viewer role, a household Space with restricted sources, non-RWF wallets, real devices, production data.

## Rollout

`BALANCE_PROVENANCE_ENABLED=true` with `BALANCE_PROVENANCE_WORKSPACE_ALLOWLIST=<workspace id>`, redeploy, compare each wallet with the provider's own balance, then widen. Rollback: unset the flag; entered balances stay in `balance_observations` and have no effect while the flag is off.
