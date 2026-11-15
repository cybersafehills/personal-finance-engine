import { actionKey, canPickCategory, kindLabel, transactionIdFromHref, webUrl } from "../display";
import { parseInbox, parseInboxResponse } from "../parse";

const TX = "11111111-2222-3333-4444-555555555555";

const item = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  kind: "category_review",
  priority: "high",
  title: "Kigali Fresh",
  description: "Needs a category",
  href: `/transactions/${TX}`,
  actionableSince: "2026-11-01T00:00:00Z",
  affectedCount: 1,
  actions: [
    { type: "confirm_category", label: "Confirm", transactionId: TX },
    { type: "dismiss_category", label: "Dismiss", transactionId: TX },
  ],
  ...over,
});

describe("parseInbox", () => {
  it("keeps valid items and recomputes the counts from them", () => {
    const inbox = parseInbox({
      items: [item(), item({ id: "i2", priority: "critical" }), item({ id: "i3", priority: "normal" })],
    });
    expect(inbox?.total).toBe(3);
    expect(inbox?.criticalCount).toBe(1);
    expect(inbox?.highCount).toBe(1);
  });

  it("skips malformed items instead of failing the whole inbox", () => {
    const inbox = parseInbox({
      items: [item(), null, "x", item({ id: "" }), item({ priority: "urgent" }), item({ href: undefined })],
    });
    expect(inbox?.items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("keeps only the actions the app can run, and only well-formed ones", () => {
    const inbox = parseInbox({
      items: [
        item({
          actions: [
            { type: "confirm_category", label: "Confirm", transactionId: TX },
            { type: "assign_to_me", label: "Mine", transactionId: TX },
            { type: "accept_rule", label: "Rule", suggestionKey: "k" },
            { type: "merge_duplicate", label: "Merge", duplicateId: "a" },
            { type: "merge_duplicate", label: "Merge", duplicateId: "a", canonicalId: "b" },
            { type: "dismiss_duplicate", label: "", transactionId: TX },
          ],
        }),
      ],
    });
    expect(inbox?.items[0].actions.map((a) => a.type)).toEqual(["confirm_category", "merge_duplicate"]);
  });

  it("rejects a payload without an items array", () => {
    expect(parseInbox(null)).toBeNull();
    expect(parseInbox({ items: "no" })).toBeNull();
  });

  it("defaults a bad affectedCount to 1", () => {
    expect(parseInbox({ items: [item({ affectedCount: 0 })] })?.items[0].affectedCount).toBe(1);
  });
});

describe("parseInboxResponse", () => {
  it("returns the inbox on success", () => {
    const r = parseInboxResponse(200, { ok: true, inbox: { items: [item()] } });
    expect(r.ok && r.inbox.total).toBe(1);
  });

  it("maps each failure to a reason the screen can act on", () => {
    expect(parseInboxResponse(404, {})).toMatchObject({ ok: false, reason: "unavailable" });
    expect(parseInboxResponse(401, {})).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(parseInboxResponse(403, { error: "mfa_required" })).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(parseInboxResponse(500, {})).toMatchObject({ ok: false, reason: "error" });
    expect(parseInboxResponse(200, { ok: true, inbox: "bad" })).toMatchObject({ ok: false, reason: "error" });
    expect(parseInboxResponse(200, null)).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("display helpers", () => {
  it("labels known kinds and falls back for new ones", () => {
    expect(kindLabel("duplicate_candidate")).toBe("Duplicate");
    expect(kindLabel("something_new")).toBe("Needs attention");
  });

  it("recognises a single-transaction drill-in only", () => {
    expect(transactionIdFromHref(`/transactions/${TX}`)).toBe(TX);
    expect(transactionIdFromHref("/transactions/review")).toBeNull();
    expect(transactionIdFromHref(`/transactions/${TX}/edit`)).toBeNull();
  });

  it("builds a web URL only for a rooted path", () => {
    expect(webUrl("https://x.me", "/pay/reconciliation")).toBe("https://x.me/pay/reconciliation");
    expect(webUrl("", "/a")).toBeNull();
    expect(webUrl("https://x.me", "//evil.example")).toBeNull();
    expect(webUrl("https://x.me", "https://evil.example")).toBeNull();
  });

  it("offers re-categorising only for category items on one transaction", () => {
    const base = parseInbox({ items: [item()] })!.items[0];
    expect(canPickCategory(base)).toBe(true);
    expect(canPickCategory({ ...base, kind: "needs_attribution" })).toBe(false);
    expect(canPickCategory({ ...base, href: "/transactions/review" })).toBe(false);
  });

  it("keys actions distinctly", () => {
    expect(actionKey({ type: "merge_duplicate", label: "m", duplicateId: "a", canonicalId: "b" })).toBe("merge_duplicate:a");
    expect(actionKey({ type: "confirm_category", label: "c", transactionId: TX })).toBe(`confirm_category:${TX}`);
  });
});
