import { request as playwrightRequest, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  adminClient,
  cleanupSeededTransactions,
  ensureWorkspaceAndAccount,
  seedTransaction,
} from "./seed";
import { E2E_USER } from "./test-users";

// The mobile app's API (ADR 0019, docs/mobile-api.md). Uses a clean request
// context with NO cookies, so only the bearer token can authorise a call:
// this is the proof that the request-scoped session in
// lib/mobile-session-context.ts really runs the Inbox read model as the
// signed-in user (and that the cookie path used by the rest of the suite is
// untouched).

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3417";
const TAG = "mobile-api";
const BUDGET_NAME = "E2E Mobile Budget";

/**
 * An ACTIVE RWF budget in the test user's workspace, so the budgets endpoint
 * runs the real actuals code. There is at most one active budget per
 * workspace+currency, so if another spec left one we use it and create nothing.
 * Draft first, then activate: the database requires allocations to total 100%
 * at activation. The period spans a wide window around today so the seeded
 * transaction is inside it whatever the time zone.
 */
async function ensureActiveBudget(): Promise<{ created: boolean }> {
  const admin = adminClient();
  const { workspaceId } = await ensureWorkspaceAndAccount(admin);
  const { data: existing } = await admin
    .from("budgets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("currency", "RWF")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (existing) return { created: false };

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const { data: budget, error } = await admin
    .from("budgets")
    .insert({
      workspace_id: workspaceId,
      name: BUDGET_NAME,
      currency: "RWF",
      period_start: day(start),
      period_end: day(end),
      income_amount_minor: 1_000_000,
      normalized_monthly_income_minor: 1_000_000,
      normalized_annual_income_minor: 12_000_000,
      income_frequency: "monthly",
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !budget) throw new Error(`could not create the e2e budget: ${error?.message}`);

  const split = [
    ["ESSENTIALS", 50],
    ["INVESTING", 15],
    ["EMERGENCY", 5],
    ["WANTS", 30],
  ] as const;
  const { error: allocError } = await admin.from("budget_allocations").insert(
    split.map(([type, pct], i) => ({
      budget_id: budget.id,
      workspace_id: workspaceId,
      allocation_type: type,
      percentage: pct,
      target_amount_minor: (1_000_000 * pct) / 100,
      sort_order: i,
    })),
  );
  if (allocError) throw new Error(`could not create allocations: ${allocError.message}`);

  const { error: activateError } = await admin
    .from("budgets")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", budget.id);
  if (activateError) throw new Error(`could not activate the e2e budget: ${activateError.message}`);
  return { created: true };
}

test.describe("mobile API", () => {
  let transactionId: string;
  let createdBudget = false;

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
    createdBudget = (await ensureActiveBudget()).created;
  });

  test.afterAll(async () => {
    await cleanupSeededTransactions(TAG);
    if (createdBudget) {
      await adminClient().from("budgets").delete().eq("name", BUDGET_NAME);
    }
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
      // bearer session, against a real active budget (ensureActiveBudget).
      const budgets = await api.get("/api/mobile/budgets", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(budgets.status()).toBe(200);
      const budgetsBody = await budgets.json();
      expect(budgetsBody.ok).toBe(true);
      expect(Array.isArray(budgetsBody.budgets)).toBe(true);
      expect(budgetsBody.budgets.length).toBeGreaterThanOrEqual(1);
      const budget = budgetsBody.budgets[0];
      expect(budget.currency).toBe("RWF");
      expect(budget.allocations.map((a: { type: string }) => a.type).sort()).toEqual([
        "EMERGENCY",
        "ESSENTIALS",
        "INVESTING",
        "WANTS",
      ]);
      for (const a of budget.allocations) {
        expect(typeof a.label).toBe("string");
        expect(Number.isFinite(a.targetMinor)).toBe(true);
        expect(Number.isFinite(a.actualMinor)).toBe(true);
      }
      // Alerts reach the client as plain sentences (bigints would have broken JSON).
      for (const alert of budget.alerts) expect(typeof alert.message).toBe("string");
      // The seeded uncategorized outflow is counted by the canonical actuals.
      // Only when this spec made the budget: another spec's budget may have a
      // period that does not cover the seeded transaction.
      if (createdBudget) expect(budget.uncategorizedCount).toBeGreaterThanOrEqual(1);
    } finally {
      await api.dispose();
    }
  });

  test("a signed-in user adds a transaction only through create_manual_transaction", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    test.skip(!url || !anon, "needs the local Supabase URL and anon key in the environment");

    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    let createdId: string | null = null;
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const { access_token: token } = await signIn.json();

      // The user's own session, exactly as the app and the web action use it.
      const user = createClient(url!, anon!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { workspaceId, accountId } = await ensureWorkspaceAndAccount();

      // Signed-in users have no INSERT on transactions (ingestion is the only
      // direct writer): this is the permission the web action used to hit.
      const direct = await user.from("transactions").insert({
        account_id: accountId,
        workspace_id: workspaceId,
        source: "manual",
        transaction_type: "send_money",
        direction: "out",
        status: "success",
        amount_rwf: 1,
        fee_rwf: 0,
        occurred_at: new Date().toISOString(),
        parser_version: "e2e-direct",
      });
      expect(direct.error?.code).toBe("42501");

      const created = await user.rpc("create_manual_transaction", {
        p_account_id: accountId,
        p_transaction_type: "merchant_payment",
        p_direction: "out",
        p_amount_minor: 4200,
        p_fee_minor: 100,
        p_occurred_at: new Date(Date.now() - 60_000).toISOString(),
        p_counterparty_name: "E2E Manual Entry",
        p_notes: null,
      });
      expect(created.error).toBeNull();
      createdId = created.data as string;
      expect(createdId).toMatch(/^[0-9a-f-]{36}$/);

      // Readable back under the user's own RLS, with effects the accounting
      // constraints accept (out: principal and fee both move down).
      const { data: row, error: readError } = await user
        .from("transactions")
        .select("direction, amount_rwf, fee_rwf, principal_effect_rwf, fee_effect_rwf, source, status, counterparty_name")
        .eq("id", createdId)
        .single();
      expect(readError).toBeNull();
      expect(row).toMatchObject({
        direction: "out",
        amount_rwf: 4200,
        fee_rwf: 100,
        principal_effect_rwf: -4200,
        fee_effect_rwf: -100,
        source: "manual",
        status: "success",
        counterparty_name: "E2E Manual Entry",
      });

      const invalid = await user.rpc("create_manual_transaction", {
        p_account_id: accountId,
        p_transaction_type: "merchant_payment",
        p_direction: "out",
        p_amount_minor: 0,
        p_fee_minor: 0,
        p_occurred_at: new Date().toISOString(),
        p_counterparty_name: null,
        p_notes: null,
      });
      expect(invalid.error?.message).toContain("invalid_amount");
    } finally {
      if (createdId) await adminClient().from("transactions").delete().eq("id", createdId);
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
