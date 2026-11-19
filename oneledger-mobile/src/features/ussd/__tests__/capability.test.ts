import { buildTelHref, fillUssdTemplate, type ParamSpec } from "../capability";
import { safeSearchTerm, toListItem } from "../queries";
import { firstSentence } from "../text";

// Mirrors web/lib/ussd/capability_test.ts: the app must fill a code exactly as the web does.

const sendSchema: ParamSpec[] = [
  { key: "phone", kind: "phone", required: true, formatRegex: "^07[2389]\\d{7}$" },
  { key: "amount", kind: "amount", required: true, formatRegex: "^[1-9][0-9]{1,6}$" },
];
const T = "*182*1*1*{phone}*{amount}#";

describe("buildTelHref", () => {
  it("encodes # as %23 and leaves * and digits literal", () => {
    expect(buildTelHref("*182#")).toBe("tel:*182%23");
    expect(buildTelHref("*182*1*1*0781234567*5000#")).toBe("tel:*182*1*1*0781234567*5000%23");
  });
});

describe("fillUssdTemplate", () => {
  it("substitutes validated values", () => {
    expect(fillUssdTemplate(T, { phone: "0781234567", amount: "5000" }, sendSchema)).toEqual({
      ok: true,
      display: "*182*1*1*0781234567*5000#",
      dial: "*182*1*1*0781234567*5000#",
    });
  });
  it("returns a literal code as-is", () => {
    const r = fillUssdTemplate("*182#", {}, []);
    expect(r.ok && r.dial).toBe("*182#");
  });
  it("asks for a missing required value", () => {
    const r = fillUssdTemplate(T, { phone: "0781234567" }, sendSchema);
    expect(r).toEqual({ ok: false, error: "Enter an amount." });
  });
  it.each(["078#123", "078*123", "07 8123", "07{8}12"])("rejects %s, which could rewrite the USSD path", (bad) => {
    expect(fillUssdTemplate(T, { phone: bad, amount: "5000" }, sendSchema).ok).toBe(false);
  });
  it("rejects a value failing the per-code regex", () => {
    expect(fillUssdTemplate(T, { phone: "0601234567", amount: "5000" }, sendSchema).ok).toBe(false);
  });
  it("reports an unknown placeholder instead of dropping it", () => {
    expect(fillUssdTemplate("*182*{mystery}#", {}, []).ok).toBe(false);
  });
  it("falls back to the kind rule when a stored regex is invalid", () => {
    const r = fillUssdTemplate("*1*{amount}#", { amount: "500" }, [{ key: "amount", kind: "amount", required: true, formatRegex: "([" }]);
    expect(r.ok && r.dial).toBe("*1*500#");
  });
});

describe("directory queries", () => {
  it("strips characters that are syntax in a PostgREST or() filter", () => {
    expect(safeSearchTerm("mtn,(momo)%")).toBe("mtn  momo");
  });
  it("maps a row, including a provider returned as an array", () => {
    const item = toListItem({
      id: "1",
      slug: "mtn-balance",
      category: "mobile_money",
      display_name_en: "Check balance",
      ussd_template: "*182*6*1#",
      accepts_parameters: false,
      state: "published",
      verified_at: "2026-01-01",
      provider: [{ display_name: "MTN" }],
    });
    expect(item).toMatchObject({ name: "Check balance", provider: "MTN", verified: true, template: "*182*6*1#" });
  });
  it("treats a code with no verified date as unverified", () => {
    const item = toListItem({
      id: "1", slug: "s", category: "other", display_name_en: "X", ussd_template: "*1#",
      accepts_parameters: false, state: "published", verified_at: null, provider: { display_name: "P" },
    });
    expect(item.verified).toBe(false);
  });
});

describe("firstSentence", () => {
  it("keeps just the first sentence", () => {
    expect(firstSentence("Buys MTN airtime for the SIM you are dialling from, paid with MTN Mobile Money. More detail here.")).toBe(
      "Buys MTN airtime for the SIM you are dialling from, paid with MTN Mobile Money.",
    );
  });
  it("returns a single sentence, or text with no full stop, as is", () => {
    expect(firstSentence("Check your balance.")).toBe("Check your balance.");
    expect(firstSentence("Check your balance")).toBe("Check your balance");
  });
  it("copes with nothing", () => {
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence("")).toBeNull();
  });
});

