// Operator-tools shell marker (assessment section 21 / master prompt
// section 21): the /admin/* directory + USSD administration surfaces are
// internal operator tooling, not part of the consumer financial product.
// They still render inside the app shell, but this band makes it
// unmistakable that you have left the product. Access itself is enforced
// per-page (getDirectoryAccess / notFound); this is presentation only.

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-card border border-border-strong bg-background px-3 py-2">
        <span className="rounded-full bg-text-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-surface">
          Operator tools
        </span>
        <span className="text-xs text-text-muted">
          OneLedger directory &amp; USSD administration &mdash; not a
          customer surface
        </span>
      </div>
      {children}
    </div>
  );
}
