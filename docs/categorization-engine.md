# Categorization policy engine

What actually got built (increments 1–7), how it's wired together, and how to use it. This documents the system as implemented, not the original feature request — see git history (`ac973a1` onward) for how it evolved.

## Where each piece lives

| Concern | Location |
|---|---|
| Schema, RLS, SECURITY DEFINER functions | `supabase/migrations/20260829000000_phase_f_categorization_policies.sql` through `20260831000000_phase_h_learned_suggestions.sql` |
| Live evaluation (runs at ingestion) | `supabase/functions/ingest-momo/policy-engine.ts`, called from `index.ts` |
| Historical matching (runs on demand, one policy at a time) | `policy_matches_transaction()` SQL function — a deliberate, narrow duplication of the same per-condition logic, kept in sync by hand (each file's comments point at the other) |
| Policy management UI | `web/app/categories/rules/**`, `web/components/PolicyForm.tsx`, `PolicyItem.tsx` |
| Review queue | `web/app/transactions/review/**`, `web/components/ReviewQueueItem.tsx` |
| Learned suggestions | `web/app/categories/rules/suggestions/**`, `web/components/LearnedSuggestionItem.tsx` |
| Historical backfill | `web/app/categories/rules/[id]/apply/**`, `web/components/ApplyPolicyPanel.tsx` |

No background job infrastructure exists in this app (confirmed during increment 1's investigation) — everything here is either synchronous (live ingestion) or user-driven, bounded-batch (historical backfill), or computed on demand (learned suggestions). Nothing runs on a schedule.

## Decision hierarchy (as implemented)

1. **Manual / confirmed** (`category_source = 'manual'`, `category_decision_status = 'confirmed'`) — set by `apply_manual_category_correction()` or `confirm_transaction_category()`. Never overwritten by anything below this line; there is no re-evaluation job that could even attempt it.
2. **Policy match**, tiered by the winning policy's confidence (see below).
3. **Conflict** — two policies tied for the best match and disagree on category. Nothing is committed.
4. **Uncategorized** — no match, or a match below the suggest threshold.

Policies are evaluated first-match-wins in ascending `priority` order (lower number = checked first), with condition count (specificity) breaking ties at the same priority — but priority always wins over specificity; a broader policy at priority 10 beats a narrower one at priority 100.

## Confidence tiers

Confidence is a static value set on each policy (not computed per-transaction — every transaction a given policy matches lands in the same tier).

| Confidence | `category_decision_status` | Effect |
|---|---|---|
| 90–100% | `auto` | Committed immediately |
| 70–89% | `provisional` | Committed, but appears in the review queue |
| 50–69% | `suggested` | **Not** committed — `suggested_category`/`suggested_subcategory` are set, `category` stays null, appears in the review queue |
| < 50% | `uncategorized` | Nothing happens, not even a suggestion |

Thresholds are named constants (`AUTO_THRESHOLD`, `PROVISIONAL_THRESHOLD`, `SUGGEST_THRESHOLD`) in `policy-engine.ts`.

## Policy condition model

A policy (`categorization_policies` table) composes these conditions with AND — every non-null condition must match:

- **Counterparty**: `merchant_pattern` + `match_type` (`exact` / `contains` / `starts_with` / `regex`). Null pattern = matches any counterparty.
- **Direction**: `in` / `out` / `neutral`, or null for any.
- **Amount range**: `amount_min_rwf` / `amount_max_rwf`, either or both null for an open range.
- **Time of day**: `time_start` / `time_end` (both or neither — enforced by a check constraint), evaluated against the transaction's local time. Handles windows crossing midnight.

A policy must have at least one condition (enforced by `categorization_policies_has_condition_check`) — no condition-less wildcard policy is possible.

**Actions** are deliberately narrow: assign category, subcategory, and (implicitly) the confidence-driven decision status. Nothing else — a policy can never touch amount, direction, status, or any other source financial field, matching spec §7's guidance to keep the action scope simple.

## Conflict resolution

When more than one policy ties for the best `(priority, specificity)` and they disagree on category/subcategory, `evaluatePolicies()` returns `decisionStatus: 'conflict'` with nothing committed — not even a suggestion (deliberately, to avoid silently biasing toward one candidate). The explanation names every conflicting policy. A conflict is resolved by a human via the review queue's Correct action, which produces an ordinary manual/confirmed decision.

## Historical backfill

`/categories/rules/[id]/apply` previews how many existing `uncategorized` transactions a policy would match (with a sample), then applies it in bounded 200-row batches via `apply_policy_to_historical()` — the client loops calling one batch at a time until a call returns 0. This mirrors the batching discipline of `scripts/phase-4-1-accounting-backfill.ts` (this repo's prior one-time accounting backfill), just driven from the UI instead of a CLI, since there's no job queue to hand it off to.

The just-completed run can be reverted via `revert_bulk_categorization()`, which protects any row a human has since confirmed or corrected — for an auto/provisional row that means `category_source` is still `'rule'`; for a suggested row (which never gets `category_source` set at all) it means `category_decision_status` is still `'suggested'`. Reverting an older run than the one just completed isn't offered in the UI (the `bulk_operation_id` is only known client-side for the current session) — the data itself remains revertible via the same RPC if that's ever needed.

## Other producers of a `suggested` decision

Besides the policy engine, **Pay & Services Phase 2b** can set
`suggested_category` on a transaction: when a ledger transaction is
deterministically linked to a OneLedger Pay payment intent, the intent's
chosen category lands as a `suggested`/`system` decision
(`transaction_category_history.engine_version = 'payment-reconciliation@1'`),
and only when the transaction is still `uncategorized`/`suggested` and not
`manual` — it never overrides a stronger decision. See
`docs/pay-and-services.md` (Phase 2b) and
`docs/adr/0003-sms-reconciliation-and-ledger-integrity.md`.

## Learned suggestions

Computed on demand, not stored: `detect_learned_policy_suggestions()` groups `transaction_category_history` rows where a human corrected the same counterparty to the same category/subcategory 3+ times, excluding anything already covered by an active policy or already decided (accepted/dismissed) via `learned_policy_suggestion_decisions`. Accepting a suggestion creates an ordinary policy (exact counterparty match, full confidence) — the same table and the same historical-backfill flow as any other policy, no separate machinery.

## User-facing summary

- **Confirmed**: you set this, or approved a suggestion. It will never be changed automatically.
- **Auto**: a high-confidence rule matched. You can still correct it any time.
- **Provisional**: a rule matched with moderate confidence — the category is applied, but it's worth a quick look in the review queue.
- **Suggested**: a rule matched with lower confidence — nothing was applied yet; confirm or dismiss it in the review queue.
- **Conflict**: two of your rules disagreed — resolve it in the review queue.
- **Uncategorized**: no rule matched (or one matched too weakly to even suggest).

To create a rule: Categories → Manage rules → New rule (or start from a Template). Conditions are optional and combine with AND — set only the ones that matter for that rule.

To apply a rule to transactions that already exist: open the rule → "Apply to history" → review the preview → apply (and revert if needed).

Suggested rules based on your past corrections appear under Categories → Manage rules → Suggestions once you've corrected the same counterparty to the same category three times.
