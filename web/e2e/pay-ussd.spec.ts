import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Pay & Services - Phase 1 (Verified USSD Hub). Covers the persistent
// global Pay action, the launcher's modal semantics, the USSD directory
// browse + detail + copy/dialer-fallback flow, the favourite and
// incorrect-code report actions, and automated a11y on the new pages.
//
// Assumes the seeded curated Rwanda set from
// supabase/migrations/20260906000100_phase_m_ussd_seed.sql is present
// (it is, on every `supabase start` / `db reset`), including the
// published-but-unverified "MTN MoMo main menu" (*182#, slug
// mtn-momo-menu) and the parameterised "MTN MoMo - send money".

test("the global Pay action opens the launcher and is fully keyboard-dismissable", async ({
  page,
}) => {
  await page.goto("/");

  // Scoped to the header so the (DOM-present but lg:hidden) mobile
  // bottom-nav Pay trigger doesn't trip strict mode.
  const payButton = page.locator("header").getByRole("button", { name: "Pay", exact: true });
  await expect(payButton).toBeVisible();

  await payButton.click();
  const dialog = page.getByRole("dialog", { name: "Pay & Services" });
  await expect(dialog).toBeVisible();

  // The payment actions are deferred, not faked.
  await expect(dialog.getByText("Coming in a later update").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Pay a person/ })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Focus returns to the trigger.
  await expect(payButton).toBeFocused();
});

test("the launcher routes to the USSD directory", async ({ page }) => {
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: "Pay", exact: true }).click();
  await page.getByRole("button", { name: "Open USSD directory" }).click();
  await expect(page).toHaveURL(/\/pay\/ussd$/);
  await expect(page.getByRole("heading", { name: "USSD directory" })).toBeVisible();
});

test("search filters the directory and a code opens its detail page", async ({ page }) => {
  await page.goto("/pay/ussd");

  const search = page.getByLabel("Search services");
  await search.fill("MoMo");
  await expect(page.getByRole("link", { name: /MTN MoMo main menu/ })).toBeVisible();

  await page.getByRole("link", { name: /MTN MoMo main menu/ }).click();
  await expect(page).toHaveURL(/\/pay\/ussd\/mtn-momo-menu$/);
  await expect(page.getByRole("heading", { name: "MTN MoMo main menu" })).toBeVisible();
  // Seed data is deliberately unverified.
  await expect(page.getByText("Not officially verified").first()).toBeVisible();
  // The non-custodial hand-off notice is always present.
  await expect(page.getByText(/never asks for your Mobile Money or banking PIN/)).toBeVisible();
});

test("on a desktop browser the dialer is not offered and the copy fallback is", async ({
  page,
}) => {
  await page.goto("/pay/ussd/mtn-momo-menu");
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open phone dialer" })).toHaveCount(0);
  await expect(page.getByText("Dialing isn't available on this device.")).toBeVisible();
});

test("copying a code reports success in the UI", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/pay/ussd/mtn-momo-menu");
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
});

test("a user can favourite a code and it appears in the Favourites section", async ({
  page,
}) => {
  await page.goto("/pay/ussd/mtn-momo-menu");
  const star = page.getByRole("button", { name: /Add .* to favourites/ });
  await star.click();
  // Wait for the server action to actually settle (the button is
  // disabled while the transition is pending) before navigating - the
  // list page server-renders from the DB.
  const unstar = page.getByRole("button", { name: /Remove .* from favourites/ });
  await expect(unstar).toBeVisible();
  await expect(unstar).toBeEnabled();

  await page.goto("/pay/ussd");
  await expect(
    page.getByRole("heading", { name: "Favourites" }),
  ).toBeVisible();

  // Clean up so re-runs start from a known state.
  await page.goto("/pay/ussd/mtn-momo-menu");
  const cleanup = page.getByRole("button", { name: /Remove .* from favourites/ });
  await cleanup.click();
  await expect(page.getByRole("button", { name: /Add .* to favourites/ })).toBeEnabled();
});

test("reporting an incorrect code confirms receipt", async ({ page }) => {
  await page.goto("/pay/ussd/mtn-momo-menu");
  await page.getByRole("button", { name: "Report incorrect information" }).click();
  await page.getByLabel("What's wrong?").selectOption("outdated");
  await page.getByLabel("Details (optional)").fill("Menu path changed on my handset.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText(/we'll review this/)).toBeVisible();
});

test("the parameterised send-money code validates input before building a dial string", async ({
  page,
}) => {
  await page.goto("/pay/ussd/mtn-momo-send");
  // Missing values -> copy disabled, no dial offered.
  await expect(page.getByRole("button", { name: "Copy code" })).toBeDisabled();
  await page.getByLabel("Recipient phone number").fill("0781234567");
  await page.getByLabel("Amount (RWF)").fill("5000");
  await expect(page.getByRole("button", { name: "Copy code" })).toBeEnabled();
});

test("the mobile bottom nav shows an elevated, labelled Pay action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");
  const bottomNav = page.getByRole("navigation", { name: "Primary" }).last();
  await expect(bottomNav.getByRole("button", { name: "Pay", exact: true })).toBeVisible();
});

for (const { path, name } of [
  { path: "/pay/ussd", name: "USSD directory" },
  { path: "/pay/ussd/mtn-momo-menu", name: "USSD code detail" },
]) {
  test(`${name} (${path}) has no serious/critical accessibility violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
  });
}

test("the open launcher has no serious/critical accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pay & Services" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});
