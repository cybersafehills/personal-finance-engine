// Geometry for the outlook chart. Pure, so the shape is testable without rendering.
export const CHART_W = 316;
export const CHART_H = 160;
const PAD = { top: 14, right: 8, bottom: 22, left: 8 };

// ---------------------------------------------------------------------------
// The outlook chart: two lines (usual income / no new money), the zero line,
// and a marker on the day the money runs out. Points are plain numbers (the
// story module already walked the balance), with real drops on dated payments.
// ---------------------------------------------------------------------------

export type OutlookChartModel = {
  expectedPath: string;
  cautiousPath: string;
  /** Closed shape under the zero line where the expected line is negative: the "short" area. */
  zeroY: number | null;
  runsOut: { x: number; y: number } | null;
  width: number;
  height: number;
  /** x of the labelled ticks: today, the middle and the end. */
  ticks: { x: number; day: number }[];
  sameLines: boolean;
};

export function buildOutlookChart(
  series: { day: number; expected: number; cautious: number }[],
  horizonDays: number,
  runsOutDay: number | null,
): OutlookChartModel | null {
  if (series.length < 2 || horizonDays < 1) return null;
  const values = series.flatMap((p) => [p.expected, p.cautious]);
  values.push(0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + (day / horizonDays) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * plotH;
  const path = (pick: (p: { expected: number; cautious: number }) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const sameLines = series.every((p) => Math.abs(p.expected - p.cautious) < 1);
  return {
    expectedPath: path((p) => p.expected),
    cautiousPath: path((p) => p.cautious),
    zeroY: min < 0 && max > 0 ? y(0) : null,
    runsOut: runsOutDay === null ? null : { x: x(Math.min(runsOutDay, horizonDays)), y: y(0) },
    width: CHART_W,
    height: CHART_H,
    ticks: [0, Math.round(horizonDays / 2), horizonDays].map((day) => ({ x: x(day), day })),
    sameLines,
  };
}
