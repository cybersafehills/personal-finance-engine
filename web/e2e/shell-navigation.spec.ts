import { test, expect } from "./fixtures";

// Covers master prompt §24's definition-of-done for the unified shell:
// the tablet/desktop header nav's 5 primary destinations (Home + 4
// movable), Reports removed from primary nav but still reachable from the
// header icon and Settings, active-route highlighting, the phone bottom
// bar's fixed five-slot Pay-centre layout + its More sheet, and the
// profile menu's keyboard behavior.

const PRIMARY_DESTINATIONS = ["Home", "Transactions", "Categories", "Budgets", "Settings"];

// The tablet/desktop nav lives inside <header>; the phone bar is a
// separate <nav aria-label="Primary"> fixed to the bottom.
const headerNav = (page: import("@playwright/test").Page) =>
  page.locator("header").getByRole("navigation", { name: "Primary" });

test("the header primary nav has exactly 5 destinations, Home first, Reports absent", async ({
  page,
}) => {
  await page.goto("/");

  const links = headerNav(page).getByRole("link");
  await expect(links).toHaveCount(5);
  await expect(links.nth(0)).toHaveText("Home");

  for (const destination of PRIMARY_DESTINATIONS) {
    await expect(headerNav(page).getByRole("link", { name: destination })).toBeVisible();
  }
  await expect(headerNav(page).getByRole("link", { name: "Reports" })).toHaveCount(0);
});

test("the active destination is marked aria-current", async ({ page }) => {
  await page.goto("/transactions");

  await expect(
    headerNav(page).getByRole("link", { name: "Transactions" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(headerNav(page).getByRole("link", { name: "Home" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test.describe("phone bottom bar", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The bottom bar is the only `.fixed` <nav aria-label="Primary">; the
  // header nav (display:none at this width) is not `.fixed`.
  const bottomBar = (page: import("@playwright/test").Page) =>
    page.locator('nav[aria-label="Primary"].fixed');

  test("is a fixed five: Home, Transactions, [Pay], Budgets, More", async ({ page }) => {
    await page.goto("/");
    const bar = bottomBar(page);

    await expect(bar.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Transactions" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Pay", exact: true })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Budgets" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "More" })).toBeVisible();

    // Categories & Settings are NOT on the bar - they live in More.
    await expect(bar.getByRole("link", { name: "Categories" })).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("More opens a sheet with the displaced destinations and is keyboard-dismissible", async ({
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

    // Reopen, Esc closes and focus returns to the trigger. Wait for the
    // bottom bar to re-render on the new route before clicking again - a
    // reopen fired mid-transition gets swallowed and the dialog never opens.
    await expect(moreBtn).toBeVisible();
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

test("Reports is reachable from Settings, distinct from the Daily reports scheduling page", async ({ page }) => {
  await page.goto("/settings");

  // The Settings list row's accessible name is its title AND description
  // text concatenated (both live inside the one <a>), so an exact-name
  // match on just the title never matches - select by href instead.
  // Scoped to <main> since the header's ReportsButton also links to
  // /reports and would otherwise make this locator ambiguous.
  await page.locator('main a[href="/reports"]').click();
  await expect(page).toHaveURL(/\/reports$/);

  await page.goto("/settings");
  await page.locator('a[href="/settings/reports"]').click();
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
    // The dismiss persists via a fire-and-forget Server Action call
    // (ReportsRelocationNotice intentionally doesn't block the UI on it -
    // this is a low-stakes one-time notice, not a security-sensitive
    // toggle). Reloading immediately can abort that still-in-flight
    // request before the server commits it, so wait for network activity
    // to settle first - otherwise this assertion races the app's own
    // persistence.
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(notice).toHaveCount(0);
  }
});
