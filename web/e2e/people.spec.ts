import AxeBuilder from "@axe-core/playwright";
import { DESKTOP_LAYOUT, expect, test } from "./fixtures";
import { cleanupSeededTransactions, seedTransaction } from "./seed";

// OneLedger 3.0 People & merchants (/people, /people/[id]). Seeds three
// transactions with distinct, unmistakable names, sorts them into people
// (backfill_counterparties via "Sort them now", which is idempotent), then
// walks rename -> combine -> undo through the real pages and RPCs.
//
// Names are unique to this spec ("Peopletest ...") so other specs' seeded
// rows can't match, and every search below is scoped to them.

const TAG = "people";
const ALPHA = "Peopletest Alpha";
const ALPHA_K = "Peopletest Alpha K";
const BETA = "Peopletest Beta";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  await seedTransaction({ tag: TAG, counterpartyName: ALPHA, direction: "out", amountRwf: 3000 });
  await seedTransaction({ tag: TAG, counterpartyName: ALPHA_K, direction: "out", amountRwf: 2000 });
  await seedTransaction({ tag: TAG, counterpartyName: BETA, direction: "in", transactionType: "money_received", amountRwf: 7000 });
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
});

test("unsorted transactions are offered for sorting, then search finds them", async ({ page }) => {
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People and merchants" })).toBeVisible();

  // The banner only shows while something is unsorted; sorting is idempotent.
  const sort = page.getByRole("button", { name: "Sort them now" });
  if (await sort.isVisible()) {
    await sort.click();
    await expect(sort).toBeHidden();
  }

  await page.getByLabel("Search by name").fill("Peopletest");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/[?&]q=Peopletest/);
  await expect(page.getByRole("link", { name: new RegExp(`^${BETA}`) })).toBeVisible();
  // (Alpha entries are renamed/combined by the next tests, so a retry may find
  // them changed; Beta is never touched, which keeps this assertion stable.)

  // The type filter narrows within the search; "All" restores it.
  await page.getByRole("link", { name: "Merchants" }).click();
  await expect(page).toHaveURL(/kind=merchant/);
  await expect(page.getByRole("link", { name: new RegExp(`^${BETA}`) })).toHaveCount(0);
  await page.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).not.toHaveURL(/kind=/);
  await expect(page.getByRole("link", { name: new RegExp(`^${BETA}`) })).toBeVisible();
});

test("rename a person, combine another into them, then undo", async ({ page }) => {
  await page.goto("/people?q=Peopletest+Alpha");
  await page.getByRole("link", { name: new RegExp(`^${ALPHA}(?! K)`) }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: ALPHA, exact: true })).toBeVisible();

  // Rename + mark as a merchant -> "You confirmed this".
  await page.getByRole("button", { name: "Rename or change type" }).click();
  await page.getByLabel("Name").fill("Peopletest Alpha Renamed");
  await page.getByLabel("Type").selectOption("merchant");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Peopletest Alpha Renamed" })).toBeVisible();
  await expect(page.getByText(/You confirmed this/).first()).toBeVisible();

  // Combine "Alpha K" into the person on screen; the one on screen is kept.
  await page.getByRole("button", { name: "Combine with another" }).click();
  await page.getByLabel("Find someone to combine").fill("Peopletest Alpha K");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${ALPHA_K}`) }).click();
  await page.getByRole("button", { name: `Combine ${ALPHA_K} into Peopletest Alpha Renamed` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Combined" })).toContainText(`Combined ${ALPHA_K} into Peopletest Alpha Renamed`);
  await expect(page.getByRole("heading", { name: "Combined into this one" })).toBeVisible();
  // The survivor now carries both transactions.
  await expect(page.getByRole("heading", { name: /^Transactions/ })).toContainText("(2");

  // Undo restores the two entries.
  await page.getByRole("status").filter({ hasText: "Combined" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: "Combined into this one" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Transactions/ })).toContainText("(1");
});

test("a combined-away person redirects to who they became", async ({ page }) => {
  // Remember the renamed entry's URL, then fold it into "Alpha K" (kept).
  await page.goto("/people?q=Peopletest+Alpha");
  await page.getByRole("link", { name: /^Peopletest Alpha Renamed/ }).click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  const foldedUrl = page.url();

  await page.goto("/people?q=Peopletest+Alpha");
  await page.getByRole("link", { name: new RegExp(`^${ALPHA_K}`) }).click();
  const survivorUrl = page.url();
  await page.getByRole("button", { name: "Combine with another" }).click();
  await page.getByLabel("Find someone to combine").fill("Peopletest Alpha Renamed");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /^Peopletest Alpha Renamed/ }).click();
  await page.getByRole("button", { name: `Combine Peopletest Alpha Renamed into ${ALPHA_K}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Combined" })).toBeVisible();

  // The old entry no longer stands alone: its URL lands on the survivor.
  await page.goto(foldedUrl);
  await expect(page).toHaveURL(survivorUrl);
  await expect(page.getByRole("heading", { name: ALPHA_K, exact: true })).toBeVisible();
});

test("a malformed or unknown person is a not-found, not an error", async ({ page }) => {
  await page.goto("/people/not-a-uuid");
  await expect(page.getByText("We couldn't find that.")).toBeVisible();
  await page.goto("/people/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("We couldn't find that.")).toBeVisible();
});

test("the More menu lists People and merchants and it opens", async ({ page }) => {
  test.skip(({ isMobile }) => isMobile, DESKTOP_LAYOUT);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).first().getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await sheet.getByRole("link", { name: "People and merchants" }).click();
  await expect(page).toHaveURL(/\/people$/);
});

test("People has no serious/critical automated accessibility violations", async ({ page }) => {
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People and merchants" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
});
