export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface px-4 py-3.5">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
