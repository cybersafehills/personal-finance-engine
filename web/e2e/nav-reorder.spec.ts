import { test, expect } from "./fixtures";

// The per-user "Arrange navigation" preference was retired in the IA
// re-cut (ADR 0011): the primary navigation is now a fixed financial
// journey, so guidance and help can rely on its order. This spec replaces
// the old reorder suite - it asserts the feature is gone and the primary
// nav is stable.

const FIXED_JOURNEY = ["Home", "Transactions", "Inbox", "Plan"];

async function headerNavLabels(page: import("@playwright/test").Page) {
  return page
    .locator("header")
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link")
    .allTextContents();
}

test("the primary nav is a fixed journey: Home, Transactions, Inbox, Plan", async ({
  page,
}) => {
  await page.goto("/");
  expect(await headerNavLabels(page)).toEqual(FIXED_JOURNEY);
});

test("Appearance settings no longer offers navigation reordering", async ({
  page,
}) => {
  await page.goto("/settings/appearance");

  await expect(
    page.getByRole("heading", { name: "Appearance and navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Move .* up/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Restore default order" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save order" }),
  ).toHaveCount(0);

  // It explains the fixed journey instead.
  await expect(page.getByText("financial lifecycle")).toBeVisible();
});

test("the fixed order is identical after a reload (no stored preference to drift)", async ({
  page,
}) => {
  await page.goto("/");
  const before = await headerNavLabels(page);
  await page.reload();
  expect(await headerNavLabels(page)).toEqual(before);
  expect(before).toEqual(FIXED_JOURNEY);
});
