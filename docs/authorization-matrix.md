# OneLedger authorization matrix

This document is the design-level companion to the executable authorization
checks in `supabase/migrations/tests/run_migration_tests.sh`. It is the
living, per-resource matrix required by the consolidation program (§52 /
audit F6). Rows marked **audited** have a corresponding assertion in the
migration suite; rows marked **partial** are enforced in code but not yet
covered end-to-end by an executable test.

---

## 1. Two enforcement styles (the F6 fragmentation)

OneLedger currently authorizes workspace data through **two** mechanisms that
must be read together:

| Style | Where | Used by |
| --- | --- | --- |
| **Role-tier RLS** — `is_workspace_member(workspace_id, min_role)` | RLS `USING` / `WITH CHECK` clauses on the core tables | Phase B–E tables: `accounts`, `transactions`, `categories`, `budgets`, `goals`, `merchant_rules`, … |
| **Closed capability catalog** — `has_space_capability(workspace_id, 'name')`, wrapping `space_role_has_capability(kind, role, cap)` + additive `space_member_capability_grants` | `SECURITY DEFINER` RPCs, and RLS on Phase Q+ tables | Spaces, Integrations, Bills, Developer platform, invites, audit |

`space_role_has_capability` is a single **forward-only** closed catalog,
`CREATE OR REPLACE`d to widen its known set by
`20261010000000_closed_capability_catalog.sql` (12) →
`20261026000000_integrations_capability_catalog.sql` (20) →
`20261110000000_bills_phase_1_intake_and_lifecycle.sql` (31) →
`20261119000000` / `20261121000000` (+`ledger_manage`, `ledger_sync`,
`developer_manage` = **34**). Unknown or null names fail closed for every
role, including owner.

**Convergence direction:** new tenant-scoped resources use the capability
style. The role-tier RLS on the core tables is not being rewritten in place
(that risks the tenant boundary); instead every new mutation path on those
tables goes through a capability-checked RPC, and this matrix documents the
effective result per resource.

---

## 2. Capability × role

`space_role_has_capability` resolves these. A **member** may additionally hold
an explicit, workspace-scoped, additive `space_member_capability_grant` for
any capability in the catalog; a grant never denies a role capability and
never crosses workspaces. Suspended/removed members hold nothing. Personal
workspaces have one `owner` who holds every known capability.

| Capability | Owner | Admin | Member (role) | Grantable to member | Catalog since |
| --- | :-: | :-: | :-: | :-: | --- |
| `space.manage_settings` | ✔ | ✔ | – | ✔ | 10 |
| `space.delete` | ✔ | – | – | ✔ | 10 |
| `space.transfer_ownership` | ✔ | – | – | ✔ | 10 |
| `members.manage` | ✔ | ✔ | – | ✔ | 10 |
| `budget.manage` | ✔ | ✔ | – | ✔ | 10 |
| `goal.manage` | ✔ | ✔ | – | ✔ | 10 |
| `rule.manage` | ✔ | ✔ | – | ✔ | 10 |
| `report.config` | ✔ | ✔ | – | ✔ | 10 |
| `category.manage` | ✔ | ✔ | – | ✔ | 10 |
| `transaction.create` | ✔ | ✔ | ✔ | ✔ | 10 |
| `transaction.categorize` | ✔ | ✔ | ✔ | ✔ | 10 |
| `audit.view` | ✔ | ✔ | – | ✔ | 10 |
| `integration.view` | ✔ | ✔ | ✔ | ✔ | 26 |
| `integration.import` | ✔ | ✔ | – | ✔ | 26 |
| `integration.import_approve` | ✔ | ✔ | – | ✔ | 26 |
| `integration.export` | ✔ | ✔ | – | ✔ | 26 |
| `integration.configure` | ✔ | ✔ | – | ✔ | 26 |
| `integration.connection_manage` | ✔ | ✔ | – | ✔ | 26 |
| `integration.sync_manage` | ✔ | ✔ | – | ✔ | 26 |
| `integration.logs_view` | ✔ | ✔ | – | ✔ | 26 |
| `integration.destination_manage` | ✔ | ✔ | – | ✔ | bills-1 |
| `integration.workbook_manage` | ✔ | ✔ | – | ✔ | bills-1 |
| `integration.conflict_resolve` | ✔ | ✔ | – | ✔ | bills-1 |
| `integration.accountant_package` | ✔ | ✔ | – | ✔ | 20261118 |
| `integration.ledger_manage` | ✔ | ✔ | – | ✔ | 20261119 |
| `integration.ledger_sync` | ✔ | ✔ | – | ✔ | 20261119 |
| `integration.developer_manage` | ✔ | ✔ | – | ✔ | 20261121 |
| `bill.upload` | ✔ | ✔ | ✔ | ✔ | bills-1 |
| `bill.review` | ✔ | ✔ | ✔ | ✔ | bills-1 |
| `bill.approve` | ✔ | ✔ | – | ✔ | bills-1 |
| `bill.post` | ✔ | ✔ | – | ✔ | bills-1 |
| `bill.manage` | ✔ | ✔ | – | ✔ | bills-1 |
| `bill.download_original` | ✔ | ✔ | – | ✔ | bills-1 |
| `bill.audit.view` | ✔ | ✔ | – | ✔ | bills-1 |
| `bill.configure` | ✔ | ✔ | – | ✔ | bills-1 |

(Admin = everything except `space.delete` / `space.transfer_ownership`.)

---

## 3. Per-resource matrix

Legend — **Scope:** W = active workspace membership · S = financial-source
ownership/active share · O = row owner · SR = `service_role` only.
**Enforcement:** RLS (row policy), RPC (`SECURITY DEFINER` check), UI (gate /
capability-aware control — advisory only, never the boundary).

| Resource | Action | Gate | Scope | RLS | RPC | UI | Status |
| --- | --- | --- | --- | :-: | :-: | :-: | --- |
| Financial source | read | membership + (owner or active share) | W+S | ✔ | – | ✔ | audited (Phase C/R) |
| Financial source | create / edit | row owner | O | ✔ | – | ✔ | audited |
| Source–Space link | share / narrow / revoke | source **owner** (role-independent) | O | ✔ | `share_financial_source` etc. | ✔ | audited (Phase R) |
| Account | read | membership | W | ✔ | – | ✔ | audited |
| Account | create / archive | `is_workspace_member(_, 'admin')` | W | ✔ | – | ✔ | audited (Phase C) |
| Transaction | read | membership + source visible | W+S | ✔ | – | ✔ | audited (RLS tenant isolation) |
| Transaction | create (manual) | `transaction.create` | W | ✔ | `create_manual_transaction` | ✔ | partial |
| Transaction | categorize / correct | `transaction.categorize` | W | ✔ | – | ✔ | audited |
| Transaction | split / transfer-link / attribute | `transaction.categorize` (+ owner for attribution) | W+S | ✔ | RPC | ✔ | partial |
| Transaction | duplicate merge / dismiss | `transaction.categorize` | W | – | `resolve_duplicate*` | ✔ | partial |
| Category | read | membership | W | ✔ | – | ✔ | audited |
| Category | manage (create/archive/restore) | `category.manage` | W | ✔ | RPC | ✔ | audited (Phase F) |
| Categorization rule | manage | `rule.manage` | W | ✔ | RPC | ✔ | partial |
| Budget / allocation | read | membership | W | ✔ | – | ✔ | audited (Phase D) |
| Budget / allocation | manage | `budget.manage` | W | ✔ | RPC | ✔ | audited |
| Goal / contribution | read | membership | W | ✔ | – | ✔ | audited (Phase D) |
| Goal | manage / participants | `goal.manage` | W | ✔ | RPC | ✔ | audited |
| Report config | edit | `report.config` | W | ✔ | RPC | ✔ | partial |
| Report artifact | read | **none** for `anon`/`authenticated` | SR | ✔ | via signed route | – | audited (Phase K: zero access) |
| Member / invite | invite / change role / remove | `members.manage` | W | ✔ | `create_workspace_invite`, `set_member_role` | ✔ | audited (Phase R) |
| Invite | redeem | any authenticated bearer of token hash | token | – | `accept_workspace_invite` | ✔ | audited — **bearer model (F5): no recipient binding; `accepted_by` recorded. Recipient-bound invites are a Release 4 item.** |
| Audit / space activity | read | `audit.view` | W | ✔ | – | ✔ | audited |
| Ingestion connection (legacy) | CRUD | owner-only write, member read | W+O | ✔ | `create_ingestion_connection_dual_write` | ✔ | audited (Phase C adversarial) |
| Connector installation / device credential (canonical) | read / manage / rotate / revoke | `integration.connection_manage`; rotate/revoke = MFA step-up (AAL2) | W | ✔ | RPC | ✔ | partial (ADR 0007, behind `ONELEDGER_CANONICAL_CONNECTIONS_UI`) |
| Raw financial evidence | any | none for `anon`/`authenticated` | SR | ✔ | – | – | audited (service-role-only grants) |
| Integration import / export / sync / destination / workbook / conflict | per-action | matching `integration.*` capability | W | ✔ | RPC | ✔ | audited (Phase 1–3 capability tests) |
| Accountant package | build / download | `integration.accountant_package` | W | ✔ | RPC | ✔ | partial |
| Accounting connector (ledger) | manage / sync | `integration.ledger_manage` / `integration.ledger_sync` | W | ✔ | RPC | ✔ | partial |
| Developer API key | read | `integration.view` | W | ✔ | – | ✔ | audited (Phase 4) |
| Developer API key | create / revoke | `integration.developer_manage` | W | – | RPC (service-role insert) | ✔ | audited (Phase 4: authenticated INSERT denied) |
| API request log / rate buckets | any | none for `anon`/`authenticated` | SR | ✔ | `api_rate_take` | – | audited (Phase 4) |
| Webhook subscription | manage | `integration.developer_manage` | W | ✔ | RPC (https-only, known event types) | ✔ | audited (Phase 4) |
| Webhook secrets / deliveries | any | none for `anon`/`authenticated` | SR | ✔ | – | – | audited (Phase 4) |
| Bill document | upload / read | `bill.upload` (member ok) | W | ✔ | RPC | ✔ | partial (Bills dark) |
| Bill | review / correct field / comment | `bill.review` (member ok) | W | ✔ | `correct_bill_field`, `add_bill_comment` | ✔ | audited (Bills Phase 7) |
| Bill | approve / post | `bill.approve` / `bill.post` | W | ✔ | RPC | ✔ | partial |
| Bill original file | download | `bill.download_original` | W | ✔ | signed route | ✔ | partial |
| Pay: payment intent / draft | create / act | membership; non-custodial handoff only (ADR 0001) | W | ✔ | `create_payment_intent`, `reconcile_payment_intent` | ✔ | audited (Phase N/O) |
| Pay: directory (networks / routes / USSD) | read | published rows public-ish; edit = `DIRECTORY_ADMIN_ENABLED` operator | — | ✔ | RPC | ✔ | audited (Phase M) |
| Export / data download | run | `integration.export`; **never gated by plan** | W | ✔ | RPC | ✔ | partial |
| Account deletion / data export (self) | request | the user, MFA step-up | O | — | — | — | **not implemented (F12)** |

---

## 4. Trusted-service boundary

`service_role` is reserved for server-side ingestion, scheduled delivery,
raw-evidence processing, and other trusted maintenance. Internal helpers and
claim/ack/release delivery RPCs must not be executable by `anon` or
`authenticated`. Service-role code bypasses RLS, so it must resolve explicit
workspace/source/account scope itself — this is the riskiest surface and the
migration suite checks it directly (function/sequence privilege regression,
`report_artifacts` zero access, `raw_financial_events` / API-log /
webhook-secret zero grants, `service_role` cross-workspace visibility
positive control).

## 5. Known gaps (tracked)

- **F5** — `accept_workspace_invite` is bearer-only; recipient binding or an
  explicit transferable-link invite type is a Release 4 item.
- **F6** — the two enforcement styles (§1) coexist; several core-table
  mutation RPCs are `partial` above (enforced, not yet test-covered).
  Closing them is Phase 1 work as each area is touched.
- **F12** — no self-serve account deletion / data export / retention
  workflow. Must never be paywalled. Needs a product decision on retention
  windows before implementation.
