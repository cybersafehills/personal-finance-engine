// Capability-aware rendering for a control the current member may not be
// allowed to use (master prompt "PermissionGate" / assessment section
// 6.1). This is presentation only - the server action / RPC behind the
// control MUST still do its own capability check (docs/authorization-
// matrix.md). A hidden button is not access control.
//
//   <PermissionGate allowed={can.manageMembers}>
//     <InviteButton />
//   </PermissionGate>
//
//   // or, keep it visible-but-disabled with an explanation:
//   <PermissionGate allowed={can.approveBill} disabledReason="Needs the bill.approve capability">
//     <ApproveButton />
//   </PermissionGate>

export function PermissionGate({
  allowed,
  disabledReason,
  fallback = null,
  children,
}: {
  allowed: boolean;
  /**
   * When set, a disallowed state renders the children wrapped as disabled
   * (dimmed, non-interactive, `title` + `aria-disabled`) instead of
   * hiding them - use when the control's absence would be confusing.
   */
  disabledReason?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (allowed) return <>{children}</>;

  if (disabledReason) {
    return (
      <span
        className="pointer-events-none inline-flex opacity-50"
        aria-disabled="true"
        title={disabledReason}
      >
        {children}
      </span>
    );
  }

  return <>{fallback}</>;
}
