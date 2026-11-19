import { isStale, payPhase, phaseCopy, STALE_AFTER_MS } from "../status";

describe("payPhase", () => {
  it.each([["initiated"], ["awaiting_verification"], ["processing"]])("%s is waiting", (s) => expect(payPhase(s)).toBe("waiting"));
  it.each([["failed"], ["expired"], ["reversed"]])("%s is a failure", (s) => expect(payPhase(s)).toBe("failure"));
  it("only 'successful' is a success", () => {
    expect(payPhase("successful")).toBe("success");
    for (const s of ["draft", "cancelled", "requires_reconciliation", "anything_new"]) expect(payPhase(s)).toBeNull();
  });
});

describe("phaseCopy", () => {
  const amount = "5,000 RWF";
  it("distinguishes provider-confirmed from self-confirmed", () => {
    expect(phaseCopy("success", { state: "successful", verified: true }, amount, "Amy")).toEqual({
      title: "Money sent",
      body: "5,000 RWF to Amy - confirmed by your provider.",
    });
    expect(phaseCopy("success", { state: "successful", verified: false }, amount, null).title).toBe("Marked as sent");
  });
  it("is honest about a payment that expired or was reversed", () => {
    expect(phaseCopy("failure", { state: "expired", verified: false }, amount, null).body).toMatch(/No money has been recorded as sent/);
    expect(phaseCopy("failure", { state: "reversed", verified: false }, amount, null).title).toBe("Payment reversed");
  });
});

describe("isStale", () => {
  const at = "2026-11-19T10:00:00Z";
  const t = Date.parse(at);
  it("asks the person only after the wait", () => {
    expect(isStale(at, t + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(at, t + STALE_AFTER_MS)).toBe(true);
    expect(isStale("not a date", t)).toBe(false);
  });
});
