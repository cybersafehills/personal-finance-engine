// Provider detection for the universal capture endpoint. Given only the raw
// message text (the capture endpoint has no trusted sender), decide which
// provider adapter should own it. Pure, deterministic, no I/O - the full
// provider-specific parse happens later in the normalizing processor.
//
// Adding a provider = append one matcher. The matcher's `detect` should be
// permissive enough that a genuine-but-unparseable message from that provider
// still becomes preserved evidence (the processor's parser makes the final
// "parseable vs review" call), but tight enough that unrelated SMS
// (OTP codes, marketing, airtime top-up receipts) are turned away without
// writing evidence.
//
// This module is ported verbatim to the Android companion
// (`android/app/src/main/java/me/oneledger/companion/detection/ProviderMatchers.kt`,
// ADR 0010 §2). The companion runs the same matchers on-device so a
// non-financial notification never leaves the phone. When a matcher changes
// here, change the Kotlin port and its `ProviderMatchersTest` in the same PR.

export type DetectedProvider = {
  /** Canonical provider identifier, e.g. `mtn_momo`. */
  providerKey: string;
  /** The connector adapter contract key, e.g. `mtn_momo_sms_v1`. */
  connectorKey: string;
  channel: "sms";
};

export type ProviderMatcher = DetectedProvider & {
  detect(message: string): boolean;
};

// MTN Rwanda Mobile Money SMS. Markers seen across every real fixture in
// ingest-momo/tests/fixtures.ts: an RWF amount plus at least one MTN-specific
// token or a Mobile Money transaction verb.
const MTN_MARKERS = [
  /y['’]ello/i,
  /mobile\s?money/i,
  /\bTxId:/i,
  /\bFT\s?Id:/i,
  /\bET\s?Id:/i,
  /\*(?:RW|EN)#\s*$/i,
  /\bDial\s+\*\d/i,
];
const MTN_VERBS = [
  /payment of\s+[\d,]+\s+RWF/i,
  /[\d,]+\s+RWF\s+transferred to\b/i,
  /you have received\s+[\d,]+\s+RWF/i,
  /a transaction of\s+[\d,]+\s+RWF/i,
  /transaction with amount\s+[\d,]+\s+RWF/i,
];

function looksLikeMtnMomo(message: string): boolean {
  if (!/\bRWF\b/i.test(message)) return false;
  return MTN_MARKERS.some((r) => r.test(message)) ||
    MTN_VERBS.some((r) => r.test(message));
}

export const PROVIDER_MATCHERS: ProviderMatcher[] = [
  {
    providerKey: "mtn_momo",
    connectorKey: "mtn_momo_sms_v1",
    channel: "sms",
    detect: looksLikeMtnMomo,
  },
];

/** First matcher whose `detect` accepts the message, or `null` (unknown provider). */
export function detectProvider(message: string): DetectedProvider | null {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) return null;
  for (const m of PROVIDER_MATCHERS) {
    if (m.detect(trimmed)) {
      return {
        providerKey: m.providerKey,
        connectorKey: m.connectorKey,
        channel: m.channel,
      };
    }
  }
  return null;
}
