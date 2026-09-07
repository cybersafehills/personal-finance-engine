import { test, expect } from "./fixtures";
import { cleanupSeededTransactions, seedTransaction } from "./seed";

// PR #149: the /transactions ledger gained a search box + a collapsible
// filter row (direction / account / currency / min-max amount), every
// control URL-driven so the server component re-queries and deep links
// stay shareable.

const TAG = "search";

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Alice UWASE",
    transactionType: "send_money",
    direction: "out",
    amountRwf: 5000,
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Bob MUGABO",
    transactionType: "merchant_payment",
    direction: "out",
    amountRwf: 25000,
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Carol INEZA",
    transactionType: "money_received",
    direction: "in",
    amountRwf: 40000,
  });
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
});

const row = (page: import("@playwright/test").Page, name: RegExp) =>
  page.getByRole("link", { name });

test("free-text search narrows the ledger and Clear restores it", async ({ page }) => {
  await page.goto("/transactions");
  await expect(row(page, /Alice UWASE/)).toBeVisible();
  await expect(row(page, /Bob MUGABO/)).toBeVisible();
  await expect(row(page, /Carol INEZA/)).toBeVisible();

  await page.getByLabel("Search transactions").fill("Alice");
  await expect(page).toHaveURL(/[?&]q=Alice/);
  await expect(row(page, /Alice UWASE/)).toBeVisible();
  await expect(row(page, /Bob MUGABO/)).toHaveCount(0);

  await page.getByRole("button", { name: "Clear search & filters" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(row(page, /Bob MUGABO/)).toBeVisible();
});

test("the direction filter is applied from the collapsible row", async ({ page }) => {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Filters" }).click();

  await page.getByLabel("Direction").selectOption("in");
  await expect(page).toHaveURL(/[?&]direction=in/);
  await expect(row(page, /Carol INEZA/)).toBeVisible();
  await expect(row(page, /Alice UWASE/)).toHaveCount(0);

  await page.getByRole("button", { name: "Clear search & filters" }).click();
  await expect(row(page, /Alice UWASE/)).toBeVisible();
});

test("a deep link with query params renders filtered on first load", async ({ page }) => {
  await page.goto("/transactions?q=Bob");
  await expect(row(page, /Bob MUGABO/)).toBeVisible();
  await expect(row(page, /Alice UWASE/)).toHaveCount(0);
  await expect(page.getByLabel("Search transactions")).toHaveValue("Bob");
});
