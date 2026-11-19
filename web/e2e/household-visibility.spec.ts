import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { request as playwrightRequest, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { assertNotProductionSupabaseUrl } from "./production-guard";
import { E2E_USER } from "./test-users";

// OneLedger 3.0, household source visibility, END TO END through the screens.
//
// The database layer is covered in run_migration_tests.sh. This spec proves the
// same rule through the real product: two real signed-in users in one household,
// one wallet SHARED into the Space and one PRIVATE to its owner, and the People,
// Insights, Wallets, Transactions and Fee pages plus the mobile API driven as
// each of them. The member must see the shared wallet's data and none of the
// private wallet's, anywhere. The owner (who owns both) is the positive control.
//
// User A is the suite's usual e2e identity (also the household owner here).
// User B is created by this spec. Fixtures use the real RPCs as A (create the
// household, share a source, record balances, sort transactions into people);
// only membership of B and the account/transaction rows are written with the
// service role, exactly as the other Spaces specs do.
//
// All names and amounts are unique to this spec so any leak is unmistakable.

const TAG = "e2e-household";
const HH_NAME = "E2E HH Visibility";
const SHARED_WALLET = "HH Shared Wallet";
const PRIVATE_WALLET = "HH Private Wallet";
const SHARED_PERSON = "Hhshared Vendor Zeta";
const PRIVATE_PERSON = "Hhprivate Person Omega";
const PRIVATE_PHONE = "250788222002";
const MEMBER = { email: "e2e-household-member@oneledger.test", password: "e2e-Test-Password-1!" } as const;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3417";

type Local = { url: string; serviceKey: string; anonKey: string };

function local(): Local {
  let url = process.env.E2E_SUPABASE_URL;
  let serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    const status = JSON.parse(
      execFileSync("supabase", ["status", "--output", "json"], {
        encoding: "utf8",
        cwd: path.resolve(__dirname, "..", ".."),
      }),
    ) as { API_URL?: string; SERVICE_ROLE_KEY?: string; ANON_KEY?: string };
    url = url ?? status.API_URL;
    serviceKey = serviceKey ?? status.SERVICE_ROLE_KEY;
    anonKey = anonKey ?? status.ANON_KEY;
  }
  if (!url || !serviceKey || !anonKey) throw new Error("Could not resolve local Supabase credentials");
  assertNotProductionSupabaseUrl(url);
  return { url, serviceKey, anonKey };
}

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };

let hhId = "";
let ownerId = "";
let memberId = "";
let sharedSourceId = "";
let sharedAccountId = "";
let svc: SupabaseClient;
let owner: SupabaseClient; // signed in as A under RLS

async function userIdByEmail(db: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await db.auth.admin.listUsers();
  return data.users.find((u) => u.email === email)?.id ?? null;
}

async function cleanup() {
  const { url, serviceKey } = local();
  const db = createClient(url, serviceKey, noSession);
  const a = await userIdByEmail(db, E2E_USER.email);
  // transactions FK workspaces/accounts without cascade: they go first.
  await db.from("transactions").delete().eq("parser_version", TAG);
  if (a) {
    await db.from("financial_sources").delete().eq("owner_user_id", a).like("display_name", "E2E HH %");
    await db.from("workspaces").delete().eq("kind", "household").eq("created_by", a).eq("name", HH_NAME);
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await cleanup(); // a crashed earlier run must not leave a second household behind
  const { url, serviceKey, anonKey } = local();
  svc = createClient(url, serviceKey, noSession);

  // --- user B ---
  memberId = (await userIdByEmail(svc, MEMBER.email)) ?? "";
  if (!memberId) {
    const { data, error } = await svc.auth.admin.createUser({
      email: MEMBER.email,
      password: MEMBER.password,
      email_confirm: true,
    });
    if (error) throw error;
    memberId = data.user.id;
  }
  await svc
    .from("profiles")
    .update({ onboarding_step: "completed", onboarding_completed_at: new Date().toISOString() })
    .eq("id", memberId);

  // --- user A, signed in under RLS, for the real RPCs ---
  ownerId = (await userIdByEmail(svc, E2E_USER.email)) ?? "";
  if (!ownerId) throw new Error("e2e user not found - did auth.setup.ts run?");
  owner = createClient(url, anonKey, noSession);
  const signIn = await owner.auth.signInWithPassword({ email: E2E_USER.email, password: E2E_USER.password });
  if (signIn.error) throw signIn.error;

  const hh = await owner.rpc("create_household_workspace", { p_name: HH_NAME });
  if (hh.error || !hh.data) throw new Error(`create_household_workspace failed: ${hh.error?.message}`);
  hhId = hh.data as string;

  // Membership is service-role managed (as in the other Spaces specs).
  const mem = await svc.from("workspace_memberships").insert({
    workspace_id: hhId,
    user_id: memberId,
    role: "member",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (mem.error) throw mem.error;

  // --- two wallets owned by A: one shared into the household, one private ---
  const mkSource = async (name: string) => {
    const { data, error } = await owner
      .from("financial_sources")
      .insert({ owner_user_id: ownerId, provider: "mtn_momo", source_type: "mobile_money", display_name: name, currency: "RWF" })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };
  sharedSourceId = await mkSource("E2E HH Shared source");
  const privateSourceId = await mkSource("E2E HH Private source");
  const link = await owner.from("source_space_links").insert({
    financial_source_id: sharedSourceId,
    workspace_id: hhId,
    visibility_mode: "share_transactions",
    created_by: ownerId,
  });
  if (link.error) throw link.error;

  const mkAccount = async (name: string, sourceId: string) => {
    const { data, error } = await svc
      .from("accounts")
      .insert({ workspace_id: hhId, name, provider: "mtn_momo", currency: "RWF", financial_source_id: sourceId })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };
  sharedAccountId = await mkAccount(SHARED_WALLET, sharedSourceId);
  const privateAccountId = await mkAccount(PRIVATE_WALLET, privateSourceId);

  // --- one settled payment on each wallet ---
  const mkTxn = async (accountId: string, sourceId: string, name: string, ref: string, amount: number, fee: number) => {
    const { error } = await svc.from("transactions").insert({
      account_id: accountId,
      workspace_id: hhId,
      financial_source_id: sourceId,
      source: "manual",
      transaction_type: "send_money",
      direction: "out",
      status: "success",
      currency: "RWF",
      amount_rwf: amount,
      fee_rwf: fee,
      principal_effect_rwf: -amount,
      fee_effect_rwf: -fee,
      settlement_state: "settled",
      affects_balance: true,
      effect_reason: "settled_outgoing_with_fee",
      counterparty_name: name,
      counterparty_reference: ref,
      occurred_at: new Date(Date.now() - 3_600_000).toISOString(),
      parser_version: TAG,
    });
    if (error) throw error;
  };
  await mkTxn(sharedAccountId, sharedSourceId, SHARED_PERSON, "250788111001", 11111, 100);
  await mkTxn(privateAccountId, privateSourceId, PRIVATE_PERSON, PRIVATE_PHONE, 22222, 200);

  // --- through the real RPCs, as A: sort people, record balances ---
  const sort = await owner.rpc("backfill_counterparties", { p_workspace_id: hhId });
  if (sort.error) throw sort.error;
  for (const [acct, amount] of [[sharedAccountId, 50000], [privateAccountId, 99000]] as const) {
    const r = await owner.rpc("record_manual_balance_observation", {
      p_account_id: acct,
      p_amount_minor: amount,
      p_as_of: new Date(Date.now() - 60_000).toISOString(),
      p_note: "e2e household",
    });
    if (r.error) throw r.error;
  }
});

test.afterAll(async () => {
  await cleanup();
});

async function asHousehold(context: BrowserContext) {
  await context.addCookies([
    { name: "active_workspace_id", value: hhId, url: BASE_URL },
    { name: "oneledger_splash_off", value: "1", url: BASE_URL },
  ]);
}

async function memberPage(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  // A fresh context: no stored state, so only B's own login can authorise anything.
  const context = await browser.newContext({ baseURL: BASE_URL });
  await asHousehold(context);
  const page = await context.newPage();
  // This context bypasses the shared `page` fixture, so surface the same browser
  // errors it would, with a prefix that says whose browser this is.
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[member console.error] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[member pageerror] ${e.message}`));

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const email = page.getByLabel("Email");
  try {
    await email.waitFor({ state: "visible", timeout: 45_000 });
  } catch {
    // Say what the member's browser actually got, instead of timing out blind.
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
    throw new Error(`the member's login form never appeared; url=${page.url()} body="${body}"`);
  }
  await email.fill(MEMBER.email);
  await page.getByLabel("Password", { exact: true }).fill(MEMBER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Account menu")).toBeVisible({ timeout: 45_000 });
  return { page, context };
}

const main = (page: Page) => page.locator("main");

test.describe("as the household MEMBER (B): the shared wallet only", () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(150_000); // fixtures + a real login through the UI
    ({ page, context } = await memberPage(browser));
  });
  test.afterAll(async () => {
    await context.close();
  });

  test("Wallets: the shared wallet and its balance, never the private one", async () => {
    await page.goto("/wallets");
    await expect(page.getByRole("heading", { name: SHARED_WALLET })).toBeVisible();
    await expect(main(page)).toContainText("50,000 RWF");
    await expect(main(page)).not.toContainText(PRIVATE_WALLET);
    await expect(main(page)).not.toContainText("99,000");
  });

  test("People: the shared vendor only; the private person's name and number are not there", async () => {
    await page.goto("/people");
    await expect(main(page)).toContainText(SHARED_PERSON);
    await expect(main(page)).not.toContainText("Omega");
    await expect(main(page)).not.toContainText(PRIVATE_PERSON);
    await expect(main(page)).not.toContainText(PRIVATE_PHONE);
    // the searchable list does not find it either
    await page.goto("/people?q=Omega");
    await expect(main(page)).not.toContainText(PRIVATE_PERSON);
  });

  test("Insights: totals and people are built from the shared wallet alone", async () => {
    await page.goto("/insights?period=last_30_days");
    const rwf = page.getByRole("region", { name: "RWF insights" });
    await expect(rwf).toBeVisible();
    await expect(rwf).toContainText("11,211 RWF"); // 11,111 + 100 fee, nothing else
    await expect(main(page)).not.toContainText("22,222");
    await expect(main(page)).not.toContainText("22,422");
    await expect(main(page)).not.toContainText("Omega");
    await expect(main(page)).toContainText(SHARED_PERSON);
  });

  test("Transactions: only the shared wallet's payment", async () => {
    await page.goto("/transactions");
    await expect(main(page)).toContainText(SHARED_PERSON);
    await expect(main(page)).not.toContainText("Omega");
  });

  test("Fee estimate: history is read from the visible wallet only", async () => {
    // 22,222 is the private payment's amount. If it leaked, this would say "only 1 similar".
    await page.goto("/pay/fees?amount=22222&type=send_money");
    const hist = page.getByRole("region", { name: "Fees you have paid before" });
    await expect(hist).toContainText(/no similar payment/);
    await expect(hist).toContainText("1 of this kind in all");
  });

  test("mobile API: accounts and people for the household are filtered the same way", async () => {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const signIn = await api.post("/api/mobile/auth/sign-in", { data: { email: MEMBER.email, password: MEMBER.password } });
      expect(signIn.status()).toBe(200);
      const headers = { authorization: `Bearer ${(await signIn.json()).access_token}` };

      const accounts = await api.get(`/api/mobile/accounts?workspace_id=${hhId}`, { headers });
      expect(accounts.status()).toBe(200);
      const accountText = JSON.stringify(await accounts.json());
      expect(accountText).toContain(SHARED_WALLET);
      expect(accountText).not.toContain(PRIVATE_WALLET);
      expect(accountText).not.toContain("99000");

      const people = await api.get(`/api/mobile/counterparties?workspace_id=${hhId}`, { headers });
      expect(people.status()).toBe(200);
      const peopleText = JSON.stringify(await people.json());
      expect(peopleText).toContain(SHARED_PERSON);
      expect(peopleText).not.toContain("Omega");
    } finally {
      await api.dispose();
    }
  });

  test("the member cannot read the private rows straight from the database either", async () => {
    const { url, anonKey } = local();
    const b = createClient(url, anonKey, noSession);
    const si = await b.auth.signInWithPassword({ email: MEMBER.email, password: MEMBER.password });
    expect(si.error).toBeNull();
    const obs = await b.from("balance_observations").select("amount_minor").eq("workspace_id", hhId);
    expect((obs.data ?? []).map((o) => String(o.amount_minor))).toEqual(["50000"]);
    const cps = await b.from("counterparties").select("display_name").eq("workspace_id", hhId);
    expect((cps.data ?? []).map((c) => c.display_name)).toEqual([SHARED_PERSON]);
    const idents = await b.from("counterparty_identifiers").select("normalized_value").eq("workspace_id", hhId);
    expect(JSON.stringify(idents.data)).not.toContain(PRIVATE_PHONE);
  });
});

test.describe("as the household OWNER (A): everything, as a positive control", () => {
  test("A sees both wallets, both people and the private balance", async ({ page, context }) => {
    await asHousehold(context);
    await page.goto("/wallets");
    await expect(page.getByRole("heading", { name: SHARED_WALLET })).toBeVisible();
    await expect(page.getByRole("heading", { name: PRIVATE_WALLET })).toBeVisible();
    await expect(main(page)).toContainText("99,000 RWF");

    await page.goto("/people");
    await expect(main(page)).toContainText(SHARED_PERSON);
    await expect(main(page)).toContainText(PRIVATE_PERSON);

    await page.goto("/pay/fees?amount=22222&type=send_money");
    await expect(page.getByRole("region", { name: "Fees you have paid before" })).toContainText(/only 1 similar/);
  });
});

test.describe("sharing is evaluated live", () => {
  test("pausing the share removes the shared wallet and person from the member; resuming restores them", async ({ browser }) => {
    test.setTimeout(150_000);
    const { page, context } = await memberPage(browser);
    try {
      const setStatus = async (status: "paused" | "active") => {
        const r = await owner
          .from("source_space_links")
          .update({ status })
          .eq("financial_source_id", sharedSourceId)
          .eq("workspace_id", hhId);
        expect(r.error).toBeNull();
      };

      await setStatus("paused");
      await page.goto("/wallets");
      await expect(main(page)).not.toContainText(SHARED_WALLET);
      await page.goto("/people");
      await expect(main(page)).not.toContainText(SHARED_PERSON);

      await setStatus("active");
      await page.goto("/wallets");
      await expect(page.getByRole("heading", { name: SHARED_WALLET })).toBeVisible();
      await page.goto("/people");
      await expect(main(page)).toContainText(SHARED_PERSON);
    } finally {
      await context.close();
    }
  });
});
