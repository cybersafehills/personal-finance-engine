# E7 — Real Cash Power message formats (2026-11-16)

## What the real samples showed (this corrects my E5 assumption)
The owner supplied screenshots of real prepaid-electricity messages. Two findings:

1. **The token is NOT in the MTN MoMo payment message.** It arrives in a **separate SMS from the electricity vendor's own sender** (the screenshots show two senders and two wordings). E5 assumed "…with token …" inside the MoMo confirmation. That is not what these messages look like, so **E5's capture path would not have captured these tokens.** (E5's label redaction remains a harmless safety net for any MoMo message that does carry a token, and it makes no claim about these.)
2. The two vendor wordings:

| | English ("cashpower_en") | Kinyarwanda ("tokeni_rw") |
|---|---|---|
| Header | `Cashpower Token:` | `<dd/mm/yyyy>:` then `Tokeni:` |
| Token | 20 digits, 5 groups of 4 joined by `-` | same |
| Energy and amount | `Purchased 11.90 KWh for 5,000 RWF,` | `1,000 RWF = 2.4 kWh` |
| Meter | `Meter# <number>` | `Konteri: <number>` (and a line with the meter **owner's name** in brackets) |
| Vendor reference | `TxID: <number>` | `TXNID: K<number>` |
Meter numbers are 11 digits in most samples and 13 in one.

## What I built
`supabase/functions/ingest-momo/utility-receipt.ts`: a pure, strict parser for exactly these two formats (+ `tests/utility_receipt_test.ts`, 6 tests). It returns the token (20 digits), kWh, amount, meter, the vendor's own transaction reference and, for the Kinyarwanda format, the date; **it never extracts the meter owner's name**; any missing or malformed required field → `null` (no guessing). **Not wired into any ingestion path.**
The tests use **synthetic values in the same layout** — the real tokens, meter numbers, names and transaction ids from the screenshots were deliberately **not** copied anywhere in the repository. Those tokens are bearer values (and may or may not have been used); treat the screenshots as sensitive and delete them from anywhere shared.

## Update (same day): now wired in end to end
The decisions below were taken (recommended options) and built — see **ADR 0020** (`docs/adr/0020-utility-receipts.md`). The section below is kept as the reasoning that led there.

## Why it was not wired in, and the decisions that were needed
Today a vendor SMS would only reach OneLedger if your iPhone Shortcut / Android capture forwards it, and both are set up to forward the **MoMo sender** only. Wiring it in is a product decision with real design work:
1. **How do these messages get in?** Extend the Shortcut/Android capture to also forward the vendor senders, or add a "paste a Cash Power SMS" action in the app, or both. (Forwarding any extra sender needs an updated Shortcut and, on Android, a notification-listener allowlist.)
2. **How is a receipt tied to the MoMo payment?** Proposed: same workspace, amount equal, and a time window (the MoMo confirmation and the vendor SMS arrive minutes apart; the Kinyarwanda format also carries a date). When there is more than one candidate, ask the user rather than guess. The vendor's own reference is stored but is **not** the MoMo TxId, so it can't be the join key.
3. **What is stored?** Proposed: the token **encrypted** with the E5 machinery (`transaction_sensitive_details`, audited reveal); kWh on the transaction (non-sensitive); the meter number **masked** (last 4 digits) or encrypted — it identifies a household. The owner's name is not stored.
4. **The raw SMS** would contain the token in plaintext in the raw-evidence tables (service-role-only). Mask it on ingest, or keep as evidence? (Same open question as E5.)
5. **Price insight (optional):** the samples give RWF per kWh (e.g. 5,000 RWF → 11.9 kWh ≈ 420/kWh; 1,000 RWF → 2.4 kWh ≈ 417/kWh; 3,000 RWF → 6.9 kWh ≈ 435/kWh), which could power a "you paid more per kWh this time" note. Not built; the rate differs by tier/fees, so it would need care.

## Verification
Edge tests: **106 pass**; `deno check`/`lint`/`fmt --check` clean. **Not verified:** any end-to-end flow (nothing is wired), the other vendor wordings you may receive (only the two shown are handled), and messages from other utilities (water, gas, TV).
