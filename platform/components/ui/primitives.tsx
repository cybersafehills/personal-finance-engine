import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-border bg-surface p-4 shadow-card ${className}`}
    >
      {title ? (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-text-3">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const PILL = {
  positive: "bg-positive-soft text-positive",
  attention: "bg-attention-soft text-attention",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-muted text-text-2",
} as const;
export type Tone = keyof typeof PILL;

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${PILL[tone]}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  delta,
  href,
  help,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { text: string; direction: "up" | "down" | "flat" | "none" };
  href?: string;
  help?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-2">{label}</span>
        {help ? (
          <span
            title={help}
            aria-label={help}
            className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border-strong text-[10px] text-text-3"
          >
            i
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-3">
        {delta ? (
          <span
            className={
              delta.direction === "up"
                ? "font-medium text-positive"
                : delta.direction === "down"
                  ? "font-medium text-attention"
                  : "text-text-3"
            }
          >
            {delta.text}
          </span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
    </>
  );
  const cls =
    "block rounded-card border border-border bg-surface p-4 shadow-card transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-border-strong`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Honest placeholder when a data source does not exist (never a fake number). */
export function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-control border border-dashed border-border-strong bg-surface-muted px-3 py-4 text-sm">
      <p className="font-medium text-text-2">{title}</p>
      <p className="mt-1 text-xs text-text-3">{reason}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-control bg-danger-soft px-3 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="px-1 py-6 text-center text-sm text-text-3">{message}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-text-3">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Segmented({
  items,
  active,
  label,
}: {
  items: { label: string; href: string; key: string }[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="inline-flex rounded-control border border-border bg-surface-muted p-0.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "true" : undefined}
          className={`rounded-[0.5rem] px-3 py-1 text-xs font-medium ${
            i.key === active ? "bg-surface text-text shadow-card" : "text-text-2 hover:text-text"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function DataTable({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-xs text-text-3">
            {columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
