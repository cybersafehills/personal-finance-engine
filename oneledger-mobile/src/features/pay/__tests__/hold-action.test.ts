import {
  DEFAULT_HOLD_PREFS,
  HOLD_ACTIONS,
  holdHint,
  normalizeHoldPrefs,
  resolveHoldTarget,
} from "../hold-action";

const all = { pay: true, assistedPay: true, ussdDirectory: true, scanToPay: true, trustedRecipients: true, paymentRequests: true };

describe("hold action", () => {
  it("defaults to Scan to pay after half a second", () => {
    expect(DEFAULT_HOLD_PREFS).toEqual({ action: "scan", durationMs: 500 });
    expect(resolveHoldTarget(DEFAULT_HOLD_PREFS, all)).toEqual({ pathname: "/scan" });
  });

  it("goes to whichever action was chosen", () => {
    const go = (action: Parameters<typeof resolveHoldTarget>[0]["action"]) => resolveHoldTarget({ action, durationMs: 500 }, all);
    expect(go("request")).toEqual({ pathname: "/request-new" });
    expect(go("person")).toEqual({ pathname: "/pay-new", params: { type: "pay_person" } });
    expect(go("merchant")).toEqual({ pathname: "/pay-new", params: { type: "pay_merchant" } });
    expect(go("ussd")).toEqual({ pathname: "/ussd" });
    expect(go("sheet")).toBeNull();
  });

  it("falls back to the sheet when the account can't use the chosen action", () => {
    expect(resolveHoldTarget(DEFAULT_HOLD_PREFS, { ...all, scanToPay: false })).toBeNull();
    expect(resolveHoldTarget(DEFAULT_HOLD_PREFS, null)).toBeNull();
    expect(resolveHoldTarget({ action: "person", durationMs: 500 }, { ...all, assistedPay: false })).toBeNull();
  });

  it("turns anything stored into a valid setting", () => {
    expect(normalizeHoldPrefs(null)).toEqual(DEFAULT_HOLD_PREFS);
    expect(normalizeHoldPrefs("junk")).toEqual(DEFAULT_HOLD_PREFS);
    expect(normalizeHoldPrefs({ action: "nope", durationMs: 99999 })).toEqual(DEFAULT_HOLD_PREFS);
    expect(normalizeHoldPrefs({ action: "ussd", durationMs: 1000 })).toEqual({ action: "ussd", durationMs: 1000 });
  });

  it("offers every action exactly once", () => {
    expect(new Set(HOLD_ACTIONS.map((a) => a.id)).size).toBe(HOLD_ACTIONS.length);
  });

  it("says what a hold does only when it does something", () => {
    expect(holdHint(DEFAULT_HOLD_PREFS, all)).toBe("Tap for Pay and Services. Hold to scan to pay.");
    expect(holdHint(DEFAULT_HOLD_PREFS, { ...all, scanToPay: false })).toBe("Opens Pay and Services");
  });
});
