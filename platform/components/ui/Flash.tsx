import { Icon } from "./Icon";

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  const good = !!ok;
  return (
    <div
      role={good ? "status" : "alert"}
      className={`mb-4 flex items-start gap-2 rounded-control px-3 py-2.5 text-sm ${good ? "bg-positive-soft text-positive-ink" : "bg-danger-soft text-danger-ink"}`}
    >
      <Icon name={good ? "ok" : "alert"} className="mt-0.5 shrink-0" />
      {(ok ?? err ?? "").slice(0, 200)}
    </div>
  );
}
