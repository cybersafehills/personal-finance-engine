import {
  formatMoney,
  formatRwf,
  formatSignedRwf,
  toMinorUnits,
} from "../money";

describe("toMinorUnits", () => {
  it("handles RWF (0 decimals)", () => {
    expect(toMinorUnits("500000", "RWF")).toBe(BigInt(500000));
    expect(toMinorUnits("1.5", "RWF")).toBe(BigInt(2));
    expect(toMinorUnits("1.4", "RWF")).toBe(BigInt(1));
  });

  it("rounds half-up exactly at the precision boundary", () => {
    expect(toMinorUnits("1.005", "EUR")).toBe(BigInt(101));
    expect(toMinorUnits("1250.50", "USD")).toBe(BigInt(125050));
    expect(toMinorUnits("-0.015", "USD")).toBe(BigInt(-2));
  });

  it("rejects non-decimal text", () => {
    expect(() => toMinorUnits("1,000", "RWF")).toThrow(RangeError);
    expect(() => toMinorUnits("", "RWF")).toThrow(RangeError);
    expect(() => toMinorUnits("1e3", "RWF")).toThrow(RangeError);
  });
});

describe("RWF formatters", () => {
  it("groups thousands and drops the sign", () => {
    expect(formatRwf(1234)).toBe("1,234 RWF");
    expect(formatRwf(-1234567)).toBe("1,234,567 RWF");
    expect(formatRwf(0)).toBe("0 RWF");
  });

  it("always shows direction with a sign", () => {
    expect(formatSignedRwf(7500)).toBe("+7,500 RWF");
    expect(formatSignedRwf(-7500)).toBe("−7,500 RWF");
    expect(formatSignedRwf(0)).toBe("0 RWF");
  });
});

describe("formatMoney", () => {
  it("formats each supported currency from minor units", () => {
    expect(formatMoney(BigInt(500000), "RWF")).toBe("RWF 500,000");
    expect(formatMoney(BigInt(125000), "EUR")).toBe("€1,250.00");
    expect(formatMoney(BigInt(5), "USD")).toBe("$0.05");
    expect(formatMoney(BigInt(-125050), "USD")).toBe("−$1,250.50");
  });
});
