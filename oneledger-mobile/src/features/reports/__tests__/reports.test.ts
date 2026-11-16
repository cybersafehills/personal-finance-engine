import { countLabel, inRows, shareFraction, signedPercent, toneColor, toneWord } from "../display";
import { parseReportDownloadResponse, parseReportResponse, parseReportsResponse } from "../parse";

const item = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  dateLabel: "August 24, 2026",
  status: "generated",
  statusLabel: "Generated",
  generatedLabel: "Aug 25, 12:07 AM",
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  status: "generated",
  statusLabel: "Generated",
  dateLabel: "August 24, 2026",
  timezone: "Africa/Kigali",
  generatedLabel: "Aug 25, 12:07 AM",
  errorMessage: null,
  hasDocument: true,
  snapshot: {
    closingBalanceRwf: 120000,
    netMovementRwf: 20000,
    moneyReceivedRwf: 50000,
    moneySpentRwf: 30000,
    feesRwf: 400,
    transactionCount: 7,
    largestOutflowRwf: 15000,
    largestInflowRwf: null,
  },
  categories: [{ category: "Food", amountRwf: 20000, transactionCount: 4, percentOfSpending: 66.6 }],
  budget: {
    allocations: [
      { type: "WANTS", label: "Wants", targetMinor: 100000, actualMinor: 82000, remainingMinor: 18000, percentConsumed: 82, projectedMinor: null, status: "watch" },
    ],
  },
  trends: [{ label: "Spending", valueLabel: "30,000 RWF", changePercent: 20, tone: "negative" }],
  alerts: [{ id: "a1", tone: "attention", message: "Total spending today (30,000 RWF) was higher than usual." }],
  forecast: { projectedMonthEndSpendRwf: 31001, disclaimer: "A projection." },
  insights: { summary: "Steady.", observations: ["Food led."] },
  ...over,
});

describe("parseReportsResponse", () => {
  it("parses the list in the order given", () => {
    const r = parseReportsResponse(200, { ok: true, reports: [item(), item({ id: "r2", dateLabel: "August 23, 2026" })] });
    expect(r.ok && r.reports.map((x) => x.id)).toEqual(["r1", "r2"]);
  });

  it("drops malformed rows instead of showing something wrong", () => {
    const r = parseReportsResponse(200, { ok: true, reports: [item(), { id: "x" }, null, item({ dateLabel: "" })] });
    expect(r.ok && r.reports).toHaveLength(1);
  });

  it("maps failures", () => {
    expect(parseReportsResponse(404, null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseReportsResponse(403, null)).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(parseReportsResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("parseReportResponse", () => {
  it("parses a full report", () => {
    const r = parseReportResponse(200, { ok: true, report: report() });
    expect(r.ok && r.report.snapshot?.closingBalanceRwf).toBe(120000);
    expect(r.ok && r.report.budget?.allocations[0].label).toBe("Wants");
    expect(r.ok && r.report.alerts[0].tone).toBe("attention");
    expect(r.ok && r.report.insights?.observations).toEqual(["Food led."]);
  });

  it("is not found when the server says there is no such report", () => {
    expect(parseReportResponse(200, { ok: true, report: null, reason: "not_found" })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("keeps a report with no snapshot yet (not generated) and a null closing balance", () => {
    const pending = parseReportResponse(200, { ok: true, report: report({ snapshot: null, hasDocument: false }) });
    expect(pending.ok && [pending.report.snapshot, pending.report.hasDocument]).toEqual([null, false]);
    const noBalance = parseReportResponse(200, { ok: true, report: report({ snapshot: { ...report().snapshot, closingBalanceRwf: null } }) });
    expect(noBalance.ok && noBalance.report.snapshot?.closingBalanceRwf).toBeNull();
  });

  it("drops malformed parts without losing the rest", () => {
    const r = parseReportResponse(200, {
      ok: true,
      report: report({
        categories: [{ category: "Food", amountRwf: "9", transactionCount: 1, percentOfSpending: 1 }, report().categories[0]],
        trends: [{ label: "X", valueLabel: "1", changePercent: 1, tone: "sparkly" }, report().trends[0]],
        budget: { allocations: [{ type: "WANTS", label: "Wants", status: "mystery", targetMinor: 1, actualMinor: 1, remainingMinor: 0 }] },
        alerts: [{ id: "", message: "x" }, report().alerts[0]],
      }),
    });
    expect(r.ok && r.report.categories).toHaveLength(1);
    expect(r.ok && r.report.trends).toHaveLength(1);
    expect(r.ok && r.report.budget).toBeNull(); // every allocation was invalid
    expect(r.ok && r.report.alerts).toHaveLength(1);
  });

  it("treats an unknown alert tone as neutral rather than alarming", () => {
    const r = parseReportResponse(200, { ok: true, report: report({ alerts: [{ id: "a", tone: "weird", message: "m" }] }) });
    expect(r.ok && r.report.alerts[0].tone).toBe("neutral");
  });

  it("maps failures", () => {
    expect(parseReportResponse(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseReportResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
    expect(parseReportResponse(200, { ok: true, report: { id: "x" } })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("parseReportDownloadResponse", () => {
  it("accepts only an https link", () => {
    expect(parseReportDownloadResponse(200, { ok: true, download: { url: "https://x.test/r.pdf" } })).toEqual({ ok: true, url: "https://x.test/r.pdf" });
    for (const url of ["http://x.test/r.pdf", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(parseReportDownloadResponse(200, { ok: true, download: { url } })).toMatchObject({ ok: false });
    }
  });

  it("explains not found and not ready", () => {
    expect(parseReportDownloadResponse(200, { ok: true, download: null, reason: "not_found" })).toMatchObject({ reason: "not_found" });
    expect(parseReportDownloadResponse(200, { ok: true, download: null, reason: "not_ready" })).toMatchObject({ reason: "not_ready" });
    expect(parseReportDownloadResponse(200, { ok: true, download: null, reason: "failed" })).toMatchObject({ reason: "error" });
  });
});

describe("display", () => {
  it("writes signed percentages with a real minus sign and no sign for zero", () => {
    expect([signedPercent(20), signedPercent(-5.4), signedPercent(0), signedPercent(0.2)]).toEqual(["+20%", "−5%", "0%", "0%"]);
  });

  it("colours spending-up amber and income-up green, and spells the tone out for screen readers", () => {
    expect([toneColor("positive"), toneColor("negative"), toneColor("neutral")]).toEqual(["moneyPositive", "attention", "textMuted"]);
    expect(toneWord("negative", 20)).toBe("up, worth a look");
    expect(toneWord("positive", -20)).toBe("down, good");
    expect(toneWord("neutral", 40)).toBe("");
    expect(toneWord("negative", null)).toBe("");
    expect(toneWord("negative", 0)).toBe("");
  });

  it("gives a tiny share a visible sliver, and nothing for none", () => {
    expect(shareFraction(50)).toBe(0.5);
    expect(shareFraction(0.1)).toBe(0.02);
    expect(shareFraction(0)).toBe(0);
    expect(shareFraction(250)).toBe(1);
    expect(shareFraction(Number.NaN)).toBe(0);
  });

  it("counts and groups", () => {
    expect([countLabel(1), countLabel(2)]).toEqual(["1 transaction", "2 transactions"]);
    expect(inRows([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4], [5]]);
    expect(inRows([])).toEqual([]);
  });
});
