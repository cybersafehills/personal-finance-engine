import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { test as setup, expect } from "@playwright/test";
import { assertNotProductionSupabaseUrl } from "./production-guard";
import { AUTH_STORAGE_STATE_PATH, E2E_USER } from "./test-users";

/**
 * Resolves the local Supabase stack's API URL + service-role key.
 * Prefers explicit env vars (how CI wires this up, see
 * .github/workflows/ci.yml's e2e job) and falls back to `supabase status
 * --output json` for local developer ergonomics (`supabase start` then
 * `npx playwright test` with nothing else exported). Never reads
 * NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL from .env.local - those name the
 * linked production project (see web/.env.local), which this suite must
 * never touch.
 */
function resolveLocalSupabaseCredentials(): { url: string; serviceRoleKey: string } {
  if (process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_SERVICE_ROLE_KEY) {
    return {
      url: process.env.E2E_SUPABASE_URL,
      serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    };
  }

  // The Supabase CLI resolves its project by walking up from cwd looking
  // for supabase/config.toml, so this must run from the repo root
  // (one level above web/), not from web/ itself.
  const raw = execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..", ".."),
  });
  const status = JSON.parse(raw) as {
    API_URL?: string;
    SERVICE_ROLE_KEY?: string;
  };

  if (!status.API_URL || !status.SERVICE_ROLE_KEY) {
    throw new Error(
      "Could not resolve a local Supabase API URL/service-role key from " +
        "`supabase status`. Run `supabase start` first, or set " +
        "E2E_SUPABASE_URL/E2E_SUPABASE_SERVICE_ROLE_KEY explicitly.",
    );
  }

  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

setup("create and sign in the e2e test user", async ({ page }) => {
  const { url, serviceRoleKey } = resolveLocalSupabaseCredentials();
  assertNotProductionSupabaseUrl(url);

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotent: a re-run against an already-seeded local stack (e.g. a
  // developer running the suite twice without restarting `supabase
  // start`) reuses the existing user rather than failing on a duplicate-
  // email conflict.
  const { data: existingUsers } = await adminClient.auth.admin.listUsers();
  const alreadyExists = existingUsers?.users.some((u) => u.email === E2E_USER.email);

  if (!alreadyExists) {
    const { error } = await adminClient.auth.admin.createUser({
      email: E2E_USER.email,
      password: E2E_USER.password,
      // Bypasses the email-confirmation round trip (auth.email.enable_
      // confirmations = true in supabase/config.toml) - this is test
      // setup with direct admin access, not a stand-in for the real
      // signup flow, which the suite never needs to re-verify here.
      email_confirm: true,
    });
    if (error) throw error;
  }

  const { data: seededUsers } = await adminClient.auth.admin.listUsers();
  const seededUser = seededUsers.users.find((user) => user.email === E2E_USER.email);
  if (!seededUser) throw new Error("E2E user was not provisioned.");
  const { error: onboardingError } = await adminClient
    .from("profiles")
    .update({ onboarding_step: "completed", onboarding_completed_at: new Date().toISOString() })
    .eq("id", seededUser.id);
  if (onboardingError) throw onboardingError;

  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // A real sign-in through the actual UI, not a fabricated cookie - the
  // storage state saved below is exactly what a genuine session leaves
  // behind, so every dependent test exercises the real auth path.
  await expect(page.getByLabel("Account menu")).toBeVisible();

  await page.context().storageState({ path: AUTH_STORAGE_STATE_PATH });
});
