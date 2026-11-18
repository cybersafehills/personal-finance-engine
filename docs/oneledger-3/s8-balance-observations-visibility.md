# S8 — Balance observations honour source visibility (2026-11-18)

**Migration:** `supabase/migrations/20270104000000_balance_observations_source_visibility.sql`. No application code change: the Wallets page and `GET /api/mobile/accounts` already read through the session client, so RLS now does the filtering.

## The problem
`balance_observations` (S3) was readable by every member of a workspace. In a household Space a member must not see data for a co-member's financial source unless it was shared in (ADR 0005); transactions and accounts already follow that rule through `can_view_source_in_space()`. A balance typed in for a private wallet was readable by every other household member straight from the table, although the Wallets page only listed wallets they may see. The RPC had the mirror-image problem: a member could append an observation to a co-member's private wallet by guessing its id, and tell "exists" from "does not exist".

## The change
- **Read:** `balance_observations_select_visible` requires membership **and** that the caller may see the account's source in that workspace.
- **Write:** `record_manual_balance_observation()` refuses an account the caller cannot see, with the same `account_not_found` as a missing account.
- Personal and organization workspaces are unaffected (`can_view_source_in_space` collapses to membership there). A household account with no source is visible to nobody but service-role code, exactly as the `accounts` policy already treats it.
- No data is touched. Service-role paths (erasure, export) are unaffected.

## Tests (`run_migration_tests.sh`, S3 block)
The household fixture is now source-backed (one wallet shared into the Space, one private). New cases: the source owner records and reads both; a member and a viewer read the shared wallet's observations but not the private wallet's; a member's attempt on the private wallet is refused with `account_not_found` and writes nothing; the baselines view hides the private wallet; pausing the share hides the shared wallet's observations and resuming restores them; a personal-workspace owner still reads their own.

## Rollback
Recreate the old policy (`using (public.is_workspace_member(workspace_id))`) and the previous function body from `20261224000000`. Nothing to undo in the data.

## Siblings
The counterparty tables had the same exposure (names and identifiers readable by every workspace member); fixed in S9 (`s9-counterparty-visibility.md`, `20270105000000`).
