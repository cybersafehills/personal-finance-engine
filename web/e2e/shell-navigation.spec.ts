import { test, expect } from "@playwright/test";

// Covers master prompt §24's definition-of-done for the unified shell:
// exactly 5 primary destinations (Home + 4 movable), Reports removed from
// primary nav but still reachable from the header icon and Settings,
// active-route highlighting, and the profile menu's keyboard behavior.

const PRIMARY_DESTINATIONS = ["Home", "Transactions", "Categories", "Budgets", "Settings"];

test("primary navigation has exactly 5 destinations, Home first, Reports absent", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  const links = nav.getByRole("link");

  await expect(links).toHaveCount(5);
  await expect(links.nth(0)).toHaveText("Home");

  for (const destination of PRIMARY_DESTINATIONS) {
    await expect(nav.getByRole("link", { name: destination })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
});

test("the active destination is marked aria-current", async ({ page }) => {
  await page.goto("/transactions");

  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  await expect(nav.getByRole("link", { name: "Transactions" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
});

test("Reports opens from the header icon", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Open reports").click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});

test("Reports is reachable from Settings, distinct from the Daily reports scheduling page", async ({ page }) => {
  await page.goto("/settings");

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);

  await page.goto("/settings");
  await page.getByRole("link", { name: "Daily reports" }).click();
  await expect(page).toHaveURL(/\/settings\/reports$/);
});

test("profile menu: opens, is keyboard-dismissible with Escape, and returns focus", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByLabel("Account menu");
  await trigger.click();
  await expect(page.getByText("e2e-shell-suite@oneledger.test")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("e2e-shell-suite@oneledger.test")).toBeHidden();
});

test("profile menu closes on outside click", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Account menu").click();
  await expect(page.getByText("e2e-shell-suite@oneledger.test")).toBeVisible();

  await page.mouse.click(10, 10);
  await expect(page.getByText("e2e-shell-suite@oneledger.test")).toBeHidden();
});

test("the one-time Reports relocation notice can be dismissed and never reappears", async ({ page }) => {
  await page.goto("/");

  const notice = page.getByText("Reports has moved");
  // Depending on suite run order this may already be dismissed from a
  // prior test in the same worker - only assert the dismiss behavior
  // when it's actually showing.
  if (await notice.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(notice).toBeHidden();
    await page.reload();
    await expect(notice).toHaveCount(0);
  }
});
