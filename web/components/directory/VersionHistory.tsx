import type { VersionRow } from "../../lib/directory/admin-queries";

export function VersionHistory({ versions }: { versions: VersionRow[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-text-secondary">Version history</h2>
      {versions.length === 0 ? (
        <p className="text-sm text-text-muted">No versions recorded yet.</p>
      ) : (
        <ul className="text-sm">
          {versions.map((v) => (
            <li
              key={v.version}
              className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              <span className="font-medium text-text-primary">v{v.version}</span>
              <span className="flex-1 text-text-secondary">{v.change_reason ?? "—"}</span>
              <span className="text-xs text-text-muted">
                {new Date(v.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
