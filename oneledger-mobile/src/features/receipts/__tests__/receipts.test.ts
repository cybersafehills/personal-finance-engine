import { formatToken, kwhText, parseReceiptRow, parseRevealResponse } from "../receipts";

describe("kwhText", () => {
  it("shows integer thousandths exactly", () => {
    expect(kwhText(11900)).toBe("11.9");
    expect(kwhText(23805)).toBe("23.805");
    expect(kwhText(7000)).toBe("7");
    expect(kwhText(500)).toBe("0.5");
    expect(kwhText(1)).toBe("0.001");
  });
});

describe("parseReceiptRow", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "r1", status: "matched", kwh_milli: 11900, meter_last4: "0001", has_token: true, ...over });
  it("parses a matched receipt and never exposes anything beyond the last 4 of the meter", () => {
    expect(parseReceiptRow(row())).toEqual({ id: "r1", kwh: "11.9", meterLast4: "0001", hasToken: true });
    expect(parseReceiptRow(row({ meter_last4: "12345678901" }))?.meterLast4).toBeNull();
    expect(parseReceiptRow(row({ has_token: false }))?.hasToken).toBe(false);
  });
  it("refuses anything that isn't a matched, well-formed receipt", () => {
    for (const bad of [null, [], row({ status: "unmatched" }), row({ kwh_milli: 0 }), row({ kwh_milli: 1.5 }), row({ id: "" }), row({ kwh_milli: "11900" })]) {
      expect(parseReceiptRow(bad)).toBeNull();
    }
  });
});

describe("token", () => {
  it("groups digits in fours", () => {
    expect(formatToken("00001111222233334444")).toBe("0000-1111-2222-3333-4444");
    expect(formatToken("0000-1111")).toBe("0000-1111");
  });
  it("only a well-formed token is ever accepted from the server; failures map to fixed sentences", () => {
    expect(parseRevealResponse(200, { ok: true, token: "0000-1111-2222-3333-4444" })).toEqual({ ok: true, token: "0000-1111-2222-3333-4444" });
    for (const body of [{ ok: true, token: "<script>" }, { ok: true, token: "12345678901234567890" }, { ok: true }, null]) {
      expect(parseRevealResponse(200, body).ok).toBe(false);
    }
    const f = (s: number) => { const r = parseRevealResponse(s, { ok: false }); return r.ok ? "" : r.message; };
    expect(f(403)).toMatch(/two-step/);
    expect(f(404)).toMatch(/isn't available/);
    expect(f(401)).toMatch(/sign in/);
    expect(f(500)).toMatch(/Check your connection/);
    expect(parseRevealResponse(422, { ok: false, message: "You've viewed a lot of tokens." })).toEqual({ ok: false, message: "You've viewed a lot of tokens." });
  });
});
