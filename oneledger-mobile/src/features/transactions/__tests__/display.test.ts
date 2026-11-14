import {
  displayName,
  groupByDay,
  needsReview,
  pickPlausibleBalance,
  safeSearchTerm,
  signedAmountRwf,
  sumTodayTotals,
  transactionTypeLabel,
} from "../display";

describe("displayName", () => {
  it("normalises airtime and missing names", () => {
    expect(displayName({ counterparty_name: null, transaction_type: "airtime" })).toBe("MTN Airtime");
    expect(displayName({ counterparty_name: null, transaction_type: "transfer_out" })).toBe("Unknown");
    expect(
      displayName({ counterparty_name: "Airtime with token and ET Id: 1", transaction_type: "merchant_payment" }),
    ).toBe("MTN Airtime");
    expect(displayName({ counterparty_name: "KMLVIO CENTER", transaction_type: "merchant_payment" })).toBe(
      "KMLVIO CENTER",
    );
  });
});

describe("signedAmountRwf", () => {
  it("signs by direction and zeroes failed or neutral rows", () => {
    expect(signedAmountRwf({ direction: "in", amount_rwf: 500, status: "success" })).toBe(500);
    expect(signedAmountRwf({ direction: "out", amount_rwf: 500, status: "success" })).toBe(-500);
    expect(signedAmountRwf({ direction: "neutral", amount_rwf: 500, status: "success" })).toBe(0);
    expect(signedAmountRwf({ direction: "out", amount_rwf: 500, status: "failed" })).toBe(0);
  });
});

describe("needsReview / transactionTypeLabel", () => {
  it("flags the three review statuses only", () => {
    for (const s of ["provisional", "suggested", "conflict"]) {
      expect(needsReview({ category_decision_status: s })).toBe(true);
    }
    expect(needsReview({ category_decision_status: "confirmed" })).toBe(false);
  });
  it("labels known types and tidies unknown ones", () => {
    expect(transactionTypeLabel("merchant_payment")).toBe("Payment to a business");
    expect(transactionTypeLabel("loan_repayment")).toBe("Loan repayment");
    expect(transactionTypeLabel("")).toBe("Transaction");
  });
});

describe("groupByDay", () => {
  it("groups consecutive rows by Kigali day, keeping order", () => {
    const now = "2026-08-20T10:00:00Z";
    const rows = [
      { id: "a", occurred_at: "2026-08-20T08:00:00Z" },
      { id: "b", occurred_at: "2026-08-19T23:00:00Z" },
      { id: "c", occurred_at: "2026-08-19T10:00:00Z" },
      { id: "d", occurred_at: "2026-08-10T10:00:00Z" },
    ];
    expect(groupByDay(rows, now).map((s) => [s.title, s.data.map((r) => r.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["August 10", ["d"]],
    ]);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("pickPlausibleBalance", () => {
  it("skips a received row whose balance is below the credit it reports", () => {
    const rows = [
      { balance_after_rwf: 0, occurred_at: "t2", direction: "in", principal_effect_rwf: 100 },
      { balance_after_rwf: 2305, occurred_at: "t1", direction: "out", principal_effect_rwf: -50 },
    ];
    expect(pickPlausibleBalance(rows)).toEqual({ amountRwf: 2305, asOfIso: "t1" });
  });
  it("takes the newest consistent row and handles nothing usable", () => {
    expect(
      pickPlausibleBalance([{ balance_after_rwf: 7675, occurred_at: "t", direction: "in", principal_effect_rwf: 7500 }]),
    ).toEqual({ amountRwf: 7675, asOfIso: "t" });
    expect(pickPlausibleBalance([])).toBeNull();
    expect(
      pickPlausibleBalance([{ balance_after_rwf: 0, occurred_at: "t", direction: "in", principal_effect_rwf: 100 }]),
    ).toBeNull();
  });
});

describe("sumTodayTotals", () => {
  it("adds principal and fees per direction and ignores neutral rows", () => {
    expect(
      sumTodayTotals([
        { direction: "out", principal_effect_rwf: -1000, fee_effect_rwf: -20 },
        { direction: "out", principal_effect_rwf: -50, fee_effect_rwf: 0 },
        { direction: "in", principal_effect_rwf: 7500, fee_effect_rwf: 0 },
        { direction: "neutral", principal_effect_rwf: 999, fee_effect_rwf: 0 },
        { direction: "in", principal_effect_rwf: null, fee_effect_rwf: null },
      ]),
    ).toEqual({ spentRwf: 1070, receivedRwf: 7500 });
  });
});

describe("safeSearchTerm", () => {
  it("strips filter syntax characters", () => {
    expect(safeSearchTerm("  shop,(a)%  ")).toBe("shop  a");
    expect(safeSearchTerm("%%")).toBe("");
  });
});
