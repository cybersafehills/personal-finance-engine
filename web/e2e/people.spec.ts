import AxeBuilder from "@axe-core/playwright";
import { DESKTOP_LAYOUT, expect, test } from "./fixtures";
import { cleanupSeededTransactions, seedTransaction } from "./seed";

// OneLedger 3.0 People & merchants (/people, /people/[id]). Seeds three
// transactions with distinct, unmistakable names, sorts them into people
// (backfill_counterparties via "Sort them now", which is idempotent), then
// walks rename -> combine -> undo through the real pages and RPCs.
//
// Names carry a per-run token. The tests rename and combine people, and a
// counterparty outlives its (cleaned-up) transactions, so a retry that reused
// the same names would find them already merged and fail for a reason that has
// nothing to do with the feature. Unique names keep every attempt independent
// and keep other specs' rows out of every search below.

const TAG = "people";
const RUN = Math.random().toString(36).slice(2, 8);
const PREFIX = `Peopletest ${RUN}`;
const ALPHA = `${PREFIX} Alpha`;
const ALPHA_K = `${PREFIX} Alpha K`;
const ALPHA_RENAMED = `${PREFIX} Alpha Renamed`;
const BETA = `${PREFIX} Beta`;

const search = (text: string) => `/people?q=${encodeURIComponent(text)}`;
// A list row's link starts with the person's name; "Alpha" must not match "Alpha K".
const row = (page: import("@playwright/test").Page, name: string, not = "") =>
  page.getByRole("link", { name: new RegExp(`^${name}${not ? `(?!${not})` : ""}`) });
const DETAIL_URL = /\/people\/[0-9a-f-]{36}$/;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  await seedTransaction({ tag: TAG, counterpartyName: ALPHA, direction: "out", amountRwf: 3000 });
  await seedTransaction({ tag: TAG, counterpartyName: ALPHA_K, direction: "out", amountRwf: 2000 });
  await seedTransaction({
    tag: TAG,
    counterpartyName: BETA,
    direction: "in",
    transactionType: "money_received",
    amountRwf: 7000,
  });
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
});

test("unsorted transactions are sorted automatically, then search finds them", async ({ page }) => {
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People and merchants" })).toBeVisible();

  // Opening the page sorts automatically (members); the button is only the
  // retry, so click it if it happens to be showing. Sorting is idempotent.
  const sort = page.getByRole("button", { name: "Sort them now" });
  if (await sort.isVisible()) await sort.click();

  // The backfill runs behind the click; poll until our rows exist rather than
  // asserting anything about the banner (it counts every unsorted row the
  // shared e2e user has, not just ours).
  await expect(async () => {
    await page.goto(search(PREFIX));
    await expect(row(page, BETA)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });

  // The search box drives the URL.
  await page.goto("/people");
  await page.getByLabel("Search by name").fill(PREFIX);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/[?&]q=Peopletest/);
  await expect(row(page, BETA)).toBeVisible();
  await expect(row(page, ALPHA, " K")).toBeVisible();
  await expect(row(page, ALPHA_K)).toBeVisible();

  // The type filter narrows within the search; "All" restores it. Beta is a
  // received-money person, never a merchant, whatever the other tests do.
  await page.getByRole("link", { name: "Merchants" }).click();
  await expect(page).toHaveURL(/kind=merchant/);
  await expect(row(page, BETA)).toHaveCount(0);
  await page.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).not.toHaveURL(/kind=/);
  await expect(row(page, BETA)).toBeVisible();
});

test("rename a person, combine another into them, then undo", async ({ page }) => {
  await page.goto(search(ALPHA));
  await row(page, ALPHA, " K").click();
  await expect(page).toHaveURL(DETAIL_URL);
  await expect(page.getByRole("heading", { name: ALPHA, exact: true })).toBeVisible();

  // Rename + mark as a merchant -> "You confirmed this".
  await page.getByRole("button", { name: "Rename or change type" }).click();
  await page.getByLabel("Name").fill(ALPHA_RENAMED);
  await page.getByLabel("Type").selectOption("merchant");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: ALPHA_RENAMED })).toBeVisible();
  await expect(page.getByText(/You confirmed this/).first()).toBeVisible();

  // Combine "Alpha K" into the person on screen; the one on screen is kept.
  await page.getByRole("button", { name: "Combine with another" }).click();
  await page.getByLabel("Find someone to combine").fill(ALPHA_K);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${ALPHA_K}`) }).click();
  await page.getByRole("button", { name: `Combine ${ALPHA_K} into ${ALPHA_RENAMED}` }).click();
  const combined = page.getByRole("status").filter({ hasText: "Combined" });
  await expect(combined).toContainText(`Combined ${ALPHA_K} into ${ALPHA_RENAMED}`);
  await expect(page.getByRole("heading", { name: "Combined into this one" })).toBeVisible();
  // The survivor now carries both transactions.
  await expect(page.getByRole("heading", { name: /^Transactions/ })).toContainText("(2");

  // Undo restores the two entries.
  await combined.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: "Combined into this one" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Transactions/ })).toContainText("(1");
});

test("a combined-away person redirects to who they became", async ({ page }) => {
  // Remember the renamed entry's URL, then fold it into "Alpha K" (kept).
  await page.goto(search(ALPHA));
  await row(page, ALPHA_RENAMED).click();
  await expect(page).toHaveURL(DETAIL_URL);
  const foldedUrl = page.url();

  await page.goto(search(ALPHA));
  await row(page, ALPHA_K).click();
  await expect(page).toHaveURL(DETAIL_URL);
  const survivorUrl = page.url();
  await page.getByRole("button", { name: "Combine with another" }).click();
  await page.getByLabel("Find someone to combine").fill(ALPHA_RENAMED);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${ALPHA_RENAMED}`) }).click();
  await page.getByRole("button", { name: `Combine ${ALPHA_RENAMED} into ${ALPHA_K}` }).click();
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

test("the More menu lists People and merchants and it opens", async ({ page, isMobile }) => {
  test.skip(isMobile, DESKTOP_LAYOUT);
  await page.goto("/");
  await page
    .locator("header")
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "More" })
    .click();
  const sheet = page.getByRole("dialog", { name: "More" });
  // The sheet's entries are buttons that navigate, not links.
  await sheet.getByRole("button", { name: "People and merchants" }).click();
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

test("full privacy mode hides people's amounts, and the setting is restored", async ({ page }) => {
  const privacyMode = () => page.getByRole("checkbox", { name: /Full financial privacy mode/ });
  await page.goto("/settings/privacy");
  if (!(await privacyMode().isChecked())) {
    await privacyMode().click();
    await expect(page.getByText("Saved")).toBeVisible();
  }
  try {
    await page.goto(search(PREFIX));
    await expect(row(page, BETA)).toBeVisible();
    await expect(page.getByLabel("Amount hidden").first()).toBeVisible();
    // The label stays; the figure is nowhere in the page text.
    await expect(page.getByText(/You received/).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/7,000/);

    await row(page, BETA).click();
    await expect(page.getByRole("heading", { name: BETA, exact: true })).toBeVisible();
    await expect(page.getByLabel("Amount hidden").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/7,000/);
  } finally {
    await page.goto("/settings/privacy");
    if (await privacyMode().isChecked()) {
      await privacyMode().click();
      await expect(page.getByText("Saved")).toBeVisible();
    }
  }
});
