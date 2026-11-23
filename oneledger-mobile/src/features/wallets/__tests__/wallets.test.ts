import { asOfText, balanceText, parseBalanceInput, reasonText, STATUS_LABEL, STATUS_MEANING } from "../display";
import { parseWalletsResponse } from "../parse";

const acct = (over: Record<string, unknown> = {}) => ({
  id: "a1", name: "MTN MoMo", provider: "mtn_momo", currency: "RWF", is_primary: true, latest_txn_at: "2026-08-08T08:00:00Z",
  balance: { status: "estimated", amount_minor: "78900", as_of: "2026-08-07T08:00:00Z", basis: "provider_reported", reasons: ["activity_since_baseline"] },
  ...over,
});
const body = (accounts: unknown[]) => ({ ok: true, workspace_id: "w1", accounts });

describe("parseWalletsResponse", () => {
  it("parses a wallet with an honest balance", () => {
    const r = parseWalletsResponse(200, body([acct()]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.wallets[0];
    expect(w.balance.amountMinor).toBe(BigInt(78900));
    expect(balanceText(w)).toBe("RWF 78,900");
    expect(asOfText(w)).toMatch(/^As of /);
  });

  it("'unavailable' never carries a number, and a number never comes without a supporting status", () => {
    const none = acct({ balance: { status: "unavailable", amount_minor: null, as_of: null, basis: null, reasons: ["no_baseline"] } });
    const r = parseWalletsResponse(200, body([none]));
    expect(r.ok && balanceText(r.wallets[0])).toBe("No balance yet");
    expect(r.ok && asOfText(r.wallets[0])).toBeNull();
    // contradictory payloads are dropped, not displayed
    const lying = acct({ balance: { status: "unavailable", amount_minor: "5", as_of: null, basis: null, reasons: [] } });
    const missing = acct({ balance: { status: "confirmed", amount_minor: null, as_of: null, basis: null, reasons: [] } });
    const r2 = parseWalletsResponse(200, body([lying, missing, acct({ id: "ok" })]));
    expect(r2.ok && r2.wallets.map((w) => w.id)).toEqual(["ok"]);
  });

  it("drops unknown currencies/statuses and keeps known reasons only", () => {
    const r = parseWalletsResponse(200, body([
      acct({ id: "gbp", currency: "GBP" }),
      acct({ id: "st", balance: { status: "magic", amount_minor: "1", as_of: null, basis: null, reasons: [] } }),
      acct({ id: "ok", balance: { status: "stale", amount_minor: "10", as_of: "2026-08-01T00:00:00Z", basis: "manual", reasons: ["baseline_old", "made_up"] } }),
    ]));
    expect(r.ok && r.wallets.map((w) => w.id)).toEqual(["ok"]);
    expect(r.ok && r.wallets[0].balance.reasons).toEqual(["baseline_old"]);
  });

  it("maps failures", () => {
    const f = (s: number) => {
      const r = parseWalletsResponse(s, { ok: false });
      return r.ok ? null : r.reason;
    };
    expect([f(404), f(401), f(403), f(500)]).toEqual(["unavailable", "unauthorized", "mfa_required", "error"]);
  });
});

describe("wording", () => {
  it("a manual balance is never called Confirmed by any label", () => {
    expect(STATUS_LABEL.estimated).toBe("Estimated");
    expect(STATUS_MEANING.estimated).toMatch(/may differ/);
    expect(reasonText("user_stated_baseline")).toMatch(/you entered/);
  });
});

describe("parseBalanceInput", () => {
  it("parses whole and decimal amounts exactly", () => {
    expect(parseBalanceInput("78,900", 0)).toBe(BigInt(78900));
    expect(parseBalanceInput("12.5", 2)).toBe(BigInt(1250));
    expect(parseBalanceInput("0", 0)).toBe(BigInt(0));
  });
  it("never silently rounds a balance, and rejects junk", () => {
    expect(parseBalanceInput("10.5", 0)).toBeNull(); // would drop a real fraction
    expect(parseBalanceInput("10.0", 0)).toBe(BigInt(10)); // trailing zeros are harmless
    expect(parseBalanceInput("1.005", 2)).toBeNull();
    for (const bad of ["", "abc", "-5", "1e3", "1.2.3"]) expect(parseBalanceInput(bad, 0)).toBeNull();
  });
});

it.each(["USD", "EUR"])("wallet amounts name %s explicitly", (currency) => {
  const result = parseWalletsResponse(200, body([acct({ currency, balance: { status: "confirmed", amount_minor: "1234", as_of: "2026-11-18T12:00:00Z", basis: "provider_reported", reasons: [] } })]));
  expect(result.ok && balanceText(result.wallets[0])).toBe(`${currency} 12.34`);
});
