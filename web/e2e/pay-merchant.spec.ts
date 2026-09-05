import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { assertNotProductionSupabaseUrl } from "./production-guard";
import { E2E_USER } from "./test-users";

// Pay & Services - Assisted Quick Pay, "Pay a merchant".
//
// Regression guard for the bug where a fully-filled merchant draft could
// never produce a dial string: the review screen only ever said "We
// don't have a verified USSD route for this payment yet". Two causes,
// both fixed:
//   1. createDraftIntent only resolved a service_code_id for pay_person /
//      buy_airtime, never pay_merchant.
//   2. PaymentIntentPanel only fed {phone, amount} to fillUssdTemplate,
//      so a {merchant} placeholder failed with "Enter a merchant code".
//
// The directory row is the Phase M-era `mtn-momo-pay-merchant` seed
// (`*182*8*1*{merchant}*{amount}#`, supported_networks ['mtn'],
// state 'published'), applied on every `supabase start`.

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

const ACCOUNT_NAME = "E2E MTN MoMo (merchant)";

test.afterEach(async () => {
  const db = admin();
  const ws = await activeWorkspaceId(db);
  await db.from("payment_intents").delete().eq("workspace_id", ws).eq("payment_type", "pay_merchant");
  await db.from("accounts").delete().eq("workspace_id", ws).eq("name", ACCOUNT_NAME);
});

test("a fully-filled merchant draft generates the *182*8*1*<code>*<amount># dial string", async ({
  page,
}) => {
  const db = admin();
  const ws = await activeWorkspaceId(db);
  await db
    .from("accounts")
    .insert({ workspace_id: ws, name: ACCOUNT_NAME, provider: "mtn_momo", currency: "RWF" });

  await page.goto("/pay/new/pay_merchant");
  await page.getByLabel("Pay from").selectOption({ label: `${ACCOUNT_NAME} · RWF` });
  await page.getByPlaceholder("Merchant / MoMo Pay code").fill("456950");
  await page.getByLabel(/^Amount/).fill("5000");
  await page.getByRole("button", { name: "Prepare payment" }).click();

  await expect(page).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);

  // The concatenated instruction is now generated from the resolved
  // directory code - not the "no verified route" fallback.
  await expect(page.getByText("*182*8*1*456950*5000#")).toBeVisible();
  await expect(page.getByText(/don.t have a verified USSD route/i)).toHaveCount(0);
});
