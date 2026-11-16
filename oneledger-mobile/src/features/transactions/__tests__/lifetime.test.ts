import { formatDdMmYyyy, lifetimeInfo, sumLifetimeFlow } from "../lifetime";

describe("sumLifetimeFlow", () => {
  it("adds fees to what was sent and counts only in/out rows", () => {
    const flow = sumLifetimeFlow([
      { direction: "out", principal_effect_rwf: -1000, fee_effect_rwf: -100 },
      { direction: "out", principal_effect_rwf: "-2000", fee_effect_rwf: null },
      { direction: "in", principal_effect_rwf: 5000, fee_effect_rwf: 0 },
      { direction: "neutral", principal_effect_rwf: 9999, fee_effect_rwf: 0 },
    ]);
    expect(flow).toEqual({ sentRwf: 3100, receivedRwf: 5000, count: 3 });
  });

  it("is zero for no rows and skips unusable numbers", () => {
    expect(sumLifetimeFlow([])).toEqual({ sentRwf: 0, receivedRwf: 0, count: 0 });
    expect(
      sumLifetimeFlow([{ direction: "in", principal_effect_rwf: "abc", fee_effect_rwf: 0 }]).count,
    ).toBe(0);
  });
});

describe("dates and info text", () => {
  it("formats DD/MM/YYYY and rejects bad input", () => {
    expect(formatDdMmYyyy("2026-09-04T08:00:00Z")).toBe("04/09/2026");
    expect(formatDdMmYyyy(null)).toBeNull();
    expect(formatDdMmYyyy("nope")).toBeNull();
  });

  it("words the explanation like the web", () => {
    expect(lifetimeInfo("sent", "2026-09-04T08:00:00Z")).toBe(
      "Total money sent through OneLedger since your account was created on 04/09/2026.",
    );
    expect(lifetimeInfo("received", null)).toBe(
      "Total money received through OneLedger since your account was created.",
    );
  });
});
