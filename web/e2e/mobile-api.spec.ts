import { request as playwrightRequest, expect, test } from "@playwright/test";

import { adminClient, cleanupSeededTransactions, seedTransaction } from "./seed";
import { E2E_USER } from "./test-users";

// The mobile app's API (ADR 0019, docs/mobile-api.md). Uses a clean request
// context with NO cookies, so only the bearer token can authorise a call:
// this is the proof that the request-scoped session in
// lib/mobile-session-context.ts really runs the Inbox read model as the
// signed-in user (and that the cookie path used by the rest of the suite is
// untouched).

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3417";
const TAG = "mobile-api";

test.describe("mobile API", () => {
  let transactionId: string;

  test.beforeAll(async () => {
    const admin = adminClient();
    await cleanupSeededTransactions(TAG, admin);
    transactionId = await seedTransaction(
      { counterpartyName: "E2E Mobile Inbox Shop", amountRwf: 4200, tag: TAG },
      admin,
    );
    // A pending suggestion puts it in the category-review queue.
    const { error } = await admin
      .from("transactions")
      .update({ category_decision_status: "suggested", suggested_category: "Food" })
      .eq("id", transactionId);
    if (error) throw new Error(`could not queue the transaction for review: ${error.message}`);
  });

  test.afterAll(async () => {
    await cleanupSeededTransactions(TAG);
  });

  test("sign in, then read the Inbox with the bearer token only", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const session = await signIn.json();
      expect(session.ok).toBe(true);
      expect(session.mfa_required).toBe(false);

      const inbox = await api.get("/api/mobile/inbox", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(inbox.status()).toBe(200);
      expect(inbox.headers()["cache-control"]).toContain("no-store");
      const body = await inbox.json();
      expect(body.ok).toBe(true);

      const item = body.inbox.items.find(
        (i: { href: string }) => i.href === `/transactions/${transactionId}`,
      );
      expect(item, "the seeded review item is in the Inbox").toBeTruthy();
      expect(item.kind).toBe("category_review");
      expect(item.actions.map((a: { type: string }) => a.type)).toContain("confirm_category");
      // The payload carries the summary the app displays.
      expect(body.inbox.total).toBeGreaterThanOrEqual(1);

      // Budgets run the same guard and the canonical actuals code under the
      // bearer session. The seeded user may have no active budget, so this
      // asserts the contract (200 + an array), not specific figures.
      const budgets = await api.get("/api/mobile/budgets", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(budgets.status()).toBe(200);
      const budgetsBody = await budgets.json();
      expect(budgetsBody.ok).toBe(true);
      expect(Array.isArray(budgetsBody.budgets)).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test("the Inbox refuses a missing, malformed or invalid token", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      expect((await api.get("/api/mobile/inbox")).status()).toBe(401);
      expect((await api.get("/api/mobile/budgets")).status()).toBe(401);
      expect(
        (await api.get("/api/mobile/inbox", { headers: { authorization: "Basic abc" } })).status(),
      ).toBe(401);
      expect(
        (await api.get("/api/mobile/inbox", { headers: { authorization: "Bearer not-a-real-token" } }))
          .status(),
      ).toBe(401);
    } finally {
      await api.dispose();
    }
  });
});
