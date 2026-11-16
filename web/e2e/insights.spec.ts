import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { cleanupSeededTransactions, seedTransaction } from "./seed";

// OneLedger 3.0 Insights Center (/insights). Seeds a closed, long-past month
// so no other spec's "now"-dated rows can land in the period, then checks
// the headline figures against hand-computed totals and that a drill-down
// lists exactly the rows behind its figure.

const TAG = "insights";
const PERIOD = "period=custom&from=2024-03-01&to=2024-03-31";

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  const at = (day: string) => `2024-03-${day}T09:00:00.000Z`;
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Insights Employer",
    transactionType: "money_received",
    direction: "in",
    amountRwf: 40000,
    occurredAt: at("05"),
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Insights Grocer",
    transactionType: "merchant_payment",
    direction: "out",
    amountRwf: 5000,
    feeRwf: 100,
    category: "Insights Food",
    occurredAt: at("06"),
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Insights Grocer",
    transactionType: "merchant_payment",
    direction: "out",
    amountRwf: 25000,
    category: "Insights Food",
    occurredAt: at("12"),
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Insights Agent",
    transactionType: "cash_withdrawal",
    direction: "out",
    amountRwf: 10000,
    occurredAt: at("20"),
  });
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
});

test("headline totals match the seeded month exactly", async ({ page }) => {
  await page.goto(`/insights?${PERIOD}`);
  await expect(page.getByRole("heading", { name: "Insights", level: 1 }))
    .toBeVisible();

  const rwf = page.getByRole("region", { name: "RWF insights" });
  // in 40,000; out 5,100 + 25,000 + 10,000 = 40,100; net -100
  await expect(rwf.getByText("40,000 RWF").first()).toBeVisible();
  await expect(rwf.getByText("40,100 RWF").first()).toBeVisible();
  await expect(rwf.getByText("−100 RWF").first()).toBeVisible();

  const categories = rwf.getByRole("table", { name: /Money out by category/ });
  await expect(
    categories.getByRole("row", { name: /Insights Food.*30,100 RWF/ }),
  ).toBeVisible();
  await expect(
    categories.getByRole("row", { name: /Cash out.*10,000 RWF/ }),
  ).toBeVisible();
  await expect(rwf.getByText(/withdrawn as cash/)).toBeVisible();
});

test("a category drills down to exactly its transactions", async ({ page }) => {
  await page.goto(`/insights?${PERIOD}`);
  await page.getByRole("link", { name: "Insights Food" }).click();
  await expect(page).toHaveURL(/\/insights\/transactions\?/);
  await expect(page.getByText("2 transactions behind this figure."))
    .toBeVisible();
  await expect(page.getByRole("link", { name: /Insights Grocer/ }))
    .toHaveCount(2);
  await expect(page.getByRole("link", { name: /Insights Employer/ }))
    .toHaveCount(0);

  await page.getByRole("link", { name: /Insights$/ }).first().click();
  await expect(page).toHaveURL(/\/insights\?.*from=2024-03-01/);
  // Going back must not add a currency filter the user never chose.
  expect(page.url()).not.toContain("currency=");
});

test("an empty period says so instead of showing zeros", async ({ page }) => {
  await page.goto("/insights?period=custom&from=2019-01-01&to=2019-01-31");
  await expect(page.getByText("Nothing to show for this period")).toBeVisible();
});

test("a malformed drill-down link is a not-found, not an error", async ({ page }) => {
  await page.goto(`/insights/transactions?${PERIOD}&kind=everything&cur=RWF`);
  await expect(page.getByText("We couldn't find that.")).toBeVisible();
  await expect(page.getByText(/behind this figure/)).toHaveCount(0);
});

test("Insights has no serious/critical automated accessibility violations", async ({ page }) => {
  await page.goto(`/insights?${PERIOD}`);
  await expect(page.getByRole("region", { name: "RWF insights" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});

test("Insights at phone width has no serious/critical accessibility violations", async ({ page }) => {
  // The tables scroll sideways on a phone; that scroll area must be
  // keyboard-reachable (caught by the mobile-safari run, pinned here so the
  // blocking chromium project covers it too).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/insights?${PERIOD}`);
  await expect(page.getByRole("region", { name: "RWF insights" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});
