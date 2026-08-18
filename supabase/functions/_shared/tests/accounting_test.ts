import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  computeAccountingEffect,
  hasComputedAccountingEffect,
} from "../accounting.ts";
import type { AccountingInput } from "../types.ts";

// ===========================================================================
// A-F: the required minimum matrix from the task spec.
// ===========================================================================

Deno.test("A. money received 7,500 RWF, no fee -> net +7,500", () => {
  const effect = computeAccountingEffect({
    direction: "in",
    status: "success",
    amount_rwf: 7500,
    fee_rwf: 0,
  });

  assertEquals(effect.principal_effect_rwf, 7500);
  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, 7500);
  assertEquals(effect.affects_balance, true);
  assertEquals(effect.settlement_state, "settled");
});

Deno.test("B. merchant payment 4,000 RWF, no fee -> net -4,000", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 4000,
    fee_rwf: 0,
  });

  assertEquals(effect.principal_effect_rwf, -4000);
  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, -4000);
  assertEquals(effect.affects_balance, true);
});

Deno.test("C. send money 1,000 RWF with 20 RWF fee -> principal -1,000, fee -20, net -1,020", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 1000,
    fee_rwf: 20,
  });

  assertEquals(effect.principal_effect_rwf, -1000);
  assertEquals(effect.fee_effect_rwf, -20);
  assertEquals(effect.net_effect_rwf, -1020);
});

Deno.test("D. airtime 50 RWF -> net -50", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 50,
    fee_rwf: 0,
  });

  assertEquals(effect.principal_effect_rwf, -50);
  assertEquals(effect.net_effect_rwf, -50);
});

Deno.test("E. failed transaction, attempted 200 RWF -> zero balance effect, amount preserved for evidence", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "failed",
    amount_rwf: 200,
    fee_rwf: 0,
  });

  assertEquals(effect.gross_amount_rwf, 200);
  assertEquals(effect.principal_effect_rwf, 0);
  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, 0);
  assertEquals(effect.affects_balance, false);
  assertEquals(effect.settlement_state, "failed");
});

Deno.test("F. unknown/needs-review transaction -> no authoritative balance effect", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "unknown",
    amount_rwf: 900,
    fee_rwf: 0,
  });

  assertEquals(effect.net_effect_rwf, 0);
  assertEquals(effect.affects_balance, false);
  assertEquals(effect.settlement_state, "unknown");
});

// ===========================================================================
// Additional required cases: fee arithmetic, zero-fee, large values.
// ===========================================================================

Deno.test("L. fee arithmetic: 2,500 RWF with 45 RWF fee -> principal -2,500, fee -45, net -2,545", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 2500,
    fee_rwf: 45,
  });

  assertEquals(effect.principal_effect_rwf, -2500);
  assertEquals(effect.fee_effect_rwf, -45);
  assertEquals(effect.net_effect_rwf, -2545);
  assertEquals(
    effect.net_effect_rwf,
    effect.principal_effect_rwf + effect.fee_effect_rwf,
  );
});

Deno.test("M. zero-fee transaction produces fee_effect_rwf of exactly 0, not -0", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 300,
    fee_rwf: 0,
  });

  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(Object.is(effect.fee_effect_rwf, -0), false);
});

Deno.test("N. large RWF values do not lose precision or throw", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 750_000_000,
    fee_rwf: 1500,
  });

  assertEquals(effect.principal_effect_rwf, -750_000_000);
  assertEquals(effect.fee_effect_rwf, -1500);
  assertEquals(effect.net_effect_rwf, -750_001_500);
});

// ===========================================================================
// Pending, reversed, and neutral direction.
// ===========================================================================

Deno.test("pending transaction is not treated as a settled financial movement", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "pending",
    amount_rwf: 500,
    fee_rwf: 0,
  });

  assertEquals(effect.net_effect_rwf, 0);
  assertEquals(effect.affects_balance, false);
  assertEquals(effect.settlement_state, "pending");
});

Deno.test("reversed transaction is conservatively excluded from totals, not counted as a second expense", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "reversed",
    amount_rwf: 1000,
    fee_rwf: 0,
  });

  assertEquals(effect.net_effect_rwf, 0);
  assertEquals(effect.affects_balance, false);
  assertEquals(effect.settlement_state, "reversed");
});

Deno.test("neutral direction moves no principal, even when settled", () => {
  const effect = computeAccountingEffect({
    direction: "neutral",
    status: "success",
    amount_rwf: 100,
    fee_rwf: 0,
  });

  assertEquals(effect.principal_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, 0);
});

// ===========================================================================
// Invariants (Phase 14).
// ===========================================================================

Deno.test("invariant: net_effect_rwf always equals principal_effect_rwf + fee_effect_rwf", () => {
  const cases: AccountingInput[] = [
    { direction: "in", status: "success", amount_rwf: 5000, fee_rwf: 0 },
    { direction: "out", status: "success", amount_rwf: 5000, fee_rwf: 100 },
    { direction: "out", status: "failed", amount_rwf: 5000, fee_rwf: 0 },
    { direction: "out", status: "pending", amount_rwf: 5000, fee_rwf: 0 },
    { direction: "out", status: "reversed", amount_rwf: 5000, fee_rwf: 0 },
    { direction: "out", status: "unknown", amount_rwf: 5000, fee_rwf: 0 },
    { direction: "neutral", status: "success", amount_rwf: 0, fee_rwf: 10 },
  ];

  for (const input of cases) {
    const effect = computeAccountingEffect(input);

    assertEquals(
      effect.net_effect_rwf,
      effect.principal_effect_rwf + effect.fee_effect_rwf,
    );
  }
});

Deno.test("invariant: a non-settled transaction never affects the balance", () => {
  const statuses: AccountingInput["status"][] = [
    "failed",
    "pending",
    "reversed",
    "unknown",
  ];

  for (const status of statuses) {
    const effect = computeAccountingEffect({
      direction: "out",
      status,
      amount_rwf: 1000,
      fee_rwf: 0,
    });

    assertEquals(effect.affects_balance, false);
  }
});

Deno.test("computeAccountingEffect rejects negative amount_rwf", () => {
  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: -1,
      fee_rwf: 0,
    })
  );
});

Deno.test("computeAccountingEffect rejects negative fee_rwf", () => {
  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: 100,
      fee_rwf: -1,
    })
  );
});

// ===========================================================================
// K. Idempotency: repeated processing produces the same result, every time.
// ===========================================================================

// ===========================================================================
// Adversarial review: contradictory states, malformed input, boundaries.
// ===========================================================================

Deno.test("adversarial: zero-amount settled transaction is a real settled event, not an unprocessed one", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: 0,
    fee_rwf: 0,
  });

  assertEquals(effect.net_effect_rwf, 0);
  assertEquals(effect.settlement_state, "settled");
  // The critical distinction: net_effect_rwf === 0 here means "genuinely
  // zero movement", not "not yet computed" - affects_balance is still
  // true, unlike every non-settled zero-effect case.
  assertEquals(effect.affects_balance, true);
});

Deno.test("adversarial: neutral direction with a nonzero amount is contradictory input, not silently discarded", () => {
  const effect = computeAccountingEffect({
    direction: "neutral",
    status: "success",
    amount_rwf: 500,
    fee_rwf: 0,
  });

  // Must NOT silently drop the 500 and report a misleadingly clean zero
  // settled effect. Must be excluded from authoritative totals instead.
  assertEquals(effect.affects_balance, false);
  assertEquals(effect.settlement_state, "unknown");
  assertEquals(
    effect.effect_reason,
    "neutral_direction_with_nonzero_amount_unsupported",
  );
  assertEquals(effect.gross_amount_rwf, 500);
});

Deno.test("adversarial: incoming transaction where fee exceeds the gross amount still computes a coherent (negative) net effect", () => {
  const effect = computeAccountingEffect({
    direction: "in",
    status: "success",
    amount_rwf: 10,
    fee_rwf: 50,
  });

  assertEquals(effect.principal_effect_rwf, 10);
  assertEquals(effect.fee_effect_rwf, -50);
  assertEquals(effect.net_effect_rwf, -40);
  assertEquals(effect.affects_balance, true);
});

Deno.test("adversarial: an unrecognized status value at runtime throws rather than returning undefined", () => {
  const malformed = {
    direction: "out",
    status: "cancelled",
    amount_rwf: 100,
    fee_rwf: 0,
  } as unknown as AccountingInput;

  assertThrows(() => computeAccountingEffect(malformed), RangeError);
});

Deno.test("adversarial: an unrecognized direction value at runtime throws rather than silently zeroing", () => {
  const malformed = {
    direction: "sideways",
    status: "success",
    amount_rwf: 100,
    fee_rwf: 0,
  } as unknown as AccountingInput;

  assertThrows(() => computeAccountingEffect(malformed), RangeError);
});

Deno.test("adversarial: malformed numeric input (NaN, Infinity, fractional) is rejected", () => {
  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: Number.NaN,
      fee_rwf: 0,
    })
  );

  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: Number.POSITIVE_INFINITY,
      fee_rwf: 0,
    })
  );

  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: 100.5,
      fee_rwf: 0,
    })
  );

  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: 100,
      fee_rwf: 5.25,
    })
  );
});

Deno.test("adversarial: amount at exactly Number.MAX_SAFE_INTEGER is accepted; one beyond it is rejected", () => {
  const effect = computeAccountingEffect({
    direction: "out",
    status: "success",
    amount_rwf: Number.MAX_SAFE_INTEGER,
    fee_rwf: 0,
  });

  assertEquals(effect.principal_effect_rwf, -Number.MAX_SAFE_INTEGER);

  assertThrows(() =>
    computeAccountingEffect({
      direction: "out",
      status: "success",
      amount_rwf: Number.MAX_SAFE_INTEGER + 1,
      fee_rwf: 0,
    })
  );
});

// ===========================================================================
// NULL-state invariant: NULL means "not yet processed", never "zero".
// ===========================================================================

Deno.test("hasComputedAccountingEffect distinguishes unprocessed (all null) rows from processed ones", () => {
  assertEquals(
    hasComputedAccountingEffect({
      principal_effect_rwf: null,
      fee_effect_rwf: null,
      net_effect_rwf: null,
      settlement_state: null,
      affects_balance: null,
    }),
    false,
  );

  assertEquals(
    hasComputedAccountingEffect({
      principal_effect_rwf: 0,
      fee_effect_rwf: 0,
      net_effect_rwf: 0,
      settlement_state: "failed",
      affects_balance: false,
    }),
    true,
  );
});

Deno.test("hasComputedAccountingEffect is false for a partially-populated (inconsistent) row", () => {
  assertEquals(
    hasComputedAccountingEffect({
      principal_effect_rwf: 0,
      fee_effect_rwf: null,
      net_effect_rwf: 0,
      settlement_state: "failed",
      affects_balance: false,
    }),
    false,
  );
});

Deno.test("K. repeated accounting processing is idempotent (same result, no duplicate effect)", () => {
  const input: AccountingInput = {
    direction: "out",
    status: "success",
    amount_rwf: 1000,
    fee_rwf: 20,
  };

  const first = computeAccountingEffect(input);
  const second = computeAccountingEffect(input);
  const third = computeAccountingEffect(input);

  assertEquals(first, second);
  assertEquals(second, third);
});
