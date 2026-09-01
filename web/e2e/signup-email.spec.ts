import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";
import { assertNotProductionSupabaseUrl } from "./production-guard";

// End-to-end proof of the ONE flow nothing else covers: real signup form
// -> Supabase Auth SMTP -> confirmation email in the local mail catcher
// -> its link authenticates -> /auth/callback redirects a first-run user
// to /get-started (onboarding work PR4).
//
// Runs unauthenticated (the proxy bounces a signed-in user off /signup),
// so this file overrides the chromium-desktop project's storageState.
// Creates a throwaway auth user per run; afterEach deletes it.
//
// Local mail: supabase/config.toml [local_smtp] port = 54324. The current
// Supabase CLI ships Mailpit there (JSON API under /api/v1). If a CLU
// CLI bump swaps the catcher, only findConfirmationUrl() needs updating.

test.use({ storageState: { cookies: [], origins: [] } });

const MAIL_BASE = "http://127.0.0.1:54324";
const NEW_USER = {
  email: `e2e-signup-${Date.now()}@oneledger.test`,
  password: "e2e-Passw0rd-confirm",
};

function localSupabase(): { url: string; key: string } {
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
  if (!url || !key) throw new Error("Could not resolve local Supabase creds");
  assertNotProductionSupabaseUrl(url);
  return { url, key };
}

function admin(): SupabaseClient {
  const { url, key } = localSupabase();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Polls Mailpit for the newest message to `to` and returns the first
 *  http(s) link in its body that looks like an auth confirmation. */
async function findConfirmationUrl(to: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const listRes = await fetch(
      `${MAIL_BASE}/api/v1/messages?query=${encodeURIComponent(`to:${to}`)}`,
    );
    if (listRes.ok) {
      const list = (await listRes.json()) as {
        messages?: Array<{ ID: string }>;
      };
      const id = list.messages?.[0]?.ID;
      if (id) {
        const msgRes = await fetch(`${MAIL_BASE}/api/v1/message/${id}`);
        if (msgRes.ok) {
          const msg = (await msgRes.json()) as { HTML?: string; Text?: string };
          const body = `${msg.HTML ?? ""}\n${msg.Text ?? ""}`;
          const match = body.match(
            /https?:\/\/[^\s"'<>]*(?:verify|auth\/callback|token_hash|[?&]code=)[^\s"'<>]*/i,
          );
          if (match) return match[0].replace(/&amp;/g, "&");
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No confirmation email for ${to} after 20s`);
}

test.afterEach(async () => {
  const db = admin();
  const { data } = await db.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === NEW_USER.email);
  if (user) await db.auth.admin.deleteUser(user.id);
});

test("signup confirmation email authenticates and starts profile onboarding", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(NEW_USER.email);
  await page.getByLabel("Password").fill(NEW_USER.password);
  await page
    .getByRole("button", { name: /sign up|create account/i })
    .click();

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByText("Check your email")).toBeVisible();
  await expect(page.getByText(NEW_USER.email)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Change email address" }),
  ).toBeVisible();

  const confirmationUrl = await findConfirmationUrl(NEW_USER.email);
  await page.goto(confirmationUrl);

  // A newly verified user resumes at the first persisted onboarding stage.
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await expect(
    page.getByRole("heading", { name: "What should we call you?" }),
  ).toBeVisible();
});
