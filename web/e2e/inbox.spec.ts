import { test, expect } from "./fixtures";

// Smoke coverage for the Financial Inbox as the single front door
// (assessment sections 33-35): it is a primary nav destination reachable
// without going through "More", and the page renders. Whether the seeded
// e2e user has open items depends on what other specs in the shared
// worker left behind, so this asserts the page shell, not a specific
// empty/non-empty state. Inline actions are covered by the per-domain
// specs (transactions review, spaces-household attribution).

test("Inbox is a primary destination and its page renders", async ({
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

  // Either the caught-up empty state or a prioritized list is shown -
  // never a blank page.
  const caughtUp = page.getByText("You’re all caught up");
  const summary = page.getByLabel("Inbox summary");
  await expect(caughtUp.or(summary)).toBeVisible();
});
