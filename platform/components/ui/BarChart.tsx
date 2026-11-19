// Dependency-free bar chart. Real values only; the caller supplies a plain-text
// summary for assistive tech (the chart itself is aria-hidden detail).
export function BarChart({
  points,
  summary,
}: {
  points: { label: string; value: number }[];
  summary: string;
}) {
  const W = 360;
  const H = 120;
  const max = Math.max(1, ...points.map((p) => p.value));
  const gap = 2;
  const bw = points.length > 0 ? Math.max(1, (W - gap * (points.length - 1)) / points.length) : 0;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label={summary}>
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--border)" />
        {points.map((p, i) => {
          const h = (p.value / max) * (H - 6);
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={Math.max(h, p.value > 0 ? 1.5 : 0)}
              rx="1.5"
              fill="var(--accent)"
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </rect>
          );
        })}
        {points.length > 0 ? (
          <>
            <text x="0" y={H + 12} fontSize="9" fill="var(--text-3)">{points[0].label}</text>
            <text x={W} y={H + 12} fontSize="9" fill="var(--text-3)" textAnchor="end">
              {points[points.length - 1].label}
            </text>
          </>
        ) : null}
      </svg>
      <figcaption className="mt-1 text-xs text-text-3">Peak: {max} in a day</figcaption>
    </figure>
  );
}
