import { barFraction, countLabel, grandTotal, needsReview, shareLabel } from "../display";
import { parseCategoriesResponse } from "../parse";

const cat = (category: string, totalRwf: number, transactionCount = 1) => ({ category, totalRwf, transactionCount });

describe("parseCategoriesResponse", () => {
  it("parses the totals in the order given", () => {
    const r = parseCategoriesResponse(200, {
      ok: true,
      truncated: false,
      categories: [cat("Food", 5000, 3), cat("Uncategorized", 1200)],
    });
    expect(r.ok && r.categories.map((c) => c.category)).toEqual(["Food", "Uncategorized"]);
    expect(r.ok && r.truncated).toBe(false);
  });

  it("carries the truncated flag, and defaults to complete", () => {
    expect((parseCategoriesResponse(200, { ok: true, categories: [], truncated: true }) as { truncated: boolean }).truncated).toBe(true);
    expect((parseCategoriesResponse(200, { ok: true, categories: [] }) as { truncated: boolean }).truncated).toBe(false);
  });

  it("drops malformed rows instead of showing wrong figures", () => {
    const r = parseCategoriesResponse(200, {
      ok: true,
      categories: [cat("Food", 100), { category: "", totalRwf: 5, transactionCount: 1 }, { category: "X", totalRwf: "9", transactionCount: 1 }, null, cat("Rent", Number.NaN)],
    });
    expect(r.ok && r.categories.map((c) => c.category)).toEqual(["Food"]);
  });

  it("maps failures", () => {
    expect(parseCategoriesResponse(404, null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseCategoriesResponse(403, null)).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(parseCategoriesResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("display", () => {
  it("sums the grand total", () => {
    expect(grandTotal([cat("A", 100), cat("B", 250)])).toBe(350);
    expect(grandTotal([])).toBe(0);
  });

  it("measures each bar against the total, with a visible floor and no division by zero", () => {
    expect(barFraction(50, 200)).toBe(0.25);
    expect(barFraction(1, 100_000)).toBe(0.02); // a sliver, never zero
    expect(barFraction(500, 200)).toBe(1); // clamped
    expect(barFraction(0, 200)).toBe(0);
    expect(barFraction(10, 0)).toBe(0);
  });

  it("describes counts and shares in words", () => {
    expect(countLabel(1)).toBe("1 transaction");
    expect(countLabel(12)).toBe("12 transactions");
    expect(shareLabel(250, 1000)).toBe("25% of spending");
    expect(shareLabel(2, 1000)).toBe("under 1% of spending");
    expect(shareLabel(5, 0)).toBe("");
  });

  it("flags only Uncategorized as needing review", () => {
    expect(needsReview("Uncategorized")).toBe(true);
    expect(needsReview("Food")).toBe(false);
  });
});
