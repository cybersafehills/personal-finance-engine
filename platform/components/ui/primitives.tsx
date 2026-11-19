import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Sparkline } from "./charts";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-card border border-border bg-surface shadow-card ${className}`}>
      {title ? (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-text-3">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const PILL = {
  positive: "bg-positive-soft text-positive-ink",
  attention: "bg-attention-soft text-attention-ink",
  danger: "bg-danger-soft text-danger-ink",
  info: "bg-info-soft text-info-ink",
  neutral: "bg-surface-muted text-text-2 ring-1 ring-inset ring-border",
} as const;
export type Tone = keyof typeof PILL;

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PILL[tone]}`}>
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
  spark,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { text: string; direction: "up" | "down" | "flat" | "none" };
  href?: string;
  help?: string;
  spark?: number[];
  tone?: Tone;
}) {
  const body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-2">{label}</span>
        {help ? (
          <span title={help} aria-label={help} tabIndex={0} className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border-strong text-[10px] text-text-3">
            i
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-[1.75rem] font-semibold leading-none tracking-tight">{value}</div>
        {spark && spark.length > 1 ? <Sparkline values={spark} className="h-9 w-24 shrink-0" /> : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-3">
        {delta ? (
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-medium ${
              delta.direction === "up" ? "bg-positive-soft text-positive-ink" : delta.direction === "down" ? "bg-attention-soft text-attention-ink" : "bg-surface-muted text-text-2"
            }`}
          >
            {delta.direction === "up" ? "▲ " : delta.direction === "down" ? "▼ " : ""}
            {delta.text}
          </span>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
    </div>
  );
  const cls = `block min-h-[8.25rem] rounded-card border bg-surface p-4 shadow-card transition-colors ${
    tone === "danger" ? "border-danger/40" : tone === "attention" ? "border-attention/40" : "border-border"
  }`;
  return href ? (
    <Link href={href} className={`${cls} hover:border-border-strong hover:bg-surface-muted`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Honest placeholder when a data source does not exist (never a fake number). */
export function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex gap-3 rounded-control border border-dashed border-border-strong bg-surface-muted px-4 py-4 text-sm">
      <Icon name="info" className="mt-0.5 shrink-0 text-text-3" />
      <div>
        <p className="font-medium text-text">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-3">{reason}</p>
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-3 text-sm text-danger-ink">
      <Icon name="alert" className="mt-0.5 shrink-0" />
      {message}
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="px-2 py-10 text-center">
      <p className="text-sm font-medium text-text-2">{message}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-xs text-text-3">{hint}</p> : null}
    </div>
  );
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-2xl text-sm text-text-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
          className={`rounded-[0.4rem] px-3 py-1.5 text-xs font-medium ${
            i.key === active ? "bg-surface text-text shadow-card" : "text-text-2 hover:text-text"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Underlined tabs for sub-sections of a page (link-driven, server friendly). */
export function Tabs({
  items,
  active,
  label,
}: {
  items: { label: string; href: string; key: string; count?: number }[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
            i.key === active ? "border-accent font-medium text-text" : "border-transparent text-text-3 hover:text-text"
          }`}
        >
          {i.label}
          {i.count !== undefined ? (
            <span className="rounded-full bg-surface-muted px-1.5 text-[11px] text-text-2 ring-1 ring-inset ring-border">{i.count}</span>
          ) : null}
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
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-muted text-[11px] uppercase tracking-wide text-text-3">
            {columns.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold first:rounded-tl-control last:rounded-tr-control">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&>tr:hover]:bg-surface-hover">{children}</tbody>
      </table>
    </div>
  );
}

export function Pager({
  prevHref,
  nextHref,
  summary,
}: {
  prevHref?: string | null;
  nextHref?: string | null;
  summary?: string;
}) {
  const btn = "inline-flex items-center gap-1 rounded-control border border-border px-3 py-1.5 text-xs font-medium";
  return (
    <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
      <span className="text-xs text-text-3">{summary}</span>
      <div className="flex gap-2">
        {prevHref ? (
          <Link href={prevHref} className={`${btn} text-text-2 hover:bg-surface-hover`}>
            <Icon name="prev" size={14} /> Newer
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className={`${btn} text-text-2 hover:bg-surface-hover`}>
            Older <Icon name="next" size={14} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-control bg-surface-hover ${className}`} />;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export const inputCls =
  "h-9 rounded-control border border-border-strong bg-surface px-3 text-sm placeholder:text-text-3";
export const buttonCls =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-control bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover";
export const ghostButtonCls =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-control border border-border-strong px-3.5 text-sm font-medium text-text-2 hover:bg-surface-hover hover:text-text";
