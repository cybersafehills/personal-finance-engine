# Wallets

A **wallet** is one place your money sits: an MTN or Airtel account, a bank account, cash.
Each has its own balance and its own history, so they are never blended into one number.

## What it is for

1. **Keep accounts separate.** Different accounts, different accounting. Totals are shown only
   per currency and only for balances we trust.
2. **Say how sure we are.** Every balance carries a status: *Confirmed* (the figure in your
   provider's last message), *Estimated*, *Out of date*, or *Not available*. A balance you typed is
   a statement, never "Confirmed".
3. **Choose what Home shows.** Any wallet can be the **default**: first card on Home, and the one
   the cash-flow forecast follows. (It reuses the account's `is_primary`; owner-only.)
4. **Show what to do next.** A wallet with no balance, or whose phone has gone quiet, says so and
   points at the fix. Each card states how its balance stays current: automatically from the
   phone's messages, from a balance you enter, or (when empty) the three ways to get one.

## How a balance gets in

| Source | How | Status it can reach |
| --- | --- | --- |
| Phone messages (SMS capture shortcut) | automatic, on every message | Confirmed |
| "I checked my balance" | typed by a member | Estimated, from your statement |
| Statement import (CSV) | Settings > Sources > Import | Estimated until the next message |

## Where wallets live (Spaces)

Wallets belong to a **Space** (Personal, a household, ...). You can belong to several. If the active
Space has no wallets but another of yours does, Wallets and Home say so and offer a one-tap switch
instead of an empty page. The header shows the active Space on every screen size, phones included.

## Adding a wallet

Wallets page > **Add a wallet**: name, type (MTN, Airtel, bank, cash/other) and currency. It is an
account; connect its phone (Settings > Connected sources), import a statement, or enter a balance
to give it a number.

## Not built yet

- Per-wallet reorder, archive from the Wallets page (use Settings > Accounts).
- Wallet-to-wallet transfer shortcut (confirmed transfers already exclude both legs from
  spending/income; see Reconciliation).
- Marking a counterparty as "one of my own accounts" so unconfirmed transfers stop counting as income.
