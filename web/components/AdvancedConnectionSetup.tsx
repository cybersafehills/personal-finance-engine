"use client";

/**
 * Collapses the developer-oriented connection setup - the manual
 * label/provider/one-time-key form and the raw endpoint guide - behind an
 * "Advanced" disclosure, so the Connect iPhone wizard is the obvious path for
 * an ordinary user. Closed by default; the browser remembers nothing.
 */
export function AdvancedConnectionSetup({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-card border border-border-subtle bg-surface">
      <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-medium text-text-secondary marker:content-none">
        Advanced — manual setup
        <span className="ml-2 text-xs font-normal text-text-muted">
          for other apps, testing, or non-iPhone devices
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border-subtle p-4">
        {children}
      </div>
    </details>
  );
}
