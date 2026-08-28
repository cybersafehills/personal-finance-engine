# ADR 0007: A bill document, a transaction, and an obligation are three distinct records — and a document never affects the ledger without human approval

- **Status:** Accepted (Bills & Expenses — Phase 1; Phases 2–8 planned)
- **Date:** 2026-08-28
- **Context:** The Invoice and Expense Processor (master prompt: "OneLedger
  Invoice and Expense Processor") ingests supplier invoices and receipts,
  extracts their fields, and turns approved ones into traceable OneLedger
  records. OneLedger already has a canonical `transactions` ledger fed by
  MoMo SMS, bank notifications and manual entry, plus `transaction_splits`
  for allocation. It has **no** supplier entity and **no** concept of an
  unpaid obligation. A naïve implementation would either (a) write an
  approved invoice straight into `transactions`, or (b) treat "the
  extractor produced fields" as "the data is trustworthy". Both are
  wrong for a financial-document workflow.

## Decision

### 1. Three permanently distinct records

| Record | Means | Table |
|---|---|---|
| **Document** | Source evidence + the *claims* extracted from it | `bill_documents` (+ `bill_document_artifacts`, `bill_extractions`) |
| **Transaction** | An actual movement of money | existing `transactions` |
| **Bill / obligation** | An approved classification + accounting treatment: what is owed or was spent | `bills` *(Phase 6)* |

A document may **support** a transaction (`bill_transaction_links`)
without replacing it. An approved invoice with no matching payment
becomes a `bills` row (an unpaid obligation) that links to a real
`transactions` row only once it is matched/paid — it is never itself a
`transactions` row. This keeps the existing ledger's meaning intact:
every `transactions` row is still a real, dated money movement tied to a
`momo_message_id` or `source='manual'`, never a synthetic entry standing
in for a document.

### 2. Human approval gates every ledger effect, for the whole first release

A document reaches `approved` only through
`transition_bill_document(p_to_state => 'approved')`, which requires the
`bill.approve` capability. Only an `approved` document can be posted
(Phase 6). There is **no** unrestricted auto-approval path.
`bill_processing_policies.auto_approval_enabled` and
`BILLS_AUTO_APPROVAL_ENABLED` exist so a future controlled auto-approval
(org policy + supplier trust + amount threshold + extraction confidence +
validation result + historical accuracy) is a purely additive change —
but `isBillsAutoApprovalEnabled()` returns `false` unconditionally and
no code path honours the column.

### 3. Extraction is advisory; deterministic validation is authoritative

"The extractor produced a total" is `extracted`, not `validated`. The
UI surfaces **extracted ≠ validated ≠ reviewed ≠ approved ≠ posted ≠
reconciled** as distinct states and never claims a document is "verified"
because extraction succeeded. Arithmetic, duplicate, tax and
plausibility checks (Phase 3) are deterministic rules with stable
`rule_id`s, independent of the AI. AI output is schema-validated
server-side before it is ever persisted, and extracted text is treated as
untrusted data — escaped in every render context, never interpreted as an
instruction.

### 4. Lifecycle and authorization are server-enforced, mirroring `payment_intents`

`bill_documents.status` moves only through `transition_bill_document()`
against the pure `bill_document_transition_allowed(from, to)` matrix, with
a capability keyed to the target state (`bill.review` / `bill.approve` /
`bill.post` / `bill.manage`). Same-state and matrix-invalid calls no-op
rather than raise, so retries and double-clicks are safe. This is the
same pattern as `transition_payment_intent` (ADR 0002).

## Consequences

- **Positive:** the ledger's existing invariants are untouched; a
  document can be retained as evidence for a transaction that already
  exists without double-counting; unpaid bills have a real home; the
  approval boundary is a database-enforced capability check, not a
  frontend flag; auto-approval can be added later without reshaping
  anything.
- **Cost:** more tables and one more join to answer "what does this
  transaction's evidence say". Accepted — conflating the three is the
  more expensive mistake (master prompt §33).
- **Deferred:** `bills`, `bill_transaction_links`, `suppliers` and the
  posting RPCs are Phase 5–6; Phase 1 ships only the document +
  preservation + lifecycle + audit foundation they attach to.
- **Related:** ADR 0001 (non-custodial boundary), ADR 0002 (payment-intent
  lifecycle), ADR 0005 (Spaces tenancy & source visibility),
  `docs/bills-and-expenses-design.md`.
