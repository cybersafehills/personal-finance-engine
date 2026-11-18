// "Has this phone gone quiet?" - judged against that wallet's OWN rhythm, so a
// wallet that normally gets a message every few hours is flagged much sooner
// than one that gets a message once a week. PURE (no imports) so it is
// unit-tested with `deno test`.
//
// threshold = clamp(factor x typical gap between messages, minHours, maxHours)
// where "typical" is the median gap over recent arrivals (needs minSamples,
// otherwise the plain minimum applies). Silence is measured from the most
// recent sign of life: the later of the phone's last contact and the newest
// arrival.

export type SilenceInput = {
  /** When the phone last contacted OneLedger (credential last_used_at / last success). */
  lastSeenIso: string | null;
  /** Ingestion times of this wallet's recent transactions (any order). */
  arrivalsIso: readonly string[];
  nowMs: number;
  minHours?: number;
  maxHours?: number;
  factor?: number;
  minSamples?: number;
};

export type SilenceResult = {
  quiet: boolean;
  /** Hours since the last sign of life; null when there has never been one. */
  silentHours: number | null;
  thresholdHours: number;
  /** Median gap between messages, null when there are too few to know. */
  typicalGapHours: number | null;
};

const HOUR_MS = 3_600_000;

export function assessSilence(i: SilenceInput): SilenceResult {
  const minHours = i.minHours ?? 48;
  const maxHours = i.maxHours ?? 240;
  const factor = i.factor ?? 5;
  const minSamples = i.minSamples ?? 5;

  const times = i.arrivalsIso
    .map((s) => Date.parse(s))
    .filter((n) => Number.isFinite(n) && n <= i.nowMs)
    .sort((a, b) => a - b);

  let typicalGapHours: number | null = null;
  if (times.length >= minSamples) {
    const gaps: number[] = [];
    for (let k = 1; k < times.length; k++) {
      gaps.push((times[k] - times[k - 1]) / HOUR_MS);
    }
    gaps.sort((a, b) => a - b);
    const mid = gaps.length >> 1;
    typicalGapHours = gaps.length % 2
      ? gaps[mid]
      : (gaps[mid - 1] + gaps[mid]) / 2;
  }
  const thresholdHours = typicalGapHours === null
    ? minHours
    : Math.min(maxHours, Math.max(minHours, typicalGapHours * factor));

  const seen = Date.parse(i.lastSeenIso ?? "");
  const lastSign = Math.max(
    Number.isFinite(seen) ? seen : -Infinity,
    times.length > 0 ? times[times.length - 1] : -Infinity,
  );
  if (!Number.isFinite(lastSign)) {
    return { quiet: false, silentHours: null, thresholdHours, typicalGapHours };
  }
  const silentHours = Math.max(0, (i.nowMs - lastSign) / HOUR_MS);
  return {
    quiet: silentHours >= thresholdHours,
    silentHours,
    thresholdHours,
    typicalGapHours,
  };
}
