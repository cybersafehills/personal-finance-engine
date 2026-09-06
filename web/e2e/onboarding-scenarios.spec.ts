import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

// Named new-user scenarios from the master prompt §97, adapted to the one
// shared seeded e2e identity (which by the time this runs is an
// established account with data) and to CI's flag state
// (ONBOARDING_JOURNEY_ENABLED is dark, so the derived checklist at
// /get-started is what's exercised). Each test is tolerant of whatever
// prior specs left behind and cleans up anything it creates.
//
//  B — deferring the connection step still lands on a working dashboard
//  E — checklist progress is derived from state, so it survives a reload
//  F — an account outlives a revoked connection and can be reconnected
//  G — an established user is never forced back through onboarding
//  D — the organization path is discoverable from Spaces settings

async function ensureAnAccountExists(page: Page): Promise<void> {
  await page.goto("/settings/accounts");
  const hasAccount = await page
    .getByRole("button", { name: "Rename" })
    .first()
    .isVisible()
    .catch(() => false);
  if (hasAccount) return;
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account name").fill("E2E scenarios account");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("button", { name: "Rename" }).first(),
  ).toBeVisible();
}

test("scenario G: an established user reaches Home and Settings without a forced onboarding wall", async ({
  page,
}) => {
  await page.goto("/");
  // The app shell renders - not a redirect loop into a mandatory setup route.
  await expect(page.getByRole("navigation", { name: "Primary" }).first())
    .toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // Onboarding surfaces are reachable but optional.
  await page.goto("/get-started");
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  await page.goto("/onboarding/review");
  await expect(page).toHaveURL(/\/(onboarding\/review|get-started)$/);
});

async function createConnection(page: Page, label: string): Promise<void> {
  await page.goto("/integrations/connections");
  await page.getByRole("button", { name: "Connect a device" }).click();
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: "Create connection" }).click();
  // The one-time secret reveal appears after a server-action round trip;
  // a busy CI web server can be slow, so wait generously, then dismiss.
  const done = page.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible({ timeout: 20_000 });
  await done.click();
  await expect(
    page.locator("div.rounded-card").filter({ hasText: label }).first(),
  ).toBeVisible();
}

async function revokeConnection(page: Page, label: string): Promise<void> {
  const row = page
    .locator("div.rounded-card")
    .filter({ hasText: label })
    .first();
  await row.getByRole("button", { name: "Revoke" }).click();
  await row.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(row.getByText("Disabled")).toBeVisible();
}

test("scenario F: an account outlives a revoked connection and can be reconnected", async ({
  page,
}) => {
  await ensureAnAccountExists(page);

  const label = `E2E scenario-F ${Date.now()}`;
  await createConnection(page, label);
  await revokeConnection(page, label);

  // The account is untouched by losing its connection.
  await page.goto("/settings/accounts");
  await expect(page.getByRole("button", { name: "Rename" }).first())
    .toBeVisible();

  // And a fresh connection can be created against it, then cleaned up.
  const label2 = `E2E scenario-F retry ${Date.now()}`;
  await createConnection(page, label2);
  await revokeConnection(page, label2);
});

test("scenario B: deferring setup from /get-started still lands on a working surface", async ({
  page,
}) => {
  await page.goto("/get-started");

  const laterInSettings = page.getByRole("button", {
    name: "Do it later in Settings",
  });
  const dismissReminder = page.getByRole("button", {
    name: "Dismiss setup reminder",
  });

  if (await laterInSettings.isVisible().catch(() => false)) {
    await laterInSettings.click();
    await expect(page).toHaveURL(/\/settings$/);
  } else if (await dismissReminder.isVisible().catch(() => false)) {
    await dismissReminder.click();
    await expect(page.getByRole("navigation", { name: "Primary" }).first())
      .toBeVisible();
  }

  // Deferring never removes the ability to finish later.
  await page.goto("/get-started");
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  await expect(
    page.getByText("Add a financial account").or(page.getByText(/You.re all set/))
      .first(),
  ).toBeVisible();
});

test("scenario E: checklist progress is recomputed from state and never regresses on reload", async ({
  page,
}) => {
  await page.goto("/get-started");
  const progress = page.getByText(/(\d) of 4 done/);
  await expect(progress).toBeVisible();
  const first = Number((await progress.textContent())!.match(/(\d) of 4/)![1]);

  await page.reload();
  await expect(page.getByText(/\d of 4 done/)).toBeVisible();
  const second = Number(
    (await page.getByText(/\d of 4 done/).textContent())!.match(/(\d) of 4/)![1],
  );
  expect(second).toBeGreaterThanOrEqual(first);
});

test("scenario D: the organization path is discoverable from Spaces settings", async ({
  page,
}) => {
  await page.goto("/settings/workspace");
  await expect(page.getByText(/organization Space shares one ledger/i))
    .toBeVisible();
});
