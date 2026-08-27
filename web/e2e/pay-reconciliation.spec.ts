import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { assertNotProductionSupabaseUrl } from "./production-guard";
import { E2E_USER } from "./test-users";

// Pay & Services - Phase 2b (SMS-to-intent reconciliation). Non-custodial:
// linking an already-ingested transaction to its intent, NEVER creating a
// second ledger row. Uses a service-role admin client (same pattern as
// e2e/auth.setup.ts) to stand in for the SMS ingestion pipeline - it
// seeds a matching `transactions` row and invokes the reconcile RPC that
// ingest-momo would call.
//
// Every row this spec creates is torn down in afterEach - the shared e2e
// database is expected empty by later specs (visual.spec.ts's "Home
// dashboard (empty state)" asserts "No transactions yet").

const E2E_PARSER_VERSION = "e2e-recon";

function admin(): SupabaseClient {
  let url = process.env.E2E_SUPABASE_URL;
  let key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const raw = execFileSync("supabase", ["status", "--output", "json"], {
      encoding: "utf8",
      cwd: path.resolve(__dirname, "..", ".."),
    });
    const status = JSON.parse(raw) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
    url = status.API_URL;
    key = status.SERVICE_ROLE_KEY;
  }
  if (!url || !key) throw new Error("Could not resolve local Supabase credentials");
  assertNotProductionSupabaseUrl(url);
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function seedMatchingTransaction(
  db: SupabaseClient,
  opts: { workspaceId: string; msisdn: string; amount: number },
): Promise<string> {
  const { data: account } = await db
    .from("accounts")
    .select("id")
    .eq("workspace_id", opts.workspaceId)
    .limit(1)
    .maybeSingle();
  let accountId = account?.id as string | undefined;
  if (!accountId) {
    const { data: created } = await db
      .from("accounts")
      .insert({ workspace_id: opts.workspaceId, name: "E2E MoMo", provider: "mtn_momo", currency: "RWF" })
      .select("id")
      .single();
    accountId = created!.id as string;
  }
  const { data: msg } = await db
    .from("momo_messages")
    .insert({ raw_message: "e2e-recon seed", processing_status: "processed" })
    .select("id")
    .single();
  const { data: txn } = await db
    .from("transactions")
    .insert({
      momo_message_id: msg!.id,
      account_id: accountId,
      workspace_id: opts.workspaceId,
      source: "mtn_momo",
      transaction_type: "send_money",
      direction: "out",
      status: "success",
      currency: "RWF",
      amount_rwf: opts.amount,
      fee_rwf: 0,
      counterparty_reference: opts.msisdn,
      occurred_at: new Date().toISOString(),
      parser_version: E2E_PARSER_VERSION,
    })
    .select("id")
    .single();
  return txn!.id as string;
}

async function activeWorkspaceId(db: SupabaseClient): Promise<string> {
  const { data: user } = await db.auth.admin
    .listUsers()
    .then((r) => ({ data: r.data.users.find((u) => u.email === E2E_USER.email) }));
  const { data } = await db
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return data!.workspace_id as string;
}

async function prepareAndHandOff(page: import("@playwright/test").Page, phone: string, amount: string) {
  await page.goto("/pay/new/pay_person");
  await page.getByPlaceholder("Phone number, e.g. 0781234567").fill(phone);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole("button", { name: "Prepare payment" }).click();
  await expect(page).toHaveURL(/\/pay\/([0-9a-f-]{36})$/);
  const intentId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  return intentId;
}

test.afterEach(async () => {
  const db = admin();
  const ws = await activeWorkspaceId(db);
  // Deleting the seeded transactions cascades payment_reconciliations
  // (FK on delete cascade). Then drop the intents this spec linked /
  // conflicted, and the orphaned momo_messages. Later specs (visual.spec
  // "Home dashboard (empty state)") expect an empty ledger.
  await db.from("transactions").delete().eq("parser_version", E2E_PARSER_VERSION);
  await db
    .from("payment_intents")
    .delete()
    .eq("workspace_id", ws)
    .or("linked_transaction_id.not.is.null,state.eq.requires_reconciliation");
  await db.from("momo_messages").delete().eq("raw_message", "e2e-recon seed");
});

test("an ingested transaction reconciled in apply mode links + verifies the intent", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const db = admin();
  const intentId = await prepareAndHandOff(page, "0781112233", "6500");

  const ws = await activeWorkspaceId(db);
  const txnId = await seedMatchingTransaction(db, { workspaceId: ws, msisdn: "0781112233", amount: 6500 });
  const { data: reconResult } = await db.rpc("reconcile_transaction_with_payment_intents", {
    p_transaction_id: txnId,
    p_mode: "apply",
  });
  expect((reconResult as { status: string }).status).toBe("linked");

  await page.goto(`/pay/${intentId}`);
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Linked payment")).toBeVisible();
  await page.getByRole("link", { name: "View transaction" }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${txnId}$`));
  await expect(page.getByText("Prepared with OneLedger Pay")).toBeVisible();
});

test("manual link: the user picks a ledger transaction and the intent becomes Verified", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const db = admin();
  const intentId = await prepareAndHandOff(page, "0782223344", "4200");

  const ws = await activeWorkspaceId(db);
  await seedMatchingTransaction(db, { workspaceId: ws, msisdn: "0782223344", amount: 4200 });

  await page.goto(`/pay/${intentId}`);
  await page.getByRole("button", { name: "Link an existing transaction" }).click();
  await page.getByRole("button", { name: /RWF/ }).first().click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Linked payment")).toBeVisible();
});

test("/pay/reconciliation has no serious/critical accessibility violations", async ({ page }) => {
  await page.goto("/pay/reconciliation");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});
