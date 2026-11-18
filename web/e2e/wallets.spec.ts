import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { ensureWorkspaceAndAccount } from "./seed";

// OneLedger 3.0 Wallets (/wallets): each wallet's balance with an honest
// label, and "I checked my balance". A typed balance must come back as an
// estimate based on the user's own statement - never "Confirmed".
// (balance_observations is append-only by design, so this spec leaves its
// rows behind; it asserts on labels, not on a specific amount.)

test.beforeAll(async () => {
  await ensureWorkspaceAndAccount();
});

const firstWallet = (page: import("@playwright/test").Page) =>
  page.locator("section[aria-labelledby^='wallet-']").first();

test("every wallet shows a balance label and what it means", async ({ page }) => {
  await page.goto("/wallets");
  await expect(page.getByRole("heading", { name: "Wallets", level: 1 }))
    .toBeVisible();
  const wallet = firstWallet(page);
  await expect(wallet).toBeVisible();
  await expect(
    wallet.getByText(/^(Confirmed|Estimated|Out of date|Not available)$/),
  ).toBeVisible();
  await expect(page.getByText(/OneLedger never asks your provider/))
    .toBeVisible();
});

test("Wallets explains itself, says how each balance stays current, and offers to add a wallet", async ({ page }) => {
  await page.goto("/wallets");
  await page.getByText("What are wallets for?").click();
  await expect(page.getByText(/never blended into one number/)).toBeVisible();
  // Every wallet says how its balance gets (or stays) current.
  await expect(
    firstWallet(page).getByText(
      /Updates by itself|You entered this balance|To get a balance here/,
    ),
  ).toBeVisible();
  // Adding is inline: the form opens, and an empty name cannot be submitted.
  await page.getByRole("button", { name: "Add a wallet" }).click();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add wallet" })).toBeDisabled();
});

test("an invalid balance is refused with a reason and nothing is saved", async ({ page }) => {
  await page.goto("/wallets");
  const wallet = firstWallet(page);
  await wallet.getByRole("button", { name: /I checked my balance/ }).click();
  await wallet.getByLabel(/^Balance/).fill("12.5");
  await wallet.getByRole("button", { name: "Save balance" }).click();
  await expect(wallet.getByRole("alert")).toContainText("Enter a whole number");
  await expect(wallet.getByRole("button", { name: "Save balance" })).toBeVisible();
});

test("a typed balance is saved as the user's statement, never Confirmed", async ({ page }) => {
  await page.goto("/wallets");
  const wallet = firstWallet(page);
  await wallet.getByRole("button", { name: /I checked my balance/ }).click();
  await wallet.getByLabel(/^Balance/).fill("78,900");
  await wallet.getByLabel(/^Note/).fill("e2e check");
  await wallet.getByRole("button", { name: "Save balance" }).click();

  await expect(wallet.getByRole("status")).toContainText("Saved");
  await expect(wallet.getByText("Based on the balance you entered.")).toBeVisible();
  await expect(wallet.getByText(/entered by a member of this Space/)).toBeVisible();
  await expect(wallet.getByText(/^Confirmed$/)).toHaveCount(0);
  await expect(wallet.getByText("Balances entered by hand")).toBeVisible();
  await expect(wallet.getByText(/e2e check/).first()).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`Wallets has no serious/critical accessibility violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/wallets");
    await expect(firstWallet(page)).toBeVisible();
    await firstWallet(page).getByRole("button", { name: /I checked my balance/ }).click();
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
  });
}
