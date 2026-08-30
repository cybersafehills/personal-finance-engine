import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { assertNotProductionSupabaseUrl } from "./production-guard";
import { E2E_USER } from "./test-users";

// Phase S (Spaces) end-to-end: the seeded e2e user creates a household,
// shares one of their financial sources into it, and resolves an
// unattributed household transaction from the transaction detail page.
// Single-user coverage - the suite shares one e2e identity - so this
// exercises the owner's side of every Phase S RPC
// (create_household_workspace, allocate_source_to_space,
// set_transaction_attribution) and the three surfaces built on them
// (/settings/workspace, /settings/sources, /transactions/[id]).
//
// Every row this spec creates is torn down in afterEach: later specs
// (visual.spec.ts "Home dashboard (empty state)") assume an empty ledger
// and no extra Spaces.

const E2E_PARSER_VERSION = "e2e-spaces";
const HOUSEHOLD_NAME = "E2E Household";
const SOURCE_NAME = "E2E Bank";

function admin(): SupabaseClient {
  let url = process.env.E2E_SUPABASE_URL;
  let key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const raw = execFileSync("supabase", ["status", "--output", "json"], {
      encoding: "utf8",
      cwd: path.resolve(__dirname, "..", ".."),
    });
    const status = JSON.parse(raw) as {
      API_URL?: string;
      SERVICE_ROLE_KEY?: string;
    };
    url = status.API_URL;
    key = status.SERVICE_ROLE_KEY;
  }
  if (!url || !key) throw new Error("Could not resolve local Supabase credentials");
  assertNotProductionSupabaseUrl(url);
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function e2eUserId(db: SupabaseClient): Promise<string> {
  const { data } = await db.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === E2E_USER.email);
  if (!user) throw new Error("e2e user not found - did auth.setup.ts run?");
  return user.id;
}

async function seedSource(db: SupabaseClient, ownerUserId: string): Promise<string> {
  const { data, error } = await db
    .from("financial_sources")
    .insert({
      owner_user_id: ownerUserId,
      provider: "bank",
      source_type: "bank_account",
      display_name: SOURCE_NAME,
      currency: "RWF",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function seedHouseholdTransaction(
  db: SupabaseClient,
  opts: { workspaceId: string; sourceId: string },
): Promise<string> {
  const { data: account, error: accountError } = await db
    .from("accounts")
    .insert({
      workspace_id: opts.workspaceId,
      name: "E2E Spaces Account",
      provider: "bank",
      currency: "RWF",
      financial_source_id: opts.sourceId,
    })
    .select("id")
    .single();
  if (accountError) throw accountError;

  const { data: txn, error: txnError } = await db
    .from("transactions")
    .insert({
      account_id: account!.id,
      workspace_id: opts.workspaceId,
      financial_source_id: opts.sourceId,
      source: "manual",
      transaction_type: "merchant_payment",
      direction: "out",
      status: "success",
      currency: "RWF",
      amount_rwf: 5000,
      fee_rwf: 0,
      occurred_at: new Date().toISOString(),
      parser_version: E2E_PARSER_VERSION,
      principal_effect_rwf: -5000,
      fee_effect_rwf: 0,
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "e2e_settled_outgoing",
      allocation_status: "needs_attribution",
    })
    .select("id")
    .single();
  if (txnError) throw txnError;
  return txn!.id as string;
}

test.afterEach(async () => {
  const db = admin();
  const userId = await e2eUserId(db);

  // Order matters: transactions FK workspaces/accounts with no cascade,
  // so they go first; deleting the household then cascades memberships,
  // activity, audit events, share links, accounts, and categories.
  await db.from("transactions").delete().eq("parser_version", E2E_PARSER_VERSION);
  await db.from("financial_sources").delete().eq("owner_user_id", userId).eq("display_name", SOURCE_NAME);
  await db.from("workspaces").delete().eq("kind", "household").eq("created_by", userId);
});

test("household: create a Space, share a source into it, attribute a transaction", async ({
  page,
}) => {
  const db = admin();
  const userId = await e2eUserId(db);
  const sourceId = await seedSource(db, userId);

  // --- create the household -------------------------------------------
  await page.goto("/settings/workspace");
  await page.getByLabel("Household name").fill(HOUSEHOLD_NAME);
  await page.getByRole("button", { name: "Create household" }).click();

  await expect(page).toHaveURL(/\/settings\/workspace$/);
  await expect(page.getByRole("heading", { name: HOUSEHOLD_NAME })).toBeVisible();

  const { data: household } = await db
    .from("workspaces")
    .select("id")
    .eq("kind", "household")
    .eq("created_by", userId)
    .eq("name", HOUSEHOLD_NAME)
    .single();
  const householdId = household!.id as string;

  // --- share the source into the household ---------------------------
  await page.goto("/settings/sources");
  const sourceCard = page.getByRole("region", { name: `${SOURCE_NAME} source` });
  await expect(sourceCard.getByText(SOURCE_NAME, { exact: true })).toBeVisible();
  await expect(sourceCard.getByText("Private", { exact: true })).toBeVisible();

  await sourceCard.getByRole("button", { name: "Share with a household" }).click();
  // "Transactions only" is the default radio; just submit.
  await page.getByRole("button", { name: "Share", exact: true }).click();

  // exact: the /settings/sources primer copy (Phase W PR3) also contains
  // the phrase "Transactions only"; this asserts the share-link row label.
  await expect(page.getByText("Transactions only", { exact: true }))
    .toBeVisible();

  await expect.poll(async () => {
    const { data: link, error } = await db
      .from("source_space_links")
      .select("status, visibility_mode")
      .eq("financial_source_id", sourceId)
      .eq("workspace_id", householdId)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not inspect source share: ${error.message}`);
    }

    return link ? `${link.status}|${link.visibility_mode}` : null;
  }).toBe("active|share_transactions");

  // --- an unattributed household transaction ------------------------
  const txnId = await seedHouseholdTransaction(db, { workspaceId: householdId, sourceId });

  // Dashboard shows the household block with an Unassigned bucket.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOUSEHOLD_NAME, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Spending ·/ })).toBeVisible();
  await expect(page.getByText("Unassigned")).toBeVisible();

  // Review queue surfaces it.
  await page.goto("/transactions/review");
  await expect(page.getByText("Needs attribution (1)")).toBeVisible();

  // Resolve it on the detail page.
  await page.goto(`/transactions/${txnId}`);
  await expect(page.getByText(/needs an attribution/)).toBeVisible();
  await expect(page.getByText("Whose spending", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("radio", { name: /Shared — belongs to the household/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Shared by the household")).toBeVisible();

  const { data: attributed } = await db
    .from("transactions")
    .select("attribution_type, allocation_status")
    .eq("id", txnId)
    .single();
  expect(attributed?.attribution_type).toBe("shared");
  expect(attributed?.allocation_status).toBe("allocated");
});

test("/settings/sources has no serious/critical accessibility violations", async ({
  page,
}) => {
  await page.goto("/settings/sources");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});

test("household invites: create, then rotate the link with Resend", async ({
  page,
}) => {
  // PR6 (onboarding work): the pending-invite row exposes Resend
  // (token rotation) alongside Revoke, and Resend surfaces a fresh
  // one-time link. Cleanup is the shared afterEach (deleting the
  // household cascades workspace_invites).
  await page.goto("/settings/workspace");
  await page.getByLabel("Household name").fill(HOUSEHOLD_NAME);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("heading", { name: HOUSEHOLD_NAME })).toBeVisible();

  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Email").fill("housemate@example.com");
  await page.getByRole("button", { name: "Create invite" }).click();

  // First reveal (from creation).
  await expect(page.getByText(/Copy this now/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  const row = page
    .locator("div.rounded-card")
    .filter({ hasText: "housemate@example.com" })
    .first();
  await expect(row.getByRole("button", { name: "Resend" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Revoke" })).toBeVisible();

  await row.getByRole("button", { name: "Resend" }).click();

  // A fresh one-time link, and a note that the old one is dead.
  await expect(page.getByText(/Copy this now/)).toBeVisible();
  await expect(page.getByText(/previous link no longer works/)).toBeVisible();
});
