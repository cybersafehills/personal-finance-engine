import {
  parseOfferResponse,
  parsePartResponse,
  parsePlanResponse,
  parsePrefsResponse,
  parseStopResponse,
} from "../parse";

const offer = {
  kind: "capacity",
  networkSlug: "ekash",
  totalMinor: "25000000",
  parts: [
    { index: 1, amountMinor: "8333334", feeMinor: "20" },
    { index: 2, amountMinor: "8333333", feeMinor: "20" },
    { index: 3, amountMinor: "8333333", feeMinor: "20" },
  ],
  singleFeeMinor: null,
  plannedFeeMinor: "60",
  savingsMinor: null,
  feeBasis: "verified_tariff",
  capacityMinor: "10000000",
  source: { label: "MTN Rwanda, MoMo Tariffs page", url: "https://www.mtn.co.rw/momo-tarrif/", asOf: "2026-11-24T10:00:00Z" },
};
const intent = { id: "i1", state: "draft", paymentType: "pay_person", amountMinor: 8333334, splitPlanId: "p1", splitIndex: 1 };

describe("parseOfferResponse", () => {
  it("reads an offer, keeping money as digit strings", () => {
    const r = parseOfferResponse(200, { ok: true, offer });
    expect(r.ok && r.offer?.parts.map((p) => p.amountMinor)).toEqual(["8333334", "8333333", "8333333"]);
    expect(r.ok && r.offer?.feeBasis).toBe("verified_tariff");
  });
  it("treats no offer as a normal answer, not a failure", () => {
    expect(parseOfferResponse(200, { ok: true, offer: null })).toEqual({ ok: true, offer: null });
  });
  it("never guesses: an unreadable or one-part offer is no offer", () => {
    expect(parseOfferResponse(200, { ok: true, offer: { ...offer, parts: [offer.parts[0]] } })).toEqual({ ok: true, offer: null });
    expect(parseOfferResponse(200, { ok: true, offer: { ...offer, totalMinor: "-5" } })).toEqual({ ok: true, offer: null });
    expect(parseOfferResponse(200, { ok: true, offer: { ...offer, kind: "mystery" } })).toEqual({ ok: true, offer: null });
  });
  it("fails on errors, passing a safe server message through", () => {
    expect(parseOfferResponse(403, { ok: false, error: "feature_disabled", message: "Splits are not turned on for your account." })).toMatchObject({
      ok: false,
      reason: "unavailable",
      code: "feature_disabled",
    });
    expect(parseOfferResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("parsePartResponse (start and next)", () => {
  it("reads the part's payment and its plan", () => {
    const r = parsePartResponse(200, { ok: true, planId: "p1", index: 2, intent });
    expect(r.ok && [r.planId, r.index, r.intent.splitPlanId, r.intent.splitIndex]).toEqual(["p1", 2, "p1", 1]);
  });
  it("surfaces the 409 reason so the screen can say why part 2 isn't ready", () => {
    expect(parsePartResponse(409, { ok: false, error: "waiting", message: "Finish the previous part first: confirm that it went through." })).toMatchObject({
      ok: false,
      code: "waiting",
      message: "Finish the previous part first: confirm that it went through.",
    });
  });
});

describe("parsePlanResponse", () => {
  const plan = {
    id: "p1",
    kind: "capacity",
    totalMinor: "25000000",
    plannedPartsMinor: ["8333334", "8333333", "8333333"],
    feeBasis: "published_maximum",
    stopped: false,
    parts: [{ index: 1, intentId: "i1", amountMinor: "8333334", state: "successful" }],
    next: { status: "ready", index: 2, amountMinor: "8333333" },
    remainingMinor: "16666666",
  };
  it("reads the plan and what comes next", () => {
    const r = parsePlanResponse(200, { ok: true, plan });
    expect(r.ok && r.plan.next).toEqual({ status: "ready", index: 2, amountMinor: "8333333" });
  });
  it("rejects a plan it can't fully read", () => {
    expect(parsePlanResponse(200, { ok: true, plan: { ...plan, next: { status: "go" } } }).ok).toBe(false);
    expect(parsePlanResponse(404, { ok: false, error: "not_found", message: "That split couldn't be found." }).ok).toBe(false);
  });
});

describe("parsePrefsResponse / parseStopResponse", () => {
  it("reads the choice, and refuses a threshold it doesn't know", () => {
    expect(parsePrefsResponse(200, { ok: true, preferences: { feeSavingEnabled: false, threshold: "balanced" } })).toEqual({
      ok: true,
      preferences: { feeSavingEnabled: false, threshold: "balanced" },
      levels: {},
    });
    // The figure behind each level is the server's; anything unreadable is dropped, never guessed.
    const withLevels = parsePrefsResponse(200, {
      ok: true,
      preferences: { feeSavingEnabled: true, threshold: "bigger" },
      thresholds: [
        { value: "any", minSavingPerExtraPartMinor: "0" },
        { value: "balanced", minSavingPerExtraPartMinor: "100" },
        { value: "bigger", minSavingPerExtraPartMinor: "500" },
        { value: "huge", minSavingPerExtraPartMinor: "9" },
        { value: "any", minSavingPerExtraPartMinor: "-1" },
      ],
    });
    expect(withLevels.ok && withLevels.levels).toEqual({ any: "0", balanced: "100", bigger: "500" });
    expect(parsePrefsResponse(200, { ok: true, preferences: { feeSavingEnabled: true, threshold: "huge" } }).ok).toBe(false);
  });
  it("only a confirmed stop is a stop", () => {
    expect(parseStopResponse(200, { ok: true, stopped: true }).ok).toBe(true);
    expect(parseStopResponse(200, { ok: true }).ok).toBe(false);
  });
});
