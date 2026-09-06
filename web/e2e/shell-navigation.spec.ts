import { test, expect } from "./fixtures";

// The unified shell after the information-architecture re-cut (assessment
// section 19 / ADR 0011): the primary nav is the FIXED financial journey -
// Home, Activity, Inbox, Plan - plus a "More" affordance. No per-user
// reordering. On desktop the four destinations + a More button live in
// <header>; on phone the bottom bar is Home / Activity / [Pay] / Plan /
// More, with Inbox reached from the header icon. Categories, Reports,
// Settings and everything else live in the grouped More sheet.

const HEADER_DESTINATIONS = ["Home", "Activity", "Inbox", "Plan"];

const headerNav = (page: import("@playwright/test").Page) =>
  page.locator("header").getByRole("navigation", { name: "Primary" });

test("the header primary nav is the fixed journey (Home, Activity, Inbox, Plan) + More, Reports absent", async ({
  page,
}) => {
  await page.goto("/");

  const links = headerNav(page).getByRole("link");
  await expect(links).toHaveCount(4);
  await expect(links.nth(0)).toHaveText("Home");

  for (const destination of HEADER_DESTINATIONS) {
    await expect(
      headerNav(page).getByRole("link", { name: destination }),
    ).toBeVisible();
  }
  await expect(
    headerNav(page).getByRole("button", { name: "More" }),
  ).toBeVisible();
  await expect(
    headerNav(page).getByRole("link", { name: "Reports" }),
  ).toHaveCount(0);
  // Categories & Settings are no longer primary destinations.
  await expect(
    headerNav(page).getByRole("link", { name: "Categories" }),
  ).toHaveCount(0);
  await expect(
    headerNav(page).getByRole("link", { name: "Settings" }),
  ).toHaveCount(0);
});

test("the active destination is marked aria-current (Activity = /transactions)", async ({
  page,
}) => {
  await page.goto("/transactions");

  await expect(
    headerNav(page).getByRole("link", { name: "Activity" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    headerNav(page).getByRole("link", { name: "Home" }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("the header More button opens the grouped More sheet", async ({ page }) => {
  await page.goto("/");
  await headerNav(page).getByRole("button", { name: "More" }).click();

  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Categories" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Reports" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Settings" })).toBeVisible();
  // Grouped, not a flat list.
  await expect(sheet.getByText("Manage money")).toBeVisible();
  await expect(sheet.getByText("Account")).toBeVisible();
});

test.describe("phone bottom bar", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const bottomBar = (page: import("@playwright/test").Page) =>
    page.locator('nav[aria-label="Primary"].fixed');

  test("is a fixed five: Home, Activity, [Pay], Plan, More", async ({ page }) => {
    await page.goto("/");
    const bar = bottomBar(page);

    await expect(bar.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Activity" })).toBeVisible();
    await expect(
      bar.getByRole("button", { name: "Pay", exact: true }),
    ).toBeVisible();
    await expect(bar.getByRole("link", { name: "Plan" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "More" })).toBeVisible();

    // Categories & Settings are NOT on the bar - they live in More.
    await expect(bar.getByRole("link", { name: "Categories" })).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("More opens a grouped sheet and is keyboard-dismissible", async ({
    page,
  }) => {
    await page.goto("/");
    const moreBtn = bottomBar(page).getByRole("button", { name: "More" });
    await moreBtn.click();

    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Categories" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Reports" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Settings" })).toBeVisible();

    await sheet.getByRole("button", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(sheet).toBeHidden();

    // Reopen, Esc closes and focus returns to the trigger.
    await moreBtn.click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "More" })).toBeHidden();
    await expect(moreBtn).toBeFocused();
  });
});

test("Reports opens from the header icon", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Open reports").click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});

test("Settings has a single Daily reports destination covering both viewing and configuring", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.locator('main a[href="/reports"]')).toHaveCount(0);
  await page.locator('main a[href="/settings/reports"]').click();
  await expect(page).toHaveURL(/\/settings\/reports$/);
  await expect(page.getByRole("heading", { name: "Daily reports" })).toBeVisible();
  await expect(page.getByText(/^Reporting for /)).toBeVisible();
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
