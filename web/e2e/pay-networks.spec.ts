import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Pay & Services - Phase P (P3: public eKash network page + route finder).
//
// Assumes the Phase P seed (supabase/migrations/20260909000100_...) is
// present: the eKash payment network published + verified, with RSwitch
// as system operator, the National Bank of Rwanda as regulator, the
// RWF 20 published-maximum fee, and eKash/eCash/RSwitch aliases. NO
// access routes are seeded, so the route finder shows its empty state.

test("the USSD directory surfaces the eKash payment network", async ({ page }) => {
  await page.goto("/pay/ussd");
  const networksSection = page.getByRole("heading", { name: "Payment networks" });
  await expect(networksSection).toBeVisible();
  await expect(page.getByRole("link", { name: /eKash/ })).toBeVisible();
});

test("searching an alias (eCash) still finds the eKash network", async ({ page }) => {
  await page.goto("/pay/ussd");
  await page.getByLabel("Search services").fill("eCash");
  await expect(page).toHaveURL(/[?&]q=eCash/);
  await expect(page.getByRole("link", { name: /eKash/ })).toBeVisible();
});

test("the eKash network page shows operator, regulator, and the published maximum fee", async ({
  page,
}) => {
  await page.goto("/pay/networks/ekash");
  await expect(page.getByRole("heading", { name: "eKash" })).toBeVisible();
  await expect(page.getByText("RSwitch Ltd")).toBeVisible();
  await expect(page.getByText("National Bank of Rwanda")).toBeVisible();
  await expect(page.getByText(/published maximum/i)).toBeVisible();
  // Non-custodial custody note is present.
  await expect(page.getByText(/funds remain in the customer/i)).toBeVisible();
});

test("the route finder shows an honest empty state when no route is verified", async ({ page }) => {
  await page.goto("/pay/networks/ekash");
  await page.getByRole("link", { name: "Find a route" }).click();
  await expect(page).toHaveURL(/\/pay\/networks\/ekash\/routes$/);
  await expect(page.getByRole("heading", { name: "Route finder" })).toBeVisible();
  await expect(page.getByText("No verified route yet")).toBeVisible();
  // It must NOT invent guidance.
  await expect(page.getByText(/won't guess/i)).toBeVisible();
});

test("the suggest page is closed until DIRECTORY_SUGGESTIONS_ENABLED is set", async ({ page }) => {
  // The suite runs with the flag unset (opt-in, off by default).
  await page.goto("/pay/suggest");
  await expect(page.getByText("Suggestions aren't open yet")).toBeVisible();
});

test("the eKash network page has no automatic accessibility violations", async ({ page }) => {
  await page.goto("/pay/networks/ekash");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
