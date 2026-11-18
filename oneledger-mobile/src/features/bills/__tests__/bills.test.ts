import { parseBillResponse, parseBillsEnabled, parseBillsResponse, parseOriginalResponse } from "../parse";

const item = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  filename: "acme.pdf",
  status: "needs_review",
  statusLabel: "Needs review",
  tone: "accent",
  uploadedLabel: "Monday, August 24, 2026 at 12:30 AM",
  pageCount: 2,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...item(),
  typeLabel: "PDF",
  sizeLabel: "2.0 KB",
  extraction: { fields: [{ key: "total", label: "Total", value: "RWF 5,000" }], lineItems: [] },
  checks: { blocking: 1, outOfDate: false, findings: [] },
  history: [],
  canViewOriginal: true,
  ...over,
});

describe("parseBillsEnabled", () => {
  it("is on only for an explicit true", () => {
    expect(parseBillsEnabled(200, { ok: true, config: { bills: true } })).toBe(true);
    expect(parseBillsEnabled(200, { ok: true, config: { bills: false } })).toBe(false);
    expect(parseBillsEnabled(200, { ok: true, config: {} })).toBe(false);
    expect(parseBillsEnabled(404, { ok: true, config: { bills: true } })).toBe(false);
    expect(parseBillsEnabled(200, null)).toBe(false);
  });
});

describe("parseBillsResponse", () => {
  it("keeps well-formed documents, drops malformed ones, and carries hasMore", () => {
    const r = parseBillsResponse(200, { ok: true, bills: [item(), { id: "x" }], hasMore: true });
    expect(r).toMatchObject({ ok: true, hasMore: true });
    if (r.ok) expect(r.bills.map((b) => b.id)).toEqual(["b1"]);
  });

  it("falls back to a neutral tone for an unknown one", () => {
    const r = parseBillsResponse(200, { ok: true, bills: [item({ tone: "loud" })], hasMore: false });
    if (r.ok) expect(r.bills[0].tone).toBe("neutral");
  });

  it("maps failures to something the screen can act on", () => {
    expect(parseBillsResponse(404, { ok: false })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseBillsResponse(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseBillsResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
    expect(parseBillsResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("parseBillResponse", () => {
  it("parses a full detail", () => {
    const r = parseBillResponse(200, { ok: true, bill: detail() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bill.extraction?.fields[0].value).toBe("RWF 5,000");
      expect(r.bill.checks?.blocking).toBe(1);
      expect(r.bill.history).toEqual([]);
    }
  });

  it("keeps null as null: extraction off, no checks, no permission for history", () => {
    const r = parseBillResponse(200, { ok: true, bill: detail({ extraction: null, checks: null, history: null }) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bill.extraction).toBeNull();
      expect(r.bill.checks).toBeNull();
      expect(r.bill.history).toBeNull();
    }
  });

  it("treats 404 as not found, not as 'unavailable'", () => {
    expect(parseBillResponse(404, { ok: false, error: "not_found" })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rejects a malformed document", () => {
    expect(parseBillResponse(200, { ok: true, bill: { id: "b1" } })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("canViewOriginal", () => {
  it("is true only for an explicit true", () => {
    const get = (v: unknown) => {
      const r = parseBillResponse(200, { ok: true, bill: detail({ canViewOriginal: v }) });
      return r.ok && r.bill.canViewOriginal;
    };
    expect(get(true)).toBe(true);
    expect(get(false)).toBe(false);
    expect(get("true")).toBe(false);
    expect(get(undefined)).toBe(false);
  });
});

describe("parseOriginalResponse", () => {
  it("accepts only an https link", () => {
    expect(parseOriginalResponse(200, { ok: true, download: { url: "https://x.test/f?t=1" } })).toEqual({ ok: true, url: "https://x.test/f?t=1" });
    expect(parseOriginalResponse(200, { ok: true, download: { url: "http://x.test/f" } })).toMatchObject({ ok: false, reason: "error" });
    expect(parseOriginalResponse(200, { ok: true, download: null })).toMatchObject({ ok: false, reason: "error" });
  });

  it("tells a permission refusal from a missing document", () => {
    expect(parseOriginalResponse(403, { ok: false, error: "forbidden" })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(parseOriginalResponse(403, { ok: false, error: "mfa_required" })).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(parseOriginalResponse(404, { ok: false })).toMatchObject({ ok: false, reason: "not_found" });
    expect(parseOriginalResponse(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseOriginalResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
  });
});
