# ingest-momo

Edge Function that ingests raw MTN Rwanda Mobile Money SMS messages forwarded
from an iPhone Shortcut, deterministically parses them into structured
transactions, and classifies merchants via `merchant_rules`.

## Module layout

- `index.ts` — HTTP orchestration only: auth, request validation, duplicate
  detection, calling the parser/classifier, and database writes.
- `adapter.ts` — concrete `mtn_momo_sms_v1` adapter: pairing/discovery
  validation, versioned event envelopes, and normalization through the same
  production parser.
- `parser.ts` — pure, deterministic SMS parsing (`parseMomoMessage`). No
  Supabase or database access.
- `parser-utils.ts` — normalization, hashing, and field-extraction helpers used
  by the parser. No Supabase or database access.
- `merchant-rules.ts` — merchant classification against the `merchant_rules`
  table. Kept separate from SMS parsing.
- `responses.ts` — shared JSON response helper.
- `types.ts` — shared types (`ParsedTransaction`, `MerchantClassification`,
  etc).
- `tests/fixtures.ts` — realistic MTN SMS fixtures with expected parsed output.
- `tests/parser_test.ts` — Deno test suite for `parser.ts`. Runs against
  fixtures only; never touches Supabase or the production project.

## Provider-adapter rollout

`ONELEDGER_MTN_MOMO_ADAPTER=enabled` is an exact-match, default-off Edge
Function flag. When enabled, and only for an installation whose canonical
connector key is `mtn_momo_sms_v1`, `index.ts` builds a provider event envelope
and calls `resolve_connector_event_route` before storing evidence. The returned
installation, credential, source, account, and workspace must all equal the
existing shadow route. Any resolver error or mismatch fails closed. The
service-only `connector_adapter_route_health` table records redacted aggregate
outcomes so an operator can judge the rollout without inspecting SMS payloads or
credentials; telemetry failures never alter the request result.

The adapter's discovery snapshot requires a validated Rwanda MSISDN, safe
display labels, and a masked identifier containing at most four digits. Raw
source/account references are domain-separated SHA-256 values at the adapter
boundary. Discovery and event routing therefore produce identical hashes while
ordinary metadata never receives the raw MSISDN.

Current account-scoped Shortcut credentials work with the unchanged request
body. Optional `source_ref` and `account_ref` fields exist for future unscoped
multi-account forwarding agents; `account_ref` is invalid without its source.

## Supported MTN transaction formats

| Format                                                         | `transaction_type`           | Pattern name          |
| -------------------------------------------------------------- | ---------------------------- | --------------------- |
| Failed transaction                                             | `other` (`status: "failed"`) | `failed_transaction`  |
| Money received                                                 | `money_received`             | `money_received`      |
| Send money (P2P transfer)                                      | `send_money`                 | `send_money`          |
| Airtime top-up                                                 | `airtime`                    | `airtime_payment`     |
| Merchant payment (`Your payment of ... to ...`)                | `merchant_payment`           | `merchant_payment`    |
| Generic successful transaction (`A transaction of ... by ...`) | `merchant_payment`           | `generic_transaction` |

Any RWF-containing SMS that matches none of the above returns `null` from
`parseMomoMessage` and is stored with `processing_status: "needs_review"`.
**Unknown formats must never be guessed into a transaction.**

## Unsupported formats (coverage gaps)

`cash_withdrawal`, `cash_deposit`, `bill_payment`, `bank_transfer`, `refund`,
and `reversal` are declared in `TransactionType` but have **no parser pattern
and no fixtures**. No confirmed real-world MTN Rwanda SMS sample for these
formats was available while building this suite, and inventing plausible-looking
wording risks silently misparsing real messages once a real sample does arrive.
Do not add a parser branch for any of these without a real (anonymized)
production SMS to anchor the fixture against.

Until then, SMS messages of these types will parse as `null` and land in
`needs_review`, which is the correct, safe behavior for an unrecognized format.

## Known edge case: merchant names starting with "Airtime"

The airtime pattern matches `to Airtime` followed by anything up to
`was
completed at`. A hypothetical merchant payment to a business whose name
also starts with "Airtime" (e.g. "Airtime Distributors Ltd") would currently be
misclassified as an `airtime` transaction rather than `merchant_payment`. This
has not been fixed because there is no confirmed real-world MTN sample proving
how such a merchant name would actually be rendered, and changing the pattern
without one risks breaking the real, already-validated airtime format. Flagging
here for awareness; revisit if a real conflicting sample turns up.

## Parser precedence principle

`parseMomoMessage` checks patterns in order from most specific to most generic,
and returns on the first match. This matters because a generic pattern (e.g.
"generic successful transaction") can structurally match text that a more
specific pattern (e.g. airtime) was designed for. The airtime pattern is
deliberately checked before the merchant-payment pattern so an airtime top-up
SMS is never misclassified as a merchant payment. This is covered by a
regression test — see below.

## Adding a new parser safely

1. Add the new `message.match(...)` block to `parser.ts`, placed **before** any
   existing pattern it could be structurally confused with (most specific
   patterns first, generic fallbacks last).
2. Add a realistic fixture to `tests/fixtures.ts` with the exact expected output
   (transaction type, direction, status, amount, fee, balance, counterparty,
   reference, transaction id, `occurred_at`, and `metadata.parser_pattern`),
   then add it to the `parserTestCases` table so the table-driven loop in
   `tests/parser_test.ts` picks it up automatically.
3. If the new pattern could be confused with an existing one, add an explicit
   regression test in `tests/parser_test.ts` proving the correct one wins (see
   the airtime regression tests for the pattern to follow).
4. Run the quality gates (below) and confirm all existing tests still pass
   unchanged — a new pattern must never change the parsed output of an existing
   fixture.

## Adding a new regression fixture

Add the raw SMS text and its fully-expected parsed fields (or `expected: null`
for a rejection case) to `tests/fixtures.ts`, then add an entry for it to the
`parserTestCases` array — the table-driven loop at the top of
`tests/parser_test.ts` verifies every field automatically. Prefer copying real
(anonymized) SMS text over hand-written approximations so fixtures track the
real MTN format.

## Commands

```sh
# Format
deno fmt supabase/functions/ingest-momo/

# Lint
deno lint supabase/functions/ingest-momo/

# Type check the entry point (transitively checks all imported modules)
deno check supabase/functions/ingest-momo/index.ts

# Run the parser test suite (fixtures only, no network/Supabase access)
deno test supabase/functions/ingest-momo/tests/
```

## Rule: unknown formats become `needs_review`, never inferred

If `parseMomoMessage` cannot confidently match an SMS to a known format, it
returns `null`. `index.ts` then marks the `momo_messages` row as `needs_review`
and records a `processing_errors` entry — it never guesses at a transaction
type, amount, or counterparty for unrecognized text.
