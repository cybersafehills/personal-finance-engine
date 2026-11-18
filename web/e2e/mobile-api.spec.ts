import { request as playwrightRequest, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  adminClient,
  cleanupSeededTransactions,
  ensureWorkspaceAndAccount,
  seedTransaction,
  testUserId,
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
  const createdIntentIds: string[] = [];

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
    // Payment intents made through the pay endpoint (events first: they
    // reference the intent). Best effort - a leftover draft is harmless.
    if (createdIntentIds.length > 0) {
      const admin = adminClient();
      await admin.from("payment_events").delete().in("payment_intent_id", createdIntentIds);
      await admin.from("payment_intents").delete().in("id", createdIntentIds);
    }
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

  test("statements: list under the bearer token, and no download for an unknown id", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      // FINANCIAL_STATEMENTS_ENABLED is on for this suite (playwright.config.ts).
      const list = await api.get("/api/mobile/statements", { headers });
      expect(list.status()).toBe(200);
      expect(list.headers()["cache-control"]).toContain("no-store");
      const body = await list.json();
      expect(body.ok).toBe(true);
      expect(body.enabled).toBe(true);
      expect(Array.isArray(body.statements)).toBe(true);
      for (const st of body.statements) {
        expect(typeof st.periodLabel).toBe("string");
        expect(Array.isArray(st.totals)).toBe(true);
      }

      // An id that is not a statement the caller can see (RLS hides other
      // users' rows exactly like a missing one) gets no URL, and a malformed
      // id never reaches the database.
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
        const res = await api.get(`/api/mobile/statements/${id}/document?format=pdf`, { headers });
        expect(res.status()).toBe(200);
        const doc = await res.json();
        expect(doc.download).toBeNull();
        expect(doc.reason).toBe("not_found");
      }
    } finally {
      await api.dispose();
    }
  });

  test("config: booleans only, resolved under the bearer token", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const res = await api.get("/api/mobile/config", {
        headers: { authorization: `Bearer ${(await signIn.json()).access_token}` },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toContain("no-store");
      const body = await res.json();
      expect(body.ok).toBe(true);
      const keys = Object.keys(body.config).sort();
      expect(keys).toEqual([
        "assistedPay",
        "bills",
        "businessSurfaces",
        "developer",
        "insights",
        "integrations",
        "pay",
        "scanToPay",
        "spaces",
        "statements",
        "trustedRecipients",
        "ussdDirectory",
      ]);
      for (const k of keys) expect(typeof body.config[k]).toBe("boolean");
      // FINANCIAL_STATEMENTS_ENABLED is on for this suite (playwright.config.ts).
      expect(body.config.statements).toBe(true);
      // The sub-flags never outrun their parent.
      if (body.config.assistedPay || body.config.ussdDirectory || body.config.scanToPay) {
        expect(body.config.pay).toBe(true);
      }
      if (body.config.trustedRecipients) expect(body.config.assistedPay).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test("scan to pay: classify, reject, and prepare a hand-off (scan is on in this suite)", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      // Not authenticated: refused.
      expect((await api.post("/api/mobile/pay/scan/classify", { data: { raw: "*182#" } })).status()).toBe(401);

      // Garbage and unsafe schemes are rejected with a coarse reason, never "opened anyway".
      for (const raw of ["hello world", "javascript:alert(1)"]) {
        const res = await api.post("/api/mobile/pay/scan/classify", { headers, data: { raw } });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.result.ok).toBe(false);
        expect(typeof body.result.reason).toBe("string");
        // Nothing of the scanned text comes back.
        expect(JSON.stringify(body)).not.toContain(raw);
      }

      // A malformed request is a 422, not a crash.
      expect((await api.post("/api/mobile/pay/scan/classify", { headers, data: { raw: "" } })).status()).toBe(422);

      // A verified balance code: classified, and a hand-off with no payment recorded.
      const menu = await api.post("/api/mobile/pay/scan/classify", { headers, data: { raw: "*182*6*1#" } });
      expect((await menu.json()).result.ok).toBe(true);
      const info = await api.post("/api/mobile/pay/scan/prepare", { headers, data: { raw: "*182*6*1#" } });
      const infoBody = await info.json();
      expect(infoBody.outcome.status).toBe("info_only");
      expect(infoBody.outcome.telHref).toContain("tel:");

      // A send-money code with an amount: a draft is prepared, a repeat is the same draft,
      // and recording the hand-off moves it on (the existing handoff route).
      const raw = "*182*1*1*0788123456*1500#";
      const first = await (await api.post("/api/mobile/pay/scan/prepare", { headers, data: { raw } })).json();
      expect(first.outcome.status).toBe("prepared");
      expect(first.outcome.telHref).toContain("tel:");
      const second = await (await api.post("/api/mobile/pay/scan/prepare", { headers, data: { raw } })).json();
      expect(second.outcome.intentId).toBe(first.outcome.intentId);
      expect(second.outcome.existed).toBe(true);

      const handoff = await api.post(`/api/mobile/pay/intents/${first.outcome.intentId}/handoff`, {
        headers,
        data: { method: "copy", outcome: "copied" },
      });
      expect(handoff.status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test("pay: prepare a draft intent, retry safely, and read it back", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      // Assisted pay is on by default in this suite (pay-assisted.spec.ts relies on it).
      const key = crypto.randomUUID();
      const payload = {
        paymentType: "pay_person",
        amountMinor: 1500,
        recipientName: "E2E Mobile Recipient",
        recipientMsisdn: "0788123456",
        idempotencyKey: key,
      };

      const first = await api.post("/api/mobile/pay/intents", { headers, data: payload });
      expect(first.status()).toBe(200);
      expect(first.headers()["cache-control"]).toContain("no-store");
      const created = await first.json();
      expect(created.ok).toBe(true);
      expect(created.existed).toBe(false);
      createdIntentIds.push(created.intent.id);
      expect(created.intent.state).toBe("draft");
      expect(created.intent.amountMinor).toBe(1500);
      expect(created.intent.recipientMasked).toContain("3456");
      // The full number only ever appears inside the dialable instruction.
      const { instruction, ...rest } = created.intent;
      expect(JSON.stringify(rest)).not.toContain("0788123456");
      expect(JSON.stringify(rest)).not.toContain("250788123456");
      if (instruction) {
        // A route is either ready to dial (with `#` encoded) or says why not.
        if (instruction.ok) {
          expect(instruction.display).toContain("0788123456");
          expect(instruction.telHref.startsWith("tel:")).toBe(true);
          expect(instruction.telHref).not.toContain("#");
        } else {
          expect(typeof instruction.error).toBe("string");
        }
      }

      // The same request id again (a double tap, a retry) is the same intent.
      const again = await api.post("/api/mobile/pay/intents", { headers, data: payload });
      expect(again.status()).toBe(200);
      const repeat = await again.json();
      expect(repeat.existed).toBe(true);
      expect(repeat.intent.id).toBe(created.intent.id);

      // Read it back by id.
      const read = await api.get(`/api/mobile/pay/intents/${created.intent.id}`, { headers });
      expect(read.status()).toBe(200);
      const readBody = await read.json();
      expect(readBody.intent.id).toBe(created.intent.id);
      expect(readBody.intent.state).toBe("draft");

      // A merchant payment has no phone number, so its USSD route comes from the
      // paying account's own network, read server-side. (Without that the
      // instruction would be null: "no verified route".)
      const { accountId } = await ensureWorkspaceAndAccount(adminClient());
      const merchantRes = await api.post("/api/mobile/pay/intents", {
        headers,
        data: {
          paymentType: "pay_merchant",
          amountMinor: 2500,
          merchantCode: "123456",
          recipientName: "E2E Shop",
          sourceAccountId: accountId,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      expect(merchantRes.status()).toBe(200);
      const merchant = (await merchantRes.json()).intent;
      createdIntentIds.push(merchant.id);
      expect(merchant.provider).toBe("mtn");
      expect(merchant.instruction?.ok, "a verified MTN merchant route").toBe(true);
      expect(merchant.instruction.display).toContain("123456");
      expect(merchant.instruction.telHref).not.toContain("#");

      // Handing off (copied / dialled) moves the intent to awaiting verification.
      const handoff = await api.post(`/api/mobile/pay/intents/${created.intent.id}/handoff`, {
        headers,
        data: { method: "copy", outcome: "copied" },
      });
      expect(handoff.status()).toBe(200);
      expect((await handoff.json()).intent.state).toBe("awaiting_verification");
      // An unknown id is "not found", and an outcome that doesn't fit the method is refused.
      const ghost = await api.post("/api/mobile/pay/intents/00000000-0000-4000-8000-000000000000/handoff", {
        headers,
        data: { method: "copy", outcome: "copied" },
      });
      expect(ghost.status()).toBe(404);
      const mismatch = await api.post(`/api/mobile/pay/intents/${created.intent.id}/handoff`, {
        headers,
        data: { method: "dialer", outcome: "copied" },
      });
      expect(mismatch.status()).toBe(422);

      // An unknown or malformed id has no intent.
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
        const miss = await api.get(`/api/mobile/pay/intents/${id}`, { headers });
        expect(miss.status()).toBe(200);
        const missBody = await miss.json();
        expect(missBody.intent).toBeNull();
        expect(missBody.reason).toBe("not_found");
      }

      // A bad request is refused before anything is written. (Each field rule is
      // covered in lib/mobile_pay_test.ts; this proves the route enforces it. Few
      // POSTs on purpose: the endpoint allows 20 a minute per IP, and a CI retry
      // repeats this whole test.)
      const bad = await api.post("/api/mobile/pay/intents", {
        headers,
        data: { ...payload, idempotencyKey: crypto.randomUUID(), amountMinor: 0 },
      });
      expect(bad.status()).toBe(422);
      expect((await bad.json()).ok).toBe(false);

      // A paying account that is not this workspace's is refused.
      const foreign = await api.post("/api/mobile/pay/intents", {
        headers,
        data: {
          ...payload,
          idempotencyKey: crypto.randomUUID(),
          sourceAccountId: "00000000-0000-4000-8000-000000000000",
        },
      });
      expect(foreign.status()).toBe(422);
      expect((await foreign.json()).error).toBe("invalid_account");

      // Bytes that are not JSON are a 400, not a crash. (A raw Buffer: Playwright
      // would JSON-encode a string body, which is then valid JSON.)
      const garbage = await api.post("/api/mobile/pay/intents", {
        headers: { ...headers, "content-type": "application/json" },
        data: Buffer.from("{not json"),
      });
      expect(garbage.status()).toBe(400);
      // Valid JSON that is not an object is refused as a bad request, not a 500.
      const notObject = await api.post("/api/mobile/pay/intents", {
        headers: { ...headers, "content-type": "application/json" },
        data: Buffer.from('"just a string"'),
      });
      expect(notObject.status()).toBe(422);
    } finally {
      await api.dispose();
    }
  });

  test("categories: all-time totals under the bearer token", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const res = await api.get("/api/mobile/categories", {
        headers: { authorization: `Bearer ${(await signIn.json()).access_token}` },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toContain("no-store");
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.truncated).toBe(false);
      expect(Array.isArray(body.categories)).toBe(true);
      for (const c of body.categories) {
        expect(typeof c.category).toBe("string");
        expect(Number.isFinite(c.totalRwf)).toBe(true);
        expect(c.transactionCount).toBeGreaterThanOrEqual(1);
      }
      // Largest first.
      const totals = body.categories.map((c: { totalRwf: number }) => c.totalRwf);
      expect(totals).toEqual([...totals].sort((a: number, b: number) => b - a));
      // beforeAll seeds one settled, uncategorized RWF 4,200 outflow: it is counted.
      const uncategorized = body.categories.find((c: { category: string }) => c.category === "Uncategorized");
      expect(uncategorized, "the seeded outflow is in Uncategorized").toBeTruthy();
      expect(uncategorized.totalRwf).toBeGreaterThanOrEqual(4200);
    } finally {
      await api.dispose();
    }
  });

  test("reports: list, detail and PDF for a stored report", async () => {
    const admin = adminClient();
    const { workspaceId } = await ensureWorkspaceAndAccount(admin);
    const userId = await testUserId(admin);

    // Far in the past so it can't collide with a real report (one per user per day).
    const periodStart = "2001-03-04T22:00:00Z"; // 5 March 2001, 00:00 in Kigali
    const payload = {
      schemaVersion: 1,
      dateKey: "2001-03-05",
      timezone: "Africa/Kigali",
      financialSnapshot: {
        openingBalanceRwf: 100000,
        closingBalanceRwf: 120000,
        moneyReceivedRwf: 50000,
        moneySpentRwf: 30000,
        feesRwf: 400,
        netMovementRwf: 20000,
        transactionCount: 7,
        categorizedCount: 5,
        uncategorizedCount: 2,
        largestInflowRwf: 50000,
        largestOutflowRwf: 15000,
      },
      categoryTotals: [{ category: "Food", amountRwf: 30000, transactionCount: 7, percentOfSpending: 100 }],
      trends: [{ metric: "spend", label: "Spending", currentValue: 30000, comparisonValue: 25000, changePercent: 20 }],
      alerts: [
        { id: "a1", kind: "high_daily_spend", severity: "warning", spentRwf: 30000, thresholdRwf: 20000 },
      ],
      budget: { overallStatus: "no_active_budget" },
      forecast: null,
    };

    await admin.from("report_runs").delete().eq("user_id", userId).eq("period_start", periodStart);
    const { data: run, error } = await admin
      .from("report_runs")
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        report_type: "daily",
        period_start: periodStart,
        period_end: "2001-03-05T22:00:00Z",
        timezone: "Africa/Kigali",
        status: "generated",
        scheduled_for: periodStart,
        generated_at: "2001-03-05T22:07:00Z",
        report_payload: payload,
      })
      .select("id")
      .single();
    if (error || !run) throw new Error(`could not seed a report run: ${error?.message}`);
    const reportId = run.id as string;

    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      // The list names the day in the report's own timezone.
      const list = await (await api.get("/api/mobile/reports", { headers })).json();
      expect(list.ok).toBe(true);
      const item = list.reports.find((r: { id: string }) => r.id === reportId);
      expect(item, "the seeded report is listed").toBeTruthy();
      expect(item.dateLabel).toBe("March 5, 2001");
      expect(item.statusLabel).toBe("Generated");

      // The detail carries the stored figures and the web's own sentences.
      const detailRes = await api.get(`/api/mobile/reports/${reportId}`, { headers });
      expect(detailRes.status()).toBe(200);
      expect(detailRes.headers()["cache-control"]).toContain("no-store");
      const { report } = await detailRes.json();
      expect(report.hasDocument).toBe(true);
      expect(report.snapshot.closingBalanceRwf).toBe(120000);
      expect(report.snapshot.netMovementRwf).toBe(20000);
      expect(report.categories[0]).toMatchObject({ category: "Food", amountRwf: 30000 });
      expect(report.trends[0]).toMatchObject({ label: "Spending", changePercent: 20, tone: "negative" });
      expect(report.alerts[0].message).toBe("Total spending today (30,000 RWF) was higher than usual.");
      expect(report.budget).toBeNull(); // no active budget in the payload
      expect(report.forecast).toBeNull();

      // The PDF: a real, fetchable document.
      const doc = await (await api.get(`/api/mobile/reports/${reportId}/document`, { headers })).json();
      expect(doc.ok).toBe(true);
      expect(typeof doc.download.url).toBe("string");
      const pdf = await playwrightRequest.newContext();
      try {
        const file = await pdf.get(doc.download.url);
        expect(file.status()).toBe(200);
        expect((await file.body()).subarray(0, 4).toString()).toBe("%PDF");
      } finally {
        await pdf.dispose();
      }

      // An unknown or malformed id has no report and no download.
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
        const missing = await (await api.get(`/api/mobile/reports/${id}`, { headers })).json();
        expect(missing.report).toBeNull();
        expect(missing.reason).toBe("not_found");
        const noDoc = await (await api.get(`/api/mobile/reports/${id}/document`, { headers })).json();
        expect(noDoc.download).toBeNull();
        expect(noDoc.reason).toBe("not_found");
      }
    } finally {
      await api.dispose();
      await admin.storage.from("report-artifacts").remove([`reports/${reportId}.pdf`]);
      await admin.from("report_runs").delete().eq("id", reportId); // artifacts go with it
    }
  });

  test("bills: list and detail for a stored document, with a status filter and honest errors", async () => {
    const admin = adminClient();
    const { workspaceId } = await ensureWorkspaceAndAccount(admin);
    const key = `e2e/mobile-api/${Date.now()}.pdf`;
    // (workspace_id, checksum_sha256) is unique, so every run needs its own.
    const checksum = (n: number) => `${Date.now().toString(16)}${n}`.padStart(64, "b");
    const { data: doc, error } = await admin
      .from("bill_documents")
      .insert({
        workspace_id: workspaceId,
        original_filename: "mobile-api-bill.pdf",
        sanitized_filename: "mobile-api-bill.pdf",
        storage_key: key,
        mime_type: "application/pdf",
        byte_size: 2048,
        page_count: 2,
        checksum_sha256: checksum(1),
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(`could not seed a bill document: ${error?.message}`);
    const billId = doc.id as string;
    let householdId: string | null = null;

    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      const list = await (await api.get("/api/mobile/bills", { headers })).json();
      expect(list.ok).toBe(true);
      const item = list.bills.find((b: { id: string }) => b.id === billId);
      expect(item.filename).toBe("mobile-api-bill.pdf");
      expect(item.statusLabel).toBe("Received");
      expect(item.pageCount).toBe(2);
      expect(typeof list.hasMore).toBe("boolean");

      // The status filter narrows the list; an invalid one is a 400, never silently "all".
      const none = await (await api.get("/api/mobile/bills?status=archived", { headers })).json();
      expect(none.bills.find((b: { id: string }) => b.id === billId)).toBeUndefined();
      const bad = await api.get("/api/mobile/bills?status=nonsense", { headers });
      expect(bad.status()).toBe(400);
      expect((await bad.json()).error).toBe("invalid_status");

      const detailRes = await api.get(`/api/mobile/bills/${billId}`, { headers });
      expect(detailRes.status()).toBe(200);
      const { bill } = await detailRes.json();
      expect(bill.typeLabel).toBe("PDF");
      expect(bill.sizeLabel).toBe("2.0 KB");
      // The raw checksum and storage key are never part of the answer.
      const raw = JSON.stringify(bill);
      expect(raw).not.toContain(checksum(1));
      expect(raw).not.toContain(key);
      // The history is either a list or null (no permission), never raw rows.
      expect(bill.history === null || Array.isArray(bill.history)).toBe(true);

      // An unknown or malformed id is a plain 404.
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
        const missing = await api.get(`/api/mobile/bills/${id}`, { headers });
        expect(missing.status(), id).toBe(404);
        expect((await missing.json()).error).toBe("not_found");
      }

      // Space scoping: RLS is plain membership, so a document in ANOTHER Space the
      // user belongs to must not show under Personal, nor open by id there.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && anon) {
        const user = createClient(url, anon, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: headers.authorization } },
        });
        const { data: hid, error: hErr } = await user.rpc("create_household_workspace", {
          p_name: "E2E Bills Household",
        });
        if (hErr || !hid) throw new Error(`could not create a household: ${hErr?.message}`);
        householdId = hid as string;
        const { data: hdoc, error: hdocErr } = await admin
          .from("bill_documents")
          .insert({
            workspace_id: householdId,
            original_filename: "household-bill.pdf",
            sanitized_filename: "household-bill.pdf",
            storage_key: `e2e/mobile-api/h-${Date.now()}.pdf`,
            mime_type: "application/pdf",
            byte_size: 1024,
            checksum_sha256: checksum(2),
          })
          .select("id")
          .single();
        if (hdocErr || !hdoc) throw new Error(`could not seed a household bill: ${hdocErr?.message}`);
        const householdBillId = hdoc.id as string;
        const inHousehold = { ...headers, "x-workspace-id": householdId };

        // Personal: sees its own document, not the household's, and the household's id is a 404.
        const personal = await (await api.get("/api/mobile/bills", { headers })).json();
        const personalIds = personal.bills.map((b: { id: string }) => b.id);
        expect(personalIds).toContain(billId);
        expect(personalIds).not.toContain(householdBillId);
        expect((await api.get(`/api/mobile/bills/${householdBillId}`, { headers })).status()).toBe(404);

        // The household: the reverse, and the echo says which Space answered.
        const hlist = await (await api.get("/api/mobile/bills", { headers: inHousehold })).json();
        expect(hlist.workspace_id).toBe(householdId);
        const hIds = hlist.bills.map((b: { id: string }) => b.id);
        expect(hIds).toContain(householdBillId);
        expect(hIds).not.toContain(billId);
        expect((await api.get(`/api/mobile/bills/${householdBillId}`, { headers: inHousehold })).status()).toBe(200);
        expect((await api.get(`/api/mobile/bills/${billId}`, { headers: inHousehold })).status()).toBe(404);
      }
    } finally {
      await api.dispose();
      const removed = await admin.from("bill_documents").delete().eq("id", billId);
      // Deleting the household cascades its documents.
      if (householdId) await admin.from("workspaces").delete().eq("id", householdId);
      expect(removed.error).toBeNull();
    }
  });

  test("categorization rules: list, pause and resume, and the refusals", async () => {
    const admin = adminClient();
    const { workspaceId } = await ensureWorkspaceAndAccount(admin);
    const { data: rule, error } = await admin
      .from("categorization_policies")
      .insert({
        workspace_id: workspaceId,
        name: "E2E Mobile Rule",
        category: "Food",
        match_type: "contains",
        merchant_pattern: "e2e-mobile-rule",
        normalized_merchant_name: "e2e-mobile-rule",
        direction: "out",
        priority: 99999,
        rule_source: "manual",
        confidence: 1,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !rule) throw new Error(`could not seed a rule: ${error?.message}`);
    const ruleId = rule.id as string;

    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      const list = await (await api.get("/api/mobile/categorization-rules", { headers })).json();
      expect(list.ok).toBe(true);
      const item = list.rules.find((r: { id: string }) => r.id === ruleId);
      expect(item.title).toBe("E2E Mobile Rule");
      expect(item.summary).toBe('contains "e2e-mobile-rule" · out');
      expect(item.active).toBe(true);
      expect(item.originLabel).toBe("Created by you");

      // Pause, then resume: the answer is the rule as it now is, and it really changed.
      for (const active of [false, true]) {
        const res = await api.post("/api/mobile/categorization-rules/active", {
          headers,
          data: { workspaceId, ruleId, active },
        });
        expect(res.status()).toBe(200);
        expect((await res.json()).rule.active).toBe(active);
        const { data: stored } = await admin.from("categorization_policies").select("is_active").eq("id", ruleId).single();
        expect(stored?.is_active).toBe(active);
      }

      // Refusals: a body that is not a request, a Space they are not in, and a rule
      // that is not in the named Space. None of them changes anything.
      const stranger = "00000000-0000-4000-8000-0000000000aa";
      const post = (data: unknown) =>
        api.post("/api/mobile/categorization-rules/active", { headers, data: data as Record<string, unknown> });
      expect((await post({ workspaceId, ruleId, active: "no" })).status()).toBe(422);
      expect((await post({ workspaceId: stranger, ruleId, active: false })).status()).toBe(404);
      expect((await post({ workspaceId, ruleId: stranger, active: false })).status()).toBe(404);
      const { data: still } = await admin.from("categorization_policies").select("is_active").eq("id", ruleId).single();
      expect(still?.is_active).toBe(true);
    } finally {
      await api.dispose();
      const removed = await admin.from("categorization_policies").delete().eq("id", ruleId);
      // authenticated has no delete grant, but the service role does; surface a failure.
      expect(removed.error).toBeNull();
    }
  });

  test("X-Workspace-Id: a member's Space is echoed, anything else falls back to Personal", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const auth = { authorization: `Bearer ${(await signIn.json()).access_token}` };
      const { workspaceId: personalId } = await ensureWorkspaceAndAccount(adminClient());

      // No header: no echo, the personal Space as before.
      const plain = await (await api.get("/api/mobile/config", { headers: auth })).json();
      expect(plain.workspace_id).toBeUndefined();

      // A Space the user belongs to is honoured and echoed.
      const own = await api.get("/api/mobile/config", {
        headers: { ...auth, "x-workspace-id": personalId },
      });
      expect(own.status()).toBe(200);
      expect((await own.json()).workspace_id).toBe(personalId);

      // A Space they are not in is only a request: it falls back to Personal
      // and the echo says so, so the app never shows it as that Space's.
      const stranger = "00000000-0000-4000-8000-0000000000aa";
      const other = await api.get("/api/mobile/config", {
        headers: { ...auth, "x-workspace-id": stranger },
      });
      expect(other.status()).toBe(200);
      expect((await other.json()).workspace_id).toBe(personalId);

      // A malformed value is ignored (no echo at all).
      const junk = await api.get("/api/mobile/config", {
        headers: { ...auth, "x-workspace-id": "personal" },
      });
      expect((await junk.json()).workspace_id).toBeUndefined();
    } finally {
      await api.dispose();
    }
  });

  test("Space & members writes refuse a bad body, a Space they are not in, and a personal Space", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", {
        data: { email: E2E_USER.email, password: E2E_USER.password },
      });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };
      const { workspaceId: personalId } = await ensureWorkspaceAndAccount(adminClient());
      const stranger = "00000000-0000-4000-8000-0000000000aa";
      const member = "00000000-0000-4000-8000-0000000000bb";

      // Malformed: no explicit Space, a role that does not exist, an owner invite.
      expect((await api.post("/api/mobile/spaces/members/role", { headers, data: { membershipId: member, role: "admin" } })).status()).toBe(422);
      expect((await api.post("/api/mobile/spaces/members/role", { headers, data: { workspaceId: stranger, membershipId: member, role: "root" } })).status()).toBe(422);
      expect((await api.post("/api/mobile/spaces/invites", { headers, data: { workspaceId: stranger, email: "a@b.co", role: "owner" } })).status()).toBe(422);

      // A Space they are not in: 404, never a write somewhere else.
      for (const [path, data] of [
        ["/api/mobile/spaces/members/role", { workspaceId: stranger, membershipId: member, role: "admin" }],
        ["/api/mobile/spaces/members/remove", { workspaceId: stranger, membershipId: member }],
        ["/api/mobile/spaces/invites", { workspaceId: stranger, email: "a@b.co", role: "member" }],
        ["/api/mobile/spaces/invites/revoke", { workspaceId: stranger, inviteId: member }],
      ] as const) {
        const res = await api.post(path, { headers, data });
        expect(res.status(), path).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("not_found");
        expect(JSON.stringify(body)).not.toContain("workspace_memberships");
      }

      // Their own personal Space has no other members to manage or invite.
      const res = await api.post("/api/mobile/spaces/invites", {
        headers,
        data: { workspaceId: personalId, email: "a@b.co", role: "member" },
      });
      expect(res.status()).toBe(422);
      expect((await res.json()).error).toBe("personal_space");
    } finally {
      await api.dispose();
    }
  });

  test("the Inbox refuses a missing, malformed or invalid token", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      expect((await api.get("/api/mobile/inbox")).status()).toBe(401);
      expect((await api.get("/api/mobile/budgets")).status()).toBe(401);
      expect((await api.get("/api/mobile/statements")).status()).toBe(401);
      expect((await api.get("/api/mobile/config")).status()).toBe(401);
      expect((await api.get("/api/mobile/categories")).status()).toBe(401);
      expect((await api.get("/api/mobile/categorization-rules")).status()).toBe(401);
      expect(
        (await api.post("/api/mobile/categorization-rules/active", { data: {} })).status(),
      ).toBe(401);
      for (const path of ["/api/mobile/bills", "/api/mobile/bills/00000000-0000-4000-8000-000000000000"]) {
        expect((await api.get(path)).status(), path).toBe(401);
      }
      for (const path of [
        "/api/mobile/reports",
        "/api/mobile/reports/00000000-0000-4000-8000-000000000000",
        "/api/mobile/reports/00000000-0000-4000-8000-000000000000/document",
      ]) {
        expect((await api.get(path)).status(), path).toBe(401);
      }
      expect(
        (await api.post("/api/mobile/pay/intents", { data: { paymentType: "pay_person" } })).status(),
      ).toBe(401);
      expect(
        (await api.get("/api/mobile/pay/intents/00000000-0000-4000-8000-000000000000")).status(),
      ).toBe(401);
      expect(
        (await api.post("/api/mobile/pay/intents/00000000-0000-4000-8000-000000000000/handoff", {
          data: { method: "copy", outcome: "copied" },
        })).status(),
      ).toBe(401);
      expect(
        (await api.get("/api/mobile/statements/00000000-0000-4000-8000-000000000000/document")).status(),
      ).toBe(401);
      for (const path of [
        "/api/mobile/spaces/members/role",
        "/api/mobile/spaces/members/remove",
        "/api/mobile/spaces/invites",
        "/api/mobile/spaces/invites/revoke",
      ]) {
        expect((await api.post(path, { data: {} })).status(), path).toBe(401);
      }
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
