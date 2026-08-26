import { test, expect } from "./fixtures";

// Covers master prompt §6/§20.4 items 9-14: the balance eye/eye-off
// control, its persistence, full privacy mode masking every sensitive
// dashboard figure (not just the balance), and turning it back off.
// Uses the seeded e2e user, which has no transactions/budget - the
// legitimate empty-state numbers ("—", 0 totals) are themselves a stable,
// deterministic thing to assert the masked/unmasked text against.

test.beforeEach(async ({ page }) => {
  // Known starting privacy state for every test in this file, regardless
  // of what a previous test in the same worker left behind. "Saved" is
  // only ever asserted when a click actually happened - on the very
  // first run both checkboxes are already at their default (unchecked)
  // state, so neither click fires and there is nothing to wait for.
  await page.goto("/settings/privacy");
  const hideBalanceCheckbox = page.getByRole("checkbox", { name: /Hide balance when OneLedger opens/ });
  if (await hideBalanceCheckbox.isChecked()) {
    await hideBalanceCheckbox.click();
    await expect(page.getByText("Saved")).toBeVisible();
  }
  const privacyModeCheckbox = page.getByRole("checkbox", { name: /Full financial privacy mode/ });
  if (await privacyModeCheckbox.isChecked()) {
    await privacyModeCheckbox.click();
    await expect(page.getByText("Saved")).toBeVisible();
  }
});

test("the balance eye control toggles visibility and persists across reload", async ({ page }) => {
  await page.goto("/");

  const balanceToggle = page.getByLabel("Hide current balance");
  await expect(balanceToggle).toBeVisible();
  await expect(page.getByText("••••••")).toHaveCount(0);

  await balanceToggle.click();
  await expect(page.getByLabel("Show current balance")).toBeVisible();
  await expect(page.getByText("••••••")).toBeVisible();

  await page.reload();
  // No flash of the real value before the persisted preference resolves -
  // the server-rendered first paint already reflects hide_balance=true
  // (see PrivacyProvider's bootstrap-from-props comment), so the masked
  // placeholder must be present immediately, not after a client effect.
  await expect(page.getByLabel("Show current balance")).toBeVisible();
  await expect(page.getByText("••••••")).toBeVisible();
});

test("full privacy mode masks the balance, today's totals, and disables the standalone eye toggle", async ({ page }) => {
  await page.goto("/settings/privacy");
  await page.getByRole("checkbox", { name: /Full financial privacy mode/ }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goto("/");

  await expect(page.getByText("••••••").first()).toBeVisible();
  await expect(page.getByLabel("Balance hidden by full privacy mode")).toBeDisabled();

  // Every masked amount ("Amount hidden") shares one accessible name and
  // never exposes a real figure to assistive tech (master prompt §6.1's
  // explicit "not in aria-label" requirement).
  const maskedAmounts = page.getByLabel("Amount hidden");
  expect(await maskedAmounts.count()).toBeGreaterThan(0);
});

test("disabling full privacy mode restores normal (unmasked) values", async ({ page }) => {
  await page.goto("/settings/privacy");
  const privacyModeCheckbox = page.getByRole("checkbox", { name: /Full financial privacy mode/ });
  await privacyModeCheckbox.click();
  await expect(page.getByText("Saved")).toBeVisible();

  await privacyModeCheckbox.click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.goto("/");
  await expect(page.getByLabel("Hide current balance")).toBeEnabled();
  await expect(page.getByText("••••••")).toHaveCount(0);
});

test("a failed save rolls back the balance toggle rather than leaving a stale UI state", async ({ page }) => {
  await page.goto("/");
  const balanceToggle = page.getByLabel("Hide current balance");

  // setHideBalance is a Next.js Server Action - the browser's own request
  // for it is a POST to the current URL carrying a `Next-Action` header,
  // never a direct call to Supabase's REST API (that happens server-side,
  // invisible to the browser's network layer). Abort exactly that request
  // to simulate a persistence failure for this one save only.
  await page.route("**/*", (route) => {
    const isServerAction = route.request().method() === "POST" &&
      route.request().headers()["next-action"] !== undefined;
    if (isServerAction) {
      route.abort();
    } else {
      route.continue();
    }
  });

  await balanceToggle.click();

  // The optimistic flip and the abort-triggered rollback both happen
  // client-side with no real network latency in this test, so the
  // transient "optimistic" state can already be gone by the time an
  // assertion polls for it - only the settled end state (rolled back to
  // "Hide current balance" once the save is confirmed to have failed;
  // see PrivacyProvider.toggleBalanceVisible's rollback-on-failure path)
  // is a reliable thing to assert on here.
  await expect(page.getByLabel("Hide current balance")).toBeVisible();

  await page.unroute("**/*");
});
