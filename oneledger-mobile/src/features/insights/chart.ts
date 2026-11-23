// Geometry for the forecast line chart (the web's ForecastChart, same rules).
// Pure, so the shape is testable without rendering. Two paths: the SCHEDULED
// balance (dated commitments only) and the ESTIMATED balance (also everyday
// spending). Straight lines between the server's points, a zero line whenever
// the balances cross it, and a marker at the lowest estimated point when the
// balance may go negative. The chart is never the only carrier of a figure:
// the screen repeats every number in text.

export const CHART_W = 316;
export const CHART_H = 160;
const PAD = { top: 14, right: 8, bottom: 22, left: 8 };

export type ChartPoint = { day: number; scheduled: bigint; estimated: bigint };

export type ChartModel = {
  scheduledPath: string;
  estimatedPath: string;
  /** y of the zero line, or null when 0 is not inside the plotted range. */
  zeroY: number | null;
  low: { x: number; y: number } | null;
  width: number;
  height: number;
  plotBottom: number;
};

export function buildChart(
  points: ChartPoint[],
  horizonDays: number,
  low: { day: number; amount: bigint } | null,
): ChartModel | null {
  if (points.length < 2 || horizonDays < 1) return null;
  const values = points.flatMap((p) => [Number(p.scheduled), Number(p.estimated)]);
  values.push(0); // the zero line is always in range, as on the web
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + (day / horizonDays) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * plotH;
  const path = (pick: (p: ChartPoint) => bigint) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(Number(pick(p))).toFixed(1)}`).join(" ");

  return {
    scheduledPath: path((p) => p.scheduled),
    estimatedPath: path((p) => p.estimated),
    zeroY: min < 0 && max > 0 ? y(0) : null,
    low: low ? { x: x(low.day), y: y(Number(low.amount)) } : null,
    width: CHART_W,
    height: CHART_H,
    plotBottom: CHART_H - PAD.bottom,
  };
}
