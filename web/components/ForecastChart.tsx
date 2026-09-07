import type {
  CashFlowForecast,
  ForecastPoint,
} from "../lib/intelligence/cash-flow-forecast";
import { formatRwf } from "../lib/format";

// A small line chart of the 30-day projected balance: the KNOWN path
// (dated commitments only) and the ESTIMATED path (also subtracting a
// flat daily discretionary spend). This is the one deliberate exception
// to ADR 0014's "no decorative charts in Intelligence" - it is a plain,
// axis-labelled, inline SVG (no library, theme tokens only) with a text
// caption that repeats every figure, so it is never chart-only.

const W = 640;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 24, left: 12 };

function pointsToPath(
  pts: ForecastPoint[],
  key: "knownBalanceMinor" | "estimatedBalanceMinor",
  horizonDays: number,
  yScale: (v: number) => number,
): string {
  return pts
    .map((p, i) => {
      const x = PAD.left +
        (p.dayOffset / horizonDays) * (W - PAD.left - PAD.right);
      const y = yScale(p[key]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ForecastChart({ forecast }: { forecast: CashFlowForecast }) {
  const pts = forecast.points;
  const values = pts.flatMap((p) => [p.knownBalanceMinor, p.estimatedBalanceMinor]);
  values.push(0); // always show the zero line
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const yScale = (v: number) =>
    PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);

  const knownPath = pointsToPath(pts, "knownBalanceMinor", forecast.horizonDays, yScale);
  const estPath = pointsToPath(pts, "estimatedBalanceMinor", forecast.horizonDays, yScale);
  const zeroY = yScale(0);
  const lowX = PAD.left +
    (forecast.projectedLow.dayOffset / forecast.horizonDays) *
      (W - PAD.left - PAD.right);
  const lowY = yScale(forecast.projectedLow.estimatedBalanceMinor);

  const ariaLabel =
    `Projected balance over ${forecast.horizonDays} days. Scheduled items only ends near ` +
    `${formatRwf(forecast.projectedEnd.knownBalanceMinor)}; with everyday spending, ` +
    `${formatRwf(forecast.projectedEnd.estimatedBalanceMinor)}. Lowest estimated point ` +
    `${formatRwf(forecast.projectedLow.estimatedBalanceMinor)} around day ${forecast.projectedLow.dayOffset}.`;

  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
          className="h-48 w-full min-w-[520px]"
        >
          {min < 0 && max > 0 && (
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--color-attention)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          <path
            d={knownPath}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d={estPath}
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
          <circle cx={lowX} cy={lowY} r="3.5" fill="var(--color-attention)" />
          <text
            x={PAD.left}
            y={H - 6}
            className="fill-text-muted"
            fontSize="11"
          >
            today
          </text>
          <text
            x={W - PAD.right}
            y={H - 6}
            textAnchor="end"
            className="fill-text-muted"
            fontSize="11"
          >
            day {forecast.horizonDays}
          </text>
        </svg>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>
          <span className="inline-block h-2 w-3 align-middle"
            style={{ background: "var(--color-accent)" }} />{" "}
          Scheduled items only
        </span>
        <span>
          <span className="inline-block h-2 w-3 align-middle"
            style={{ background: "var(--color-text-muted)" }} />{" "}
          With everyday spending
        </span>
        <span>
          Ends near {formatRwf(forecast.projectedEnd.knownBalanceMinor)} /{" "}
          {formatRwf(forecast.projectedEnd.estimatedBalanceMinor)}
        </span>
      </figcaption>
    </figure>
  );
}
