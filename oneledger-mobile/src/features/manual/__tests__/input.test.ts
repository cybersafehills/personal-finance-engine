import {
  buildManualTransaction,
  defaultDirection,
  MANUAL_TYPES,
  resolveWhen,
  type ManualAccount,
  type ManualForm,
} from "../input";

// 2026-11-15 12:00 Kigali (UTC+2) = 10:00Z
const NOW = Date.parse("2026-11-15T10:00:00Z");

const account: ManualAccount = { id: "a1", name: "MTN MoMo", workspaceId: "w1", currency: "RWF" };
const form = (over: Partial<ManualForm> = {}): ManualForm => ({
  transactionType: "merchant_payment",
  direction: "out",
  amountText: "4200",
  feeText: "",
  when: { kind: "now" },
  counterpartyName: "  Kigali Fresh ",
  notes: "",
  ...over,
});

describe("buildManualTransaction", () => {
  it("builds the row the database's accounting constraint expects for money out", () => {
    const r = buildManualTransaction(form({ feeText: "100" }), account, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.row).toMatchObject({
      account_id: "a1",
      workspace_id: "w1",
      source: "manual",
      status: "success",
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "manual_entry",
      direction: "out",
      currency: "RWF",
      amount_rwf: 4200,
      fee_rwf: 100,
      principal_effect_rwf: -4200,
      fee_effect_rwf: -100,
      counterparty_name: "Kigali Fresh",
      category: null,
      parser_version: "manual-entry-v1",
      momo_message_id: null,
    });
    expect(r.row.occurred_at).toBe("2026-11-15T10:00:00.000Z");
  });

  it("moves principal up and never charges a fee on money in", () => {
    const r = buildManualTransaction(
      form({ direction: "in", transactionType: "money_received", feeText: "500" }),
      account,
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.row.principal_effect_rwf).toBe(4200);
    expect(r.row.fee_effect_rwf).toBe(0);
    expect(r.row.fee_rwf).toBe(0);
  });

  it("uses the account's currency decimals", () => {
    const eur: ManualAccount = { ...account, currency: "EUR" };
    const r = buildManualTransaction(form({ amountText: "12.50" }), eur, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.row.currency).toBe("EUR");
    expect(r.row.amount_rwf).toBe(1250);
  });

  it("rejects bad, zero, negative and absurd amounts", () => {
    for (const bad of ["", "abc", "12,5", "0", "-5", "1e3"]) {
      expect(buildManualTransaction(form({ amountText: bad }), account, NOW).ok).toBe(false);
    }
    expect(buildManualTransaction(form({ amountText: "9999999999999" }), account, NOW)).toEqual({
      ok: false,
      error: "That amount is too large.",
    });
  });

  it("rejects an invalid or negative fee", () => {
    expect(buildManualTransaction(form({ feeText: "x" }), account, NOW)).toEqual({
      ok: false,
      error: "Enter a valid fee amount.",
    });
    expect(buildManualTransaction(form({ feeText: "-1" }), account, NOW)).toEqual({
      ok: false,
      error: "Fee cannot be negative.",
    });
  });

  it("ignores a stale fee typed before switching to money in", () => {
    const r = buildManualTransaction(form({ direction: "in", feeText: "garbage" }), account, NOW);
    expect(r.ok).toBe(true);
  });

  it("stores empty optional text as null and limits lengths", () => {
    const r = buildManualTransaction(form({ counterpartyName: "  ", notes: " " }), account, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.row.counterparty_name).toBeNull();
    expect(r.row.notes).toBeNull();
    expect(buildManualTransaction(form({ counterpartyName: "x".repeat(121) }), account, NOW).ok).toBe(false);
    expect(buildManualTransaction(form({ notes: "x".repeat(501) }), account, NOW).ok).toBe(false);
  });
});

describe("resolveWhen", () => {
  it("handles now and yesterday", () => {
    expect(resolveWhen({ kind: "now" }, NOW)).toEqual({ ok: true, iso: "2026-11-15T10:00:00.000Z" });
    expect(resolveWhen({ kind: "yesterday" }, NOW)).toEqual({ ok: true, iso: "2026-11-14T10:00:00.000Z" });
  });

  it("reads a custom date and time as Kigali time", () => {
    // 09:30 Kigali on the 14th = 07:30Z
    expect(resolveWhen({ kind: "custom", dateKey: "2026-11-14", timeText: "09:30" }, NOW)).toEqual({
      ok: true,
      iso: "2026-11-14T07:30:00.000Z",
    });
    // Time defaults to midday Kigali when left empty.
    expect(resolveWhen({ kind: "custom", dateKey: "2026-11-14", timeText: "" }, NOW)).toEqual({
      ok: true,
      iso: "2026-11-14T10:00:00.000Z",
    });
    // A Kigali midnight crosses back over the UTC date line.
    expect(resolveWhen({ kind: "custom", dateKey: "2026-11-14", timeText: "00:15" }, NOW)).toEqual({
      ok: true,
      iso: "2026-11-13T22:15:00.000Z",
    });
  });

  it("rejects malformed or impossible dates and times", () => {
    const at = (dateKey: string, timeText = "10:00") => resolveWhen({ kind: "custom", dateKey, timeText }, NOW);
    expect(at("14/11/2026")).toMatchObject({ ok: false, error: "Enter the date as YYYY-MM-DD." });
    expect(at("2026-02-30")).toMatchObject({ ok: false, error: "That date doesn't exist." });
    expect(at("2026-13-01")).toMatchObject({ ok: false, error: "That date doesn't exist." });
    expect(at("2026-11-14", "25:00")).toMatchObject({ ok: false, error: "Enter the time as HH:MM, 24-hour." });
    expect(at("2026-11-14", "9:5")).toMatchObject({ ok: false });
  });

  it("rejects the future beyond a small clock-skew allowance", () => {
    expect(resolveWhen({ kind: "custom", dateKey: "2026-11-16", timeText: "10:00" }, NOW)).toEqual({
      ok: false,
      error: "That time is in the future.",
    });
    // Same minute as now is fine.
    expect(resolveWhen({ kind: "custom", dateKey: "2026-11-15", timeText: "12:00" }, NOW).ok).toBe(true);
  });
});

describe("types", () => {
  it("covers every type the web allows, with a sensible default direction", () => {
    expect(MANUAL_TYPES.map((t) => t.key).sort()).toEqual(
      ["airtime", "bank_transfer", "bill_payment", "cash_deposit", "cash_withdrawal", "merchant_payment", "money_received", "other", "send_money"].sort(),
    );
    expect(defaultDirection("money_received")).toBe("in");
    expect(defaultDirection("cash_deposit")).toBe("in");
    expect(defaultDirection("merchant_payment")).toBe("out");
  });
});
