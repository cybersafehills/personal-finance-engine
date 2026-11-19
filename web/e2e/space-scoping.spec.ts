import { DESKTOP_LAYOUT, expect, test } from "./fixtures";
import { adminClient, cleanupSeededTransactions, seedTransaction, testUserId } from "./seed";

// Lists and totals follow the ACTIVE Space. The user belongs to several Spaces;
// before this, the transactions list, Home totals, budgets and accounts read every
// Space the user could see, so a phone sitting in a household showed Personal's data.
// Seeds one Personal transaction, creates a household, switches to it (nothing of
// Personal's may show), then back (it shows again). Everything created is torn down.

const TAG = "scope";
const RUN = Math.random().toString(36).slice(2, 8);
const NAME = `Scopetest ${RUN}`;
const HOUSEHOLD = "E2E Scope Household";

test.describe.configure({ mode: "serial" });

async function teardown() {
  const db = adminClient();
  await cleanupSeededTransactions(TAG);
  const userId = await testUserId(db);
  await db.from("workspaces").delete().eq("kind", "household").eq("created_by", userId).eq("name", HOUSEHOLD);
}

test.beforeAll(async () => {
  await teardown();
  await seedTransaction({ tag: TAG, counterpartyName: NAME, direction: "out", amountRwf: 1234 });
});
test.afterAll(teardown);

const listUrl = `/transactions?q=${encodeURIComponent(NAME)}`;

test("a transaction in Personal is not listed while another Space is active, and returns when you switch back", async ({ page, isMobile }) => {
  test.skip(isMobile, DESKTOP_LAYOUT);

  await page.goto(listUrl);
  await expect(page.getByText(NAME).first()).toBeVisible();

  await page.goto("/settings/workspace");
  await page.getByLabel("Household name").fill(HOUSEHOLD);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("heading", { name: HOUSEHOLD })).toBeVisible();

  // Switch to the household through the account menu.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("option", { name: new RegExp(HOUSEHOLD) }).click();
  await expect(page.getByTitle(`Current Space: ${HOUSEHOLD}`)).toBeVisible();

  await page.goto(listUrl);
  await expect(page.getByText(NAME)).toHaveCount(0);

  // Back to Personal: the transaction is there again.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("option", { name: /Personal/ }).click();
  await expect(page.getByTitle("Current Space: Personal")).toBeVisible();
  await page.goto(listUrl);
  await expect(page.getByText(NAME).first()).toBeVisible();
});
