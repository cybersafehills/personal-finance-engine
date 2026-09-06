import { expect, test } from "./fixtures";

// The setup review screen (master prompt section 19). It is gated by
// ONBOARDING_JOURNEY_ENABLED like /onboarding/intent: dark in CI, so the
// route redirects to /get-started. This asserts the route is coherent in
// both states and never 500s; the rendered screen is covered by the pure
// milestone tests plus a11y.
test("the setup review route resolves to a coherent screen", async ({ page }) => {
  await page.goto("/onboarding/review");
  await expect(page).toHaveURL(/\/(onboarding\/review|get-started)$/);
  await expect(page.getByRole("heading").first()).toBeVisible();
});
