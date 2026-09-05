import { test, expect } from "./fixtures";

// Smoke coverage for the Financial Inbox as the single front door
// (assessment sections 33-35). The seeded e2e user's ledger has no
// actionable work, so this asserts the caught-up state + that Inbox is a
// primary nav destination reachable without going through "More". Inline
// actions themselves need seeded review-queue rows and are covered by the
// per-domain specs (transactions review, spaces-household attribution).

test("Inbox is a primary destination and shows the caught-up state", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .locator("header")
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Inbox" })
    .click();

  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("You’re all caught up")).toBeVisible();
});
