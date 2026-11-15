import { parseDownloadResponse, parseStatementsResponse } from "../parse";

const stmt = {
  id: "s1",
  reference: "OL-ST-2026-000001",
  periodLabel: "1 November 2026 – 30 November 2026",
  scopeLabel: "Consolidated",
  typeLabel: "Standard",
  status: "ready",
  transactionCount: 12,
  generatedAt: "2026-12-01T06:00:00Z",
  isUpdatedVersion: false,
  warningCount: 1,
  totals: [
    { currency: "RWF", openingMinor: 1, closingMinor: 2, creditsMinor: 3, debitsMinor: 4, feesMinor: 5, reconciles: false },
  ],
};

describe("parseStatementsResponse", () => {
  it("parses a list", () => {
    const r = parseStatementsResponse(200, { ok: true, enabled: true, statements: [stmt] });
    expect(r.ok && r.statements[0].totals[0].reconciles).toBe(false);
    expect(r.ok && r.enabled).toBe(true);
  });
  it("reports the feature as off", () => {
    const r = parseStatementsResponse(200, { ok: true, enabled: false, statements: [] });
    expect(r.ok && r.enabled).toBe(false);
  });
  it("drops malformed rows and unknown currencies instead of guessing", () => {
    const r = parseStatementsResponse(200, {
      ok: true,
      statements: [
        { ...stmt, status: "weird" },
        { ...stmt, id: "s2", totals: [{ ...stmt.totals[0], currency: "XYZ" }, stmt.totals[0]] },
        null,
      ],
    });
    expect(r.ok && r.statements.map((s) => s.id)).toEqual(["s2"]);
    expect(r.ok && r.statements[0].totals).toHaveLength(1);
  });
  it("maps failures", () => {
    expect(parseStatementsResponse(404, null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseStatementsResponse(403, null)).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(parseStatementsResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("parseDownloadResponse", () => {
  it("accepts an https link", () => {
    expect(
      parseDownloadResponse(200, { ok: true, download: { url: "https://x.test/a.pdf", filename: "a.pdf", format: "pdf" } }),
    ).toEqual({ ok: true, url: "https://x.test/a.pdf", format: "pdf" });
  });
  it("refuses a non-https link", () => {
    expect(
      parseDownloadResponse(200, { ok: true, download: { url: "http://x.test/a.pdf", format: "pdf" } }),
    ).toMatchObject({ ok: false, reason: "error" });
    expect(
      parseDownloadResponse(200, { ok: true, download: { url: "javascript:alert(1)", format: "pdf" } }),
    ).toMatchObject({ ok: false });
  });
  it("explains not ready and not found", () => {
    expect(parseDownloadResponse(200, { ok: true, download: null, reason: "not_ready" })).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    expect(parseDownloadResponse(200, { ok: true, download: null, reason: "not_found" })).toMatchObject({
      reason: "not_found",
    });
  });
  it("maps HTTP failures", () => {
    expect(parseDownloadResponse(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseDownloadResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
  });
});
