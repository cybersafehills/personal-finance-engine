import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Pay & Services - Phase 2a (Assisted Quick Pay). Non-custodial: the
// flow prepares and hands off an instruction and tracks the attempt. It
// never initiates a payment, never writes the ledger, never shows a
// handoff or a manual confirmation as a verified success.
//
// Assumes ASSISTED_PAY_ENABLED is on (default) and the Phase M seed's
// `mtn-momo-send` code is present (it is, on every `supabase start`).

async function prepareAPersonPayment(page: import("@playwright/test").Page) {
  await page.goto("/pay/new/pay_person");
  await page.getByPlaceholder("Phone number, e.g. 0781234567").fill("0781234567");
  await page.getByLabel(/^Amount/).fill("5000");
  await page.getByRole("button", { name: "Prepare payment" }).click();
  await expect(page).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);
}

test("the launcher's payment actions are live and route to a typed draft", async ({ page }) => {
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: "Pay", exact: true }).click();
  await page.getByRole("button", { name: "Pay a person" }).click();
  await expect(page).toHaveURL(/\/pay\/new\/pay_person$/);
  await expect(page.getByRole("heading", { name: "Pay a person" })).toBeVisible();
});

test("the review screen is honest: non-custodial notice, provider fee, no success styling", async ({
  page,
}) => {
  await prepareAPersonPayment(page);

  await expect(page.getByText(/OneLedger never asks for your Mobile Money or banking PIN/)).toBeVisible();
  await expect(page.getByText(/provider will show the final fee/i)).toBeVisible();
  // A brand-new intent is a Draft - never a check / success colour.
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
});

test("desktop hand-off offers Copy + QR, not a dialer, and moves the intent to awaiting verification", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepareAPersonPayment(page);

  await expect(page.getByRole("link", { name: "Open phone dialer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show QR/ })).toBeVisible();

  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByText("Awaiting verification")).toBeVisible();
});

test("manual confirmation is labelled 'Manually confirmed', never a verified success", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepareAPersonPayment(page);
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByText("Awaiting verification")).toBeVisible();

  await page.getByRole("button", { name: "I've confirmed this with my provider" }).click();
  await expect(page.getByText("Manually confirmed")).toBeVisible();
  await expect(page.getByText(/hasn't independently verified/)).toBeVisible();

  await page.goto("/pay/activity");
  await expect(page.getByText("Manually confirmed").first()).toBeVisible();
});

test("Pay again creates a fresh editable draft with a new id", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepareAPersonPayment(page);
  const firstUrl = page.url();
  await page.getByRole("button", { name: "Copy code" }).click();
  await page.getByRole("button", { name: "I've confirmed this with my provider" }).click();
  await expect(page.getByText("Manually confirmed")).toBeVisible();

  await page.getByRole("button", { name: "Pay again" }).click();
  await expect(page).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(firstUrl);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
});

test("a trusted recipient can be saved", async ({ page }) => {
  await page.goto("/pay/recipients");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await page.getByPlaceholder("Name").fill("Test Payee");
  await page.getByPlaceholder("Phone number, e.g. 0781234567").fill("0788111222");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Test Payee")).toBeVisible();
  await expect(page.getByText("Saved").first()).toBeVisible();

  // clean up
  await page.getByRole("button", { name: "Remove" }).first().click();
});

for (const { path, name } of [
  { path: "/pay/new/pay_person", name: "Pay a person draft" },
  { path: "/pay/activity", name: "Payment activity" },
  { path: "/pay/recipients", name: "Trusted recipients" },
]) {
  test(`${name} (${path}) has no serious/critical accessibility violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
  });
}

test("the review screen has no serious/critical accessibility violations", async ({ page }) => {
  await prepareAPersonPayment(page);
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});
