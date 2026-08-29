import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// PR1 of the onboarding/connection-linking work: a device (an iPhone
// Shortcut) can only be wired up if the Connections screen shows the
// endpoint URL, the auth header, and the JSON body - not just the
// one-time key. This spec proves those values reach the UI, both in the
// post-create secret reveal and in the always-available "Connection
// details" panel on each row.
//
// Shares the one seeded e2e user (see auth.setup.ts) - the seeded user
// has a workspace but no financial account, so this creates one first
// (a connection must bind to an active account).

const ENDPOINT_PATH = "/functions/v1/ingest-momo";

async function ensureAnAccountExists(page: Page): Promise<void> {
  await page.goto("/settings/accounts");
  const hasAccount = await page
    .getByRole("button", { name: "Rename" })
    .first()
    .isVisible()
    .catch(() => false);
  if (hasAccount) return;

  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("E2E MoMo account");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("button", { name: "Rename" }).first(),
  ).toBeVisible();
}

test("a new connection surfaces the full ingest contract, not just the key", async ({
  page,
}) => {
  await ensureAnAccountExists(page);

  const label = `E2E ingest ${Date.now()}`;

  await page.goto("/settings/connections");
  await page.getByRole("button", { name: "Connect a device" }).click();
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: "Create connection" }).click();

  // The one-time reveal: the key itself, plus enough to finish wiring the
  // Shortcut without leaving the page.
  await expect(page.getByText(/Copy this now/)).toBeVisible();
  await expect(page.locator("code", { hasText: "pfe_" }).first()).toBeVisible();
  await expect(page.getByText("iPhone Shortcut setup")).toBeVisible();
  await expect(page.getByText(ENDPOINT_PATH).first()).toBeVisible();
  await expect(page.getByText("x-ingest-key").first()).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/Copy this now/)).toHaveCount(0);

  // The persistent per-row panel: same contract, available long after the
  // secret is gone. Open by default for a never-used connection.
  const row = page
    .locator("div.rounded-card")
    .filter({ hasText: label })
    .first();
  await expect(
    row.getByText("Connection details for your Shortcut"),
  ).toBeVisible();
  await expect(row).toContainText(ENDPOINT_PATH);
  await expect(row).toContainText("Request body (JSON)");
  await expect(row).toContainText("What to expect");
  await expect(row).toContainText("401");
  await expect(row).toContainText("422");
});
