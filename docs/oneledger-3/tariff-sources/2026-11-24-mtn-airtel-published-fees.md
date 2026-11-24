# Published fee tables used by Save On (captured 2026-11-24)

Text captured from the providers' own public pages, kept as the evidence for migration
`20270126000000_save_on_published_tariffs.sql` (which was generated from these pages, not
typed by hand). All amounts are whole RWF, fixed fee per band. Neither page states an
effective date. Re-capture and compare before changing a figure.

## MTN Rwanda: https://www.mtn.co.rw/momo-tarrif/ ("MoMo Tarrifs")

"Sending Money: Fees per transfer, paid by the sender. Receiving money is free."

### P2P On-net (MTN to MTN person-to-person) -> `send_money` / `same_network`
| Min | Max | Fee |
|---|---|---|
| 1 | 1,000 | 20 |
| 1,001 | 10,000 | 100 |
| 10,001 | 150,000 | 250 |
| 150,001 | 2,000,000 | 1,500 |
| 2,000,001 | 5,000,000 | 3,000 |
| 5,000,001 | 10,000,000 | 5,000 |

### To another wallet or bank via eKash -> `bank_transfer` / `any`
| Min | Max | Fee |
|---|---|---|
| 1 | 1,000 | 20 |
| 1,001 | 10,000 | 20 |
| 10,001 | 150,000 | 20 |
| 150,001 | 2,000,000 | 20 |
| 2,000,001 | 5,000,000 | 20 |
| 5,000,001 | 10,000,000 | 20 |

### Withdraw (fees) -> `cash_withdrawal` / `any` (deposit is 0 in every band; payer of the withdrawal fee is not stated)
| Min | Max | Fee |
|---|---|---|
| 1 | 100 | 50 |
| 101 | 300 | 50 |
| 301 | 1,000 | 100 |
| 1,001 | 3,000 | 200 |
| 3,001 | 5,000 | 250 |
| 5,001 | 10,000 | 275 |
| 10,001 | 20,000 | 350 |
| 20,001 | 40,000 | 600 |
| 40,001 | 75,000 | 1,100 |
| 75,001 | 150,000 | 2,000 |
| 150,001 | 300,000 | 3,000 |
| 300,001 | 500,000 | 6,000 |
| 500,001 | 1,000,000 | 9,000 |
| 1,000,001 | 2,000,000 | 17,000 |
| 2,000,001 | 5,000,000 | 25,000 |
| 5,000,001 | 8,000,000 | 30,000 |
| 8,000,001 | 10,000,000 | 35,000 |

## Airtel Money Rwanda: https://airtelmoney.rw/transaction_fees

The page is a script-rendered app. The dropdown offers three options: Cash-Out, IMT to Vodacom Tanzania / MTN Uganda (with a second IMT table), and Wallet to Bank.

### Cash-Out -> `cash_withdrawal` / `any`
| Min | Max | Fee |
|---|---|---|
| 1 | 100 | 30 |
| 101 | 300 | 40 |
| 301 | 1,000 | 80 |
| 1,001 | 3,000 | 160 |
| 3,001 | 5,000 | 215 |
| 5,001 | 10,000 | 240 |
| 10,001 | 20,000 | 310 |
| 20,001 | 40,000 | 525 |
| 40,001 | 75,000 | 950 |
| 75,001 | 150,000 | 1,750 |
| 150,001 | 300,000 | 2,500 |
| 300,001 | 500,000 | 4,300 |
| 500,001 | 1,000,000 | 7,000 |
| 1,000,001 | 2,000,000 | 12,000 |

### Wallet to Bank -> `bank_transfer` / `any` (no band below 101)
| Min | Max | Fee |
|---|---|---|
| 101 | 300 | 30 |
| 301 | 1,000 | 50 |
| 1,001 | 3,000 | 90 |
| 3,001 | 5,000 | 120 |
| 5,001 | 10,000 | 150 |
| 10,001 | 20,000 | 190 |
| 20,001 | 40,000 | 320 |
| 40,001 | 75,000 | 460 |
| 75,001 | 150,000 | 780 |
| 150,001 | 300,000 | 1,500 |
| 300,001 | 500,000 | 2,350 |
| 500,001 | 1,000,000 | 3,700 |
| 1,000,001 | 2,000,000 | 4,500 |

### Not loaded
- **Airtel to Airtel person-to-person: the page publishes no such labelled table.** Its HTML also contains hidden, unlabelled tables (for example 1-1,000 = 10, 1,001-10,000 = 50, 10,001-150,000 = 125, 150,001-2,000,000 = 750) that no visitor can reach; they are not a published source and were not used. Until Airtel confirms its person-to-person fees, Airtel gets no fee-saving offer.
- IMT, MoKash, school fees, tax, water and corporate tables: not needed for Save On.
