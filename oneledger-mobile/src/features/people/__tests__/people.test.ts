import { confidenceLabel, confidenceNote, flowText, friendlyPeopleError, personIdFromKey, personSummary } from "../display";
import { parsePeopleResponse, parsePersonResponse } from "../parse";

const cp = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", display_name: "Sam", kind: "person", confidence: "high", txn_count: 3,
  first_at: "2026-08-01T00:00:00Z", last_at: "2026-08-09T00:00:00Z",
  currencies: [{ currency: "RWF", sent_minor: "10100", received_minor: "5000", net_minor: "-5100", txn_count: 3 }],
  ...over,
});
const list = (items: unknown[], over: Record<string, unknown> = {}) => ({ ok: true, workspace_id: "w1", total: items.length, limit: 100, offset: 0, unresolved_transactions: 4, counterparties: items, ...over });

describe("parsePeopleResponse", () => {
  it("parses people with bigint money and the unresolved count", () => {
    const r = parsePeopleResponse(200, list([cp()]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unresolved).toBe(4);
    expect(r.people[0].currencies[0].netMinor).toBe(BigInt(-5100));
    expect(flowText(r.people[0].currencies[0])).toBe("You sent RWF 10,100 · You received RWF 5,000");
  });
  it("drops malformed rows and refuses a malformed envelope", () => {
    const r = parsePeopleResponse(200, list([cp(), cp({ kind: "robot" }), cp({ confidence: "sure" }), cp({ txn_count: -1 }), cp({ display_name: "" })]));
    expect(r.ok && r.people.length).toBe(1);
    expect(parsePeopleResponse(200, list([], { total: "x" })).ok).toBe(false);
    expect(parsePeopleResponse(200, { ok: true }).ok).toBe(false);
  });
  it("skips unsupported currencies inside a person, keeps the rest", () => {
    const r = parsePeopleResponse(200, list([cp({ currencies: [{ currency: "GBP", sent_minor: "1", received_minor: "0", net_minor: "-1", txn_count: 1 }, cp().currencies[0]] })]));
    expect(r.ok && r.people[0].currencies.map((c) => c.currency)).toEqual(["RWF"]);
  });
  it("maps failures", () => {
    const f = (s: number) => { const r = parsePeopleResponse(s, { ok: false }); return r.ok ? null : r.reason; };
    expect([f(404), f(401), f(403), f(500)]).toEqual(["unavailable", "unauthorized", "mfa_required", "error"]);
  });
});

describe("parsePersonResponse", () => {
  const tx = (over: Record<string, unknown> = {}) => ({ id: "t1", direction: "out", transaction_type: "send_money", amount_minor: "-10100", currency: "RWF", category: "Food", counterparty_name: "SAM RAW", account_id: "a1", status: "settled", occurred_at: "2026-08-05T08:00:00Z", ...over });
  const detail = (over: Record<string, unknown> = {}) => ({
    ok: true, workspace_id: "w1", counterparty: cp(), merged_from: [{ id: "m1", display_name: "Sam (old number)" }], total_transactions: 3, limit: 50, offset: 0,
    transactions: [tx(), tx({ id: "bad", amount_minor: 3 })], ...over,
  });
  it("parses the person, what was merged into it and its transactions", () => {
    const r = parsePersonResponse(200, detail());
    expect(r.ok).toBe(true);
    if (!r.ok || !("detail" in r)) return;
    expect(r.detail.mergedFrom).toEqual([{ id: "m1", displayName: "Sam (old number)" }]);
    expect(r.detail.transactions.map((t) => t.id)).toEqual(["t1"]);
    expect(r.detail.totalTransactions).toBe(3);
  });
  it("a counterparty with no transactions yet still parses (empty currencies)", () => {
    const r = parsePersonResponse(200, detail({ counterparty: { id: "11111111-1111-4111-8111-111111111111", display_name: "New", kind: "unknown", confidence: "low", currencies: [] } }));
    expect(r.ok).toBe(true);
  });
  it("a merged person points to its survivor (only a real uuid is followed)", () => {
    const sid = "22222222-2222-4222-8222-222222222222";
    const r = parsePersonResponse(409, { ok: false, error: `merged_into:${sid}` });
    expect(!r.ok && "survivorId" in r && r.survivorId).toBe(sid);
    const bad = parsePersonResponse(409, { ok: false, error: "merged_into:../../etc" });
    expect(!bad.ok && "survivorId" in bad).toBe(false);
  });
});

describe("wording and mapping", () => {
  it("states plainly when a group is by name only", () => {
    expect(confidenceNote("low")).toMatch(/name only/);
    expect(confidenceNote("high")).toBeNull();
    expect(confidenceLabel("user_confirmed")).toBe("You confirmed this");
  });
  it("summary is one readable sentence for screen readers", () => {
    const r = parsePeopleResponse(200, list([cp()]));
    expect(r.ok && personSummary(r.people[0])).toBe("Sam, Person, You sent RWF 10,100 · You received RWF 5,000, 3 transactions");
  });
  it("database refusals become fixed friendly sentences and never echo raw text", () => {
    expect(friendlyPeopleError("split_would_empty")).toMatch(/Rename it instead/);
    expect(friendlyPeopleError("ERROR: merge_state_changed")).toMatch(/Undo the later change/);
    expect(friendlyPeopleError('relation "counterparties" does not exist secretvalue')).not.toMatch(/secretvalue/);
  });
  it("only an id-keyed group links to a person page", () => {
    expect(personIdFromKey("id:11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    expect(personIdFromKey("name:sam")).toBeNull();
    expect(personIdFromKey("id:../x")).toBeNull();
  });
});
