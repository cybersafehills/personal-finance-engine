# Home and Transactions live data

Home follows the selected Space on preview/live. It uses `/api/mobile/accounts` for wallet balances and `/api/mobile/insights/overview` for settled cash flow, spending and monthly trends. These authenticated endpoints retain their feature gates and workspace echo checks. No prototype balances, growth rates, categories or merchants ship in the screen.

The balance card sums only wallets in the selected currency. Partial, estimated and stale totals carry their provenance, with the oldest contributing timestamp. If the wallet endpoint is unavailable, an RWF transaction snapshot is labelled “Last reported balance”, never an aggregate available balance. Missing data shows an unavailable state instead of fabricated zeroes.

Monthly comparisons use month to date and the same elapsed point in the previous calendar month, clamped for shorter months. Reporting uses Africa/Kigali; greetings use the device's local hour and the authenticated profile name. Income/expense/category calculations come from the canonical server analytics, which excludes internal transfers and unconfirmed transactions. Currencies are never added together.

Recent activity is limited to three entries. View all clears previous search, category and period filters in Transactions. Both lists explicitly scope SQLite and Supabase reads to the active Space. Requests from an old Space or old search cannot overwrite the current view. Failed, reversed, pending and unsynced entries retain visible status; nominal amounts and fees retain their actual currency. Settled lifetime header totals are RWF only.

Focus, foreground, sync notifications and 60-second refreshes update the screens. Pull to refresh attempts a sync before reading transactions. Offline transactions retain their Space and sync status. Network errors retain same-Space cached figures with a warning, or show an unavailable state. This is recorded account data, not a direct query to a bank or MoMo balance service.

Validation covers scope changes, stale responses, filter reset, privacy, mixed currencies, partial balances, calendar boundaries, exact bigint parsing and transaction states. Expo Go includes the added SVG module; previously compiled custom clients need rebuilding to include that native dependency. Native bundle compilation and automated screen tests do not replace a signed-in physical-device visual test.
