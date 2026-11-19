// Dependency-free SVG charts. Real values only; callers pass a plain-text
// summary for assistive tech. Colours come from the --chart-* tokens so both
// themes stay legible and the series order is colour-blind safe.

export function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const W = 96;
  const H = 36;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 3 - (v / max) * (H - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden preserveAspectRatio="none">
      <path d={`${d} L${W} ${H} L0 ${H} Z`} fill="var(--chart-1)" opacity="0.12" />
      <path d={d} fill="none" stroke="var(--chart-1)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Daily columns with gridlines, y-axis ticks and first/mid/last x labels. */
export function ColumnChart({
  points,
  summary,
  unit = "",
}: {
  points: { label: string; value: number }[];
  summary: string;
  unit?: string;
}) {
  const W = 560;
  const H = 180;
  const PL = 30;
  const PB = 20;
  const top = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const ticks = [0, top / 2, top];
  const plotW = W - PL;
  const plotH = H - PB;
  const gap = points.length > 40 ? 1 : 3;
  const bw = points.length ? Math.max(1.5, (plotW - gap * (points.length - 1)) / points.length) : 0;
  const xLabel = (i: number) => points[i]?.label.slice(5) ?? "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
      {ticks.map((t) => {
        const y = plotH - (t / top) * (plotH - 8);
        return (
          <g key={t}>
            <line x1={PL} x2={W} y1={y} y2={y} stroke="var(--chart-grid)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={PL - 6} y={y + 3} fontSize="10" textAnchor="end" fill="var(--text-3)">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const h = (p.value / top) * (plotH - 8);
        return (
          <rect key={i} x={PL + i * (bw + gap)} y={plotH - h} width={bw} height={Math.max(h, p.value > 0 ? 2 : 0)} rx="2" fill="var(--chart-1)">
            <title>{`${p.label}: ${p.value}${unit}`}</title>
          </rect>
        );
      })}
      {points.length > 0 ? (
        <>
          <text x={PL} y={H - 5} fontSize="10" fill="var(--text-3)">{xLabel(0)}</text>
          {points.length > 6 ? (
            <text x={PL + plotW / 2} y={H - 5} fontSize="10" textAnchor="middle" fill="var(--text-3)">{xLabel(Math.floor(points.length / 2))}</text>
          ) : null}
          <text x={W} y={H - 5} fontSize="10" textAnchor="end" fill="var(--text-3)">{xLabel(points.length - 1)}</text>
        </>
      ) : null}
    </svg>
  );
}

/** Horizontal stacked share bar + legend (used for plan mix and funnels). */
export function ShareBars({
  items,
  total,
  note,
}: {
  items: { label: string; value: number; color?: string }[];
  total: number;
  note?: string;
}) {
  const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border" role="img" aria-label={items.map((i) => `${i.label} ${i.value}`).join(", ")}>
        {items.map((i, n) => (
          <div key={i.label} style={{ width: `${total ? (i.value / total) * 100 : 0}%`, background: i.color ?? palette[n % palette.length] }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((i, n) => (
          <li key={i.label} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color ?? palette[n % palette.length] }} />
            <span className="flex-1">{i.label}</span>
            <span className="tabular-nums text-text-2">{i.value.toLocaleString("en-US")}</span>
            <span className="w-10 text-right text-xs tabular-nums text-text-3">{total ? Math.round((i.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-3 text-xs text-text-3">{note}</p> : null}
    </div>
  );
}

/** Funnel: each step with its count and conversion from the first step. */
export function Funnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const first = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / first) * 100);
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums text-text-2">
                {s.value.toLocaleString("en-US")} <span className="text-text-3">· {pct}%</span>
              </span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border">
              <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              {s.hint}
              {prev !== null && prev > 0 ? `${s.hint ? " · " : ""}${Math.round((s.value / prev) * 100)}% of previous step` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
