import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Pay & Services - Phase P (P3: public eKash network page + route finder).
//
// Assumes the Phase P seed is present: the eKash payment network
// published + verified, with RSwitch as system operator, the National
// Bank of Rwanda as regulator, the RWF 20 published-maximum fee, and
// eKash/eCash/RSwitch aliases (20260909000100), plus the verified
// bank-to-wallet access routes (20260909000400).
//
// Phase P's action-first refactor (9c9e9a3) folded the route finder into
// /pay/networks/[slug] itself (no "Find a route" step; /routes redirects
// to the parent) and moved operator/fees/limits/aliases into a
// collapsible "About eKash" section.

test("the USSD directory surfaces the eKash payment network", async ({ page }) => {
  await page.goto("/pay/ussd");
  await expect(page.getByRole("heading", { name: "Payment networks" })).toBeVisible();
  // The network card - scoped by href so the seeded per-bank eKash USSD
  // rows (all named "… - eKash") don't make this ambiguous.
  await expect(page.locator('a[href="/pay/networks/ekash"]')).toBeVisible();
});

test("searching an alias (eCash) still finds the eKash network", async ({ page }) => {
  await page.goto("/pay/ussd");
  await page.getByLabel("Search services").fill("eCash");
  await expect(page).toHaveURL(/[?&]q=eCash/);
  await expect(page.locator('a[href="/pay/networks/ekash"]')).toBeVisible();
});

test("the eKash network page's About section carries operator, regulator, fees and the custody note", async ({
  page,
}) => {
  await page.goto("/pay/networks/ekash");
  await expect(page.getByRole("heading", { name: "eKash" })).toBeVisible();

  // Operator / regulator / fees / custody note live in the collapsible
  // "About eKash" section since the action-first refactor (9c9e9a3).
  await page.locator("summary").filter({ hasText: "About eKash" }).click();

  await expect(page.getByText("RSwitch Ltd").first()).toBeVisible();
  await expect(page.getByText("National Bank of Rwanda").first()).toBeVisible();
  await expect(page.getByText(/published maximum/i).first()).toBeVisible();
  // Non-custodial custody note is present.
  await expect(page.getByText(/funds remain in the customer/i)).toBeVisible();
});

test("the inline route finder lists verified routes and has an honest empty state for an unmatched filter", async ({
  page,
}) => {
  await page.goto("/pay/networks/ekash");
  // The finder is inline on the network page now - no separate /routes step.
  await expect(page.getByText(/OneLedger only shows routes it has checked/i)).toBeVisible();
  // Phase P seeds verified eKash bank-to-wallet routes (20260909000400).
  await expect(page.getByRole("heading", { name: "Choose your bank or wallet" })).toBeVisible();
  await expect(page.locator('a[href^="/pay/networks/ekash/routes/"]').first()).toBeVisible();

  // Filter to a source with no route -> the honest empty state, no invented guidance.
  await page.goto("/pay/networks/ekash?from=00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("No verified route yet")).toBeVisible();
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
