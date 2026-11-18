import { expect, test } from "@playwright/test";

// Read-only page: it only proposes rules (each links to the normal New rule form).
test("Starter rules page renders and is reachable from Categorization rules", async ({ page }) => {
  await page.goto("/categories/rules");
  await page.getByRole("link", { name: "Starter rules" }).click();
  await expect(page).toHaveURL(/\/categories\/rules\/starter/);
  await expect(page.getByRole("heading", { name: "Starter rules" })).toBeVisible();
  // Either proposals or an honest empty state - never an error page.
  await expect(page.getByText(/Nothing is applied until you create the rule/)).toBeVisible();
});
