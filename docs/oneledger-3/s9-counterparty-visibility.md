# S9 — Counterparties honour source visibility (2026-11-18)

**Migration:** `supabase/migrations/20270105000000_counterparty_source_visibility.sql`. No application code change: every web and mobile read already goes through the caller's session, so RLS now does the filtering. Stacked on S8 (`20270104000000`).

## The problem
`counterparties`, `counterparty_identifiers`, `counterparty_merge_events` and `counterparty_split_events` were readable by every member of a workspace. Their content comes from transactions: a counterparty's **name** and its **identifiers** (a normalised phone number or merchant code) come from the transactions that resolved to it. In a household a member must not see data for a co-member's source unless it was shared in (ADR 0005), so a name or phone number that appears *only* on an unshared source was readable by the other members. (Amounts were already safe: `counterparty_summaries_v` is `security_invoker` over `transactions`.)

The five write functions (`update_counterparty`, `merge_counterparties`, `undo_counterparty_merge`, `split_counterparty`, `undo_counterparty_split`) are `SECURITY DEFINER` and bypass RLS, so a member could rename, merge or split a hidden counterparty by guessing its id. Merging a *visible* counterparty **into** a hidden one would also have made the hidden one visible.

## The rule — `can_view_counterparty(id)`
- Personal and organization Spaces: any member sees every counterparty (unchanged).
- Household: a member sees a counterparty if they can see **at least one transaction** that resolved to it, or to a counterparty merged into it. "Can see a transaction" is `can_view_source_in_space` on the transaction's source, the same primitive transactions and accounts use.
- Consequences: a transaction you can see always has a counterparty you can see (and its survivor, if merged), so no screen loses a name for data it is showing. A counterparty with no visible transaction is invisible to household members. Visibility is evaluated at read time: pausing a share hides the people it exposed; resuming restores them.
- Policies: counterparties and identifiers follow `can_view_counterparty`; a merge event is visible only if the survivor **and every merged id** are visible; a split event only if source and split-off are visible.
- Writes: each of the five functions now refuses a counterparty (or merge/split event) the caller cannot see, with the same error as a missing one (`counterparty_not_found`, `invalid_merge`, `merge_event_not_found`, `split_event_not_found`). No existence oracle.

## Decisions and caveats
- **A merge can expose the survivor's name, by design.** If the owner of both sources merges a shared person *into* a private-only person, the survivor becomes visible to members (their own transactions now carry that name). Only someone who can see every part can perform the merge, and undo hides it again. If this is not wanted, the owner should pick the shared one as survivor.
- **One identity, one name.** A person reached through both a shared and a private source is one counterparty; its display name is the latest raw label across both. Members see that person's name, which they are entitled to through the shared source.
- **`backfill_counterparties` is unchanged.** It still resolves every unresolved transaction in the workspace (the data must be complete) and returns only counts; those counts include sources the caller cannot see. Minor, left alone.
- **Split by identifier** moves every transaction carrying that identifier, including ones on sources the caller cannot see. It reveals nothing to the caller and the split is audited and reversible, but it does change structure the caller cannot fully see. Not restricted further.
- **Cost:** the policy runs a small indexed lookup per counterparty row, only in household Spaces (others return at once). Fine at household scale; revisit if a Space grows to many thousands of counterparties.
- No data is changed. Service-role paths (erasure, export, the processors) are unaffected. The account data export reads through the caller's session, so it now contains only the counterparties the caller may see.

## Tests (`run_migration_tests.sh`, S4 visibility block)
Fixture: the owner has one shared and one private source in a household and four people (shared-only, private-only, reachable through both, a second private-only). 20 cases: the owner sees all four; a member and a viewer see only the shared-only and the both-sides person; private phone numbers are unreadable; the summaries view agrees; renaming, merging into a hidden one, merging a hidden one and splitting a hidden one are all refused and change nothing; a member can still correct a visible one; a merge of a shared person into a private survivor makes the survivor visible and undo hides it; a merge between two private people is invisible to the member and the member cannot undo it; a split-off private part and its event stay hidden; a personal workspace is unaffected. The function-grant tripwire is 140 (+`can_view_counterparty`). The two-tenant sweep plants its child rows against a real counterparty (`{ws}` token).
**Verified by removal:** with the migration withheld the new tests fail (a member sees `1|1|1|1`, can rename a hidden counterparty and merge into one).
**Full migration harness on PostgreSQL 17, run locally: 982 passed, 0 failed.**

## Rollback
Recreate the four `*_select_member` policies (`using (public.is_workspace_member(workspace_id))`) and the previous function bodies from `20261225000000` / `20261228000000`; drop `can_view_counterparty`. Nothing to undo in the data.

## Still open before a household rollout
The People & merchants screens and the Insights counterparty grouping have not been exercised in a household with an unshared source (only the database layer is tested here). Do that once with two accounts before allowlisting a household Space.
