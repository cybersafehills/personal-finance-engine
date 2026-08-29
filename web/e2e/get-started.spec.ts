import { test, expect } from "./fixtures";

// PR4: the guided onboarding checklist. Shares the one seeded e2e user,
// whose exact step progress depends on what other specs have done, so
// this asserts structure (the route renders, the four steps or the
// "all set" state, the progress line, the guide link) rather than a
// specific done-count.

test("the /get-started checklist renders and links onward", async ({ page }) => {
  await page.goto("/get-started");

  await expect(
    page.getByRole("heading", { name: "Get started" }),
  ).toBeVisible();
  await expect(page.getByText(/\d of 4 done/)).toBeVisible();

  // Either the step list or the completed state.
  const stepList = page.getByText("Add a financial account");
  const allSet = page.getByText(/You.re all set/);
  await expect(stepList.or(allSet).first()).toBeVisible();

  await expect(
    page.getByRole("link", { name: /step-by-step setup guide/i }),
  ).toBeVisible();
});

test("the dashboard nudge, when shown, points at /get-started", async ({
  page,
}) => {
  await page.goto("/");

  const nudge = page.getByRole("region", { name: "Finish setting up" });
  // The nudge only shows while onboarding is incomplete and undismissed;
  // if a prior spec completed or dismissed it, there is nothing to check.
  if (await nudge.isVisible().catch(() => false)) {
    await expect(nudge.getByText(/\d of 4 done/)).toBeVisible();
    await nudge.getByRole("link", { name: "See all steps" }).click();
    await expect(page).toHaveURL(/\/get-started$/);
  }
});
