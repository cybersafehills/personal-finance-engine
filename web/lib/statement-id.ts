// Public statement identifier (Financial Documents Engine, Statements
// family - PR2). Format: OL-ST-YYYYMMDD-XXXXXX
//
//   OL-ST-   fixed prefix
//   YYYYMMDD  UTC generation date (deterministic, support-friendly)
//   XXXXXX    6 crypto-random chars from a 34-symbol alphabet
//             (0-9 A-Z without the ambiguous I and O)
//
// ~1.5 billion suffixes per day: non-guessable and collision-resistant,
// while staying short enough to read over the phone (master prompt section
// 19). The database also carries a UNIQUE index and a CHECK matching
// STATEMENT_ID_PATTERN (migration 20261210000000); generation retries on
// the astronomically rare collision. statements.id (the uuid PK) is never
// exposed - this is the only identifier that leaves the server.
//
// Zero DB access, `crypto` only. `randomBytes` is injectable so tests are
// deterministic.

// Every character here matches the character class in STATEMENT_ID_PATTERN
// and in the migration's CHECK constraint. Keep the three in sync.
const ID_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 34 symbols, no I/O
const SUFFIX_LENGTH = 6;

export const STATEMENT_ID_PATTERN = /^OL-ST-\d{8}-[0-9A-HJ-NP-Z]{6}$/;

export type RandomBytes = (n: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (n) =>
  crypto.getRandomValues(new Uint8Array(n));

/**
 * `SUFFIX_LENGTH` random chars from ID_ALPHABET, using rejection sampling
 * so the 34-symbol alphabet is unbiased over 0-255 (256 % 34 !== 0).
 */
export function randomStatementSuffix(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const ceiling = 256 - (256 % ID_ALPHABET.length); // 238
  const out: string[] = [];
  // Guard against a pathological injected RNG that only ever returns
  // rejected bytes.
  let safety = 0;
  while (out.length < SUFFIX_LENGTH) {
    if (safety++ > 1000) {
      throw new Error("randomStatementSuffix: RNG produced no usable bytes");
    }
    const batch = randomBytes(SUFFIX_LENGTH);
    for (const b of batch) {
      if (out.length >= SUFFIX_LENGTH) break;
      if (b >= ceiling) continue;
      out.push(ID_ALPHABET[b % ID_ALPHABET.length]);
    }
  }
  return out.join("");
}

/** "YYYYMMDD" in UTC for `now`. */
export function statementIdDatePart(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatStatementId(datePart: string, suffix: string): string {
  return `OL-ST-${datePart}-${suffix}`;
}

export function generateStatementId(
  opts: { now?: Date; randomBytes?: RandomBytes } = {},
): string {
  return formatStatementId(
    statementIdDatePart(opts.now),
    randomStatementSuffix(opts.randomBytes),
  );
}

export function isStatementId(value: string): boolean {
  return STATEMENT_ID_PATTERN.test(value);
}

// A Financial Pack's public id: OL-PK-YYYYMMDD-XXXXXX, same alphabet.
export const STATEMENT_PACK_ID_PATTERN = /^OL-PK-\d{8}-[0-9A-HJ-NP-Z]{6}$/;

export function generateStatementPackId(
  opts: { now?: Date; randomBytes?: RandomBytes } = {},
): string {
  return `OL-PK-${statementIdDatePart(opts.now)}-${
    randomStatementSuffix(opts.randomBytes)
  }`;
}

export function isStatementPackId(value: string): boolean {
  return STATEMENT_PACK_ID_PATTERN.test(value);
}
