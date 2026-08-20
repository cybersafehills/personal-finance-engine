// Money representation decision (Phase 5):
//
// RWF has no fractional subunit in normal MTN Mobile Money usage - every
// amount, fee, and balance MTN reports is a whole franc integer, and the
// existing `transactions` table already stores amount_rwf, fee_rwf,
// balance_after_rwf, and net_effect_rwf as Postgres `bigint` (exact 64-bit
// integers), not `numeric`/`decimal`.
//
// This module therefore represents all RWF quantities as ordinary JS
// `number` integers - not floats-with-decimals, not bigint, not a
// fixed-point/decimal library. This is safe and requires no new
// dependency because:
//
//   - A JS `number` (IEEE-754 double) exactly represents every integer up
//     to Number.MAX_SAFE_INTEGER (2^53 - 1, ~9 quadrillion RWF), which is
//     many orders of magnitude beyond any realistic personal balance.
//   - No division, percentage, or other fractional operation is ever
//     performed on an RWF amount in this codebase - only integer addition,
//     subtraction, and negation - so no rounding error can be introduced.
//   - The existing parser (parser.ts) already produces amount_rwf/fee_rwf
//     as plain integer `number`s, and the DB column type (bigint) round-
//     trips them exactly via the JS client for values in this range.
//
// Do not introduce float-sensitive operations (division, percentages,
// float literals) into RWF arithmetic without revisiting this decision.
// Every arithmetic operation on an RWF amount in this codebase must go
// through this module so the safety checks below cannot be bypassed.

export function isSafeRwfInteger(value: number): boolean {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

export function assertSafeRwfInteger(value: number, label: string): void {
  if (!isSafeRwfInteger(value)) {
    throw new RangeError(
      `${label} must be a safe integer RWF amount, got ${value}`,
    );
  }
}

/** Sums whole-RWF integers, validating every operand and the result. */
export function addRwf(...values: number[]): number {
  for (const value of values) {
    assertSafeRwfInteger(value, "addRwf operand");
  }

  const sum = values.reduce((total, value) => total + value, 0);

  assertSafeRwfInteger(sum, "addRwf result");

  return sum;
}

/**
 * Negates a whole-RWF integer, normalizing the zero case so `-0` is never
 * produced (which would otherwise compare unequal under Object.is to the
 * `0` a test or a JSON round-trip would expect).
 */
export function negateRwf(value: number): number {
  assertSafeRwfInteger(value, "negateRwf operand");

  return value === 0 ? 0 : -value;
}
