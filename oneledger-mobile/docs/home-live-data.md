# Home and Transactions live data

Home follows the selected Space on preview/live. It uses `/api/mobile/accounts` for wallet balances and `/api/mobile/insights/overview` for settled cash flow, spending and monthly trends. These authenticated endpoints retain their feature gates and workspace echo checks. No prototype balances, growth rates, categories or merchants ship in the screen.

The balance card sums only wallets in the selected currency. Partial, estimated and stale totals carry their provenance, with the oldest contributing timestamp. If the wallet endpoint is unavailable, an RWF transaction snapshot is labelled “Last reported balance”, never an aggregate available balance. Missing data shows an unavailable state instead of fabricated zeroes.

Monthly comparisons use month to date and the same elapsed point in the previous calendar month, clamped for shorter months. Reporting uses Africa/Kigali; the profile avatar uses the authenticated profile name. Income/expense/category calculations come from the canonical server analytics, which excludes internal transfers and unconfirmed transactions. Currencies are never added together.

Recent activity is limited to three entries. View all clears previous search, category and period filters in Transactions. Both lists explicitly scope SQLite and Supabase reads to the active Space. Requests from an old Space or old search cannot overwrite the current view. Failed, reversed, pending and unsynced entries retain visible status; nominal amounts and fees retain their actual currency. Settled lifetime header totals are RWF only.

Focus, foreground, sync notifications and 60-second refreshes update the screens. Pull to refresh attempts a sync before reading transactions. Offline transactions retain their Space and sync status. Network errors retain same-Space cached figures with a warning, or show an unavailable state. This is recorded account data, not a direct query to a bank or MoMo balance service.

Validation covers scope changes, stale responses, filter reset, privacy, mixed currencies, partial balances, calendar boundaries, exact bigint parsing and transaction states. Expo Go includes the added SVG module; previously compiled custom clients need rebuilding to include that native dependency. Native bundle compilation and automated screen tests do not replace a signed-in physical-device visual test.

## Compact overview and wallet details

Recent transactions now appear immediately after monthly cash flow. Cash flow includes separate received/spent-today figures from a Kigali-day Insights request; its API failure is shown as unavailable, not zero. Income uses a green tint and spending an amber tint. Chart and category breakdown headers expand independently and start collapsed. Card typography, gutters and wallet rows use a smaller scale while retaining the shared accessibility font scaling and 44-point controls. The balance gradient uses measured native dimensions so it fills the card.

Budget forecast selects an active budget in the displayed currency and reports canonical allocation totals, remaining amount, period-end projection and data-quality warnings. It never mixes budgets or currencies or invents a projection where the server provides none.

Each wallet opens `/wallet/[id]`. That page validates the wallet against the current Space's wallet list, shows balance provenance and freshness, supports recording a checked balance, loads account-filtered monthly Insights and the latest ten wallet transactions, and links to the complete wallet-filtered Transactions list. The Add transaction form selects the wallet by account ID. The full list suppresses whole-Space lifetime totals while viewing a single wallet. Both online and SQLite reads apply the account filter alongside the Space filter.

## Separate landing wallet cards

Home now presents one wallet balance per swipeable card, with pager dots above the card and wallet-specific Add transaction/View wallet actions. No wallet balances are combined. The first card defaults to the primary wallet until the user chooses Make default. That preference is stored on this phone under a user-and-Space-scoped key; choosing it does not change the financial account’s primary status. A removed wallet falls back to the primary available wallet. Failed preference writes display an error and retain the prior default. Late preference reads cannot override an ongoing user selection.

The OneLedger brand and profile/notification controls share the compact top row; the Space selector sits beside the wallet pager dots. Cash flow leads with the larger received/spent-today totals, with monthly income and expenses shown as secondary figures. Monthly income/expense comparisons and retention are restored beneath those figures, using month-to-date versus the same elapsed point last month. Spending breakdown precedes cash flow trends; both start collapsed.


The wallet dots form a compact, single 44-point tap target that cycles wallets; swiping remains available. The same row keeps the Space picker and default-wallet action separate. Each wallet's update timestamp is inset to align with its balance text. Recent transactions use compact two-line rows with full-width metadata, red settled expenses and green settled income; pending/failed attempts remain neutral and labelled. Dense cards remove gaps between recent entries without dropping fees or sync status.


## Verified trends and search entry

The greeting model is removed from Home. A OneLedger/Money overview header replaces it. The Space selector is an intrinsic-width tinted chip inside a 44-point button; its wrapper and the wallet-dot control share an explicit 44-point row to keep native alignment consistent. Search resets old list filters and passes a one-use focus request to Transactions. The input autofocuses and receives a delayed focus after navigation; the request is then cleared so normal tab visits do not repeatedly summon the keyboard.

Monthly comparisons use canonical settled amounts in the same currency and Space for matching month-to-date windows. Zero/nonpositive prior denominators or a failed prior request produce no percentage. Retention is `(income - expenses) / income`; no income means no ratio, and overspending reports the actual excess with the bar clamped at zero. Privacy masks the percentages and progress values too.

Wallet balance trends compare two real provider snapshots for that account and currency under the signed-in user's RLS. Current balances must be provider-confirmed; manual, estimated, stale and unavailable amounts have no growth percentage. The earlier snapshot must be in the prior calendar month, at or before the matching point and within seven days of it. The UI names its actual date instead of pretending it is a month-end balance. Merged, unsettled and implausible received-balance rows are excluded. Missing history, zero/negative prior balances or query failures yield an unavailable comparison, never a fabricated baseline. A current-value/as-of check prevents an old query result from displaying against a refreshed balance.
