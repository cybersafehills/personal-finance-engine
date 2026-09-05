// OneLedger design system - the named, reusable primitives every surface
// should compose instead of re-deriving label/help/error markup, status
// vocabulary, confirm flows, or wizard chrome per page. See
// docs/design-system.md for the catalogue and usage rules.
//
// Pre-existing primitives that already belong to this system and are NOT
// re-exported here (import them from their own paths, unchanged):
//   ../Badge, ../EmptyState, ../PageHeader, ../StatTile, ../MoneyAmount,
//   ../Skeleton, ../BudgetStatusBadge, ../ReportStatusBadge

export { Field, type FieldControlProps } from "./Field";
export { CurrencyInput } from "./CurrencyInput";
export {
  CONNECTION_STATUSES,
  type ConnectionStatus,
  ConnectionStatusBadge,
  connectionStatusHint,
  connectionStatusLabel,
  SourceStatusBadge,
} from "./StatusBadge";
export {
  ActionRequiredItem,
  type ActionRequiredSeverity,
} from "./ActionRequiredItem";
export { DestructiveConfirm } from "./DestructiveConfirm";
export { PermissionGate } from "./PermissionGate";
export { StepWizard } from "./StepWizard";
