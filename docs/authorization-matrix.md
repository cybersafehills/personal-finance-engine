# OneLedger authorization matrix

This document is the design-level companion to the executable authorization
checks in `supabase/migrations/tests/run_migration_tests.sh`.

## Space capabilities

| Capability | Owner | Admin | Member | Viewer |
| --- | :---: | :---: | :---: | :---: |
| `space.manage_settings` | yes | yes | no | no |
| `space.delete` | yes | no | no | no |
| `space.transfer_ownership` | yes | no | no | no |
| `members.manage` | yes | yes | no | no |
| `budget.manage` | yes | yes | no | no |
| `goal.manage` | yes | yes | no | no |
| `rule.manage` | yes | yes | no | no |
| `report.config` | yes | yes | no | no |
| `category.manage` | yes | yes | no | no |
| `transaction.create` | yes | yes | yes | no |
| `transaction.categorize` | yes | yes | yes | no |
| `audit.view` | yes | yes | no | no |
| `integration.view` | yes | yes | yes | no |
| `integration.import` | yes | yes | no | no |
| `integration.import_approve` | yes | yes | no | no |
| `integration.export` | yes | yes | no | no |
| `integration.configure` | yes | yes | no | no |
| `integration.connection_manage` | yes | yes | no | no |
| `integration.sync_manage` | yes | yes | no | no |
| `integration.logs_view` | yes | yes | no | no |

Unknown and null capability names fail closed for every role. A member may
receive an additive, workspace-scoped capability grant. Grants cannot deny a
role capability and do not carry into another workspace. Suspended or removed
members have no capabilities.

Personal workspaces have a single owner. That owner receives the same 12 known
capabilities; unknown capabilities still fail closed.

## Data visibility and mutation

Active membership is the first boundary for workspace data. In a household,
financial rows have a second boundary: a source must be owned by the user or
actively shared into that Space. Source visibility is intentionally independent
of role, so owner, admin, member, and viewer can read the same actively shared
ledger data. Roles and additive grants determine mutation rights.

The source owner controls whether a financial source is shared, paused, or
revoked. Revoking membership or a source link removes access immediately.
Members cannot use a link in one Space to obtain access in another Space.

## Trusted-service boundary

`service_role` is reserved for server-side ingestion, scheduled delivery, and
other trusted maintenance. Internal helpers and claim/ack/release delivery RPCs
must not be executable by `anon` or `authenticated`. The migration suite checks
both those explicit boundaries and representative cross-tenant RLS behavior.
