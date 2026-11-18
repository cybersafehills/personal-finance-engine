import { parseRule, parseRulesResponse, parseSetActiveResponse } from "../parse";

const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  title: "Simba",
  categoryLabel: "Food",
  summary: 'contains "Simba" · out',
  active: true,
  originLabel: "Created by you",
  scopeLabel: null,
  matchedLabel: "Matched 3 times",
  ...over,
});

describe("parseRule", () => {
  it("accepts a well-formed rule and keeps a null scope", () => {
    expect(parseRule(rule())).toMatchObject({ id: "r1", active: true, scopeLabel: null });
    expect(parseRule(rule({ scopeLabel: "One account" }))?.scopeLabel).toBe("One account");
  });

  it("rejects one missing what the screen shows, or with a non-boolean active", () => {
    expect(parseRule(rule({ summary: "" }))).toBeNull();
    expect(parseRule(rule({ active: "yes" }))).toBeNull();
    expect(parseRule(null)).toBeNull();
  });
});

describe("parseRulesResponse", () => {
  it("drops malformed rules and keeps the order", () => {
    const r = parseRulesResponse(200, { ok: true, rules: [rule({ id: "a" }), { id: "x" }, rule({ id: "b" })] });
    expect(r.ok && r.rules.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("maps failures to something the screen can act on", () => {
    expect(parseRulesResponse(404, null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseRulesResponse(401, null)).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseRulesResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
    expect(parseRulesResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("parseSetActiveResponse", () => {
  it("returns the rule as the server now has it", () => {
    const r = parseSetActiveResponse(200, { ok: true, rule: rule({ active: false }) });
    expect(r).toMatchObject({ ok: true, rule: { active: false } });
  });

  it("does not claim success when the answer has no rule", () => {
    expect(parseSetActiveResponse(200, { ok: true })).toMatchObject({ ok: false, reason: "error" });
  });

  it("shows the server's sentence for a refusal and a generic one otherwise", () => {
    expect(
      parseSetActiveResponse(403, { ok: false, error: "forbidden", message: "You can view rules in this Space but not change them." }),
    ).toMatchObject({ ok: false, message: "You can view rules in this Space but not change them." });
    expect(parseSetActiveResponse(500, null)).toMatchObject({ ok: false, reason: "error" });
    expect(parseSetActiveResponse(403, { ok: false, error: "mfa_required" })).toMatchObject({ ok: false, reason: "mfa_required" });
  });
});
