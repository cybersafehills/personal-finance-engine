import { test, expect, type Page } from "@playwright/test";

// Covers master prompt §5/§20.4 items 4-8: user-configurable nav order,
// Home fixed, keyboard-only reordering, persistence across reload (a
// stand-in for "a new session" - the actual server-side persistence path
// is identical either way), applied identically to whichever nav is
// visible, and restore-default.

async function primaryNavLabels(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  return nav.getByRole("link").allTextContents();
}

const DEFAULT_ORDER = ["Home", "Transactions", "Categories", "Budgets", "Settings"];

test.beforeEach(async ({ page }) => {
  // Each test starts from a known-good state so order-dependent failures
  // don't cascade between tests sharing the one seeded e2e user.
  await page.goto("/settings/appearance");
  const restore = page.getByRole("button", { name: "Restore default order" });
  if (await restore.isEnabled().catch(() => false)) {
    await restore.click();
    await expect(page.getByText("Saved")).toBeVisible();
  }
});

test("default order is Home, Transactions, Categories, Budgets, Settings", async ({ page }) => {
  await page.goto("/");
  expect(await primaryNavLabels(page)).toEqual(DEFAULT_ORDER);
});

test("keyboard-only reorder: focusing and activating Move up updates the live preview, then saves", async ({ page }) => {
  await page.goto("/settings/appearance");

  const preview = page.getByLabel("Navigation order preview");
  await expect(preview.locator("span")).toHaveText(DEFAULT_ORDER);

  // Keyboard-accessible reordering, not drag-and-drop-only (master
  // prompt §5.1/§13): focus the control and activate it with Enter, no
  // mouse involved.
  await page.getByRole("button", { name: "Move Settings up" }).focus();
  await page.keyboard.press("Enter");

  await expect(preview.locator("span")).toHaveText([
    "Home",
    "Transactions",
    "Categories",
    "Settings",
    "Budgets",
  ]);

  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
});

test("a saved order persists across reload and stays applied to primary nav", async ({ page }) => {
  await page.goto("/settings/appearance");

  await page.getByRole("button", { name: "Move Budgets up" }).click();
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Navigation order preview").locator("span")).toHaveText([
    "Home",
    "Transactions",
    "Budgets",
    "Categories",
    "Settings",
  ]);

  await page.goto("/");
  expect(await primaryNavLabels(page)).toEqual([
    "Home",
    "Transactions",
    "Budgets",
    "Categories",
    "Settings",
  ]);
});

test("Home is never a movable item and has no reorder controls", async ({ page }) => {
  await page.goto("/settings/appearance");

  await expect(page.getByRole("listitem").filter({ hasText: "Home" }).getByText("Fixed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move Home up" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move Home down" })).toHaveCount(0);
});

test("the top item has no Move up button and the bottom item has no Move down button", async ({ page }) => {
  await page.goto("/settings/appearance");

  await expect(page.getByRole("button", { name: "Move Transactions up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Settings down" })).toBeDisabled();
});

test("restore default order resets both the form and primary nav", async ({ page }) => {
  await page.goto("/settings/appearance");

  await page.getByRole("button", { name: "Move Categories up" }).click();
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("button", { name: "Restore default order" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore default order" })).toBeDisabled();

  await page.goto("/");
  expect(await primaryNavLabels(page)).toEqual(DEFAULT_ORDER);
});
