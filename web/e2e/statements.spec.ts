import { expect, test } from "./fixtures";
import {
  adminClient,
  cleanupSeededTransactions,
  ensureWorkspaceAndAccount,
  seedTransaction,
} from "./seed";

// PR5: the /reports/statements area - a landing/history list, a staged
// generate flow (account -> period -> type -> preview -> generate), and a
// detail page with PDF / CSV download links. Gated by
// FINANCIAL_STATEMENTS_ENABLED (set for this suite in playwright.config.ts).

const TAG = "statements";

async function wipeStatements() {
  const admin = adminClient();
  const { workspaceId } = await ensureWorkspaceAndAccount(admin);
  await admin.from("statements").delete().eq("workspace_id", workspaceId);
}

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  await wipeStatements();
  const now = new Date().toISOString();
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Stmt Payroll Ltd",
    transactionType: "money_received",
    direction: "in",
    amountRwf: 400_000,
    occurredAt: now,
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Stmt Corner Shop",
    transactionType: "merchant_payment",
    direction: "out",
    amountRwf: 12_500,
    occurredAt: now,
  });
  await seedTransaction({
    tag: TAG,
    counterpartyName: "Stmt Landlord",
    transactionType: "send_money",
    direction: "out",
    amountRwf: 150_000,
    feeRwf: 500,
    occurredAt: now,
  });
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
  await wipeStatements();
});

test("generate a statement end to end, then find and download it", async ({ page }) => {
  await page.goto("/reports/statements");
  await expect(
    page.getByRole("heading", { name: "Statements" }),
  ).toBeVisible();
  await expect(page.getByText("No statements yet")).toBeVisible();

  await page.getByRole("link", { name: "Generate statement" }).first().click();
  await expect(page).toHaveURL(/\/reports\/statements\/new$/);

  await page.getByLabel("Statement period").selectOption("this_month");
  await page.getByRole("button", { name: "Preview statement" }).click();

  await expect(page.getByText("Statement preview")).toBeVisible();
  await expect(page.getByText(/3 transactions available/)).toBeVisible();
  await expect(page.getByText("Stmt Payroll Ltd")).toBeVisible();

  await page.getByRole("button", { name: "Generate statement" }).click();
  await expect(page).toHaveURL(
    /\/reports\/statements\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByText("Ready")).toBeVisible();

  const pdf = page.getByRole("link", { name: "Download PDF" });
  await expect(pdf).toBeVisible();
  const pdfHref = await pdf.getAttribute("href");
  expect(pdfHref).toMatch(
    /\/api\/reports\/statements\/[0-9a-f-]{36}\/document\?format=pdf$/,
  );
  await expect(
    page.getByRole("link", { name: "Download CSV" }),
  ).toBeVisible();

  // The document route redirects to a short-lived signed URL rather than
  // streaming bytes itself.
  const res = await page.request.get(pdfHref!, { maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);

  await page.getByRole("link", { name: "Statements" }).click();
  await expect(page).toHaveURL(/\/reports\/statements$/);
  await expect(page.getByText("No statements yet")).toHaveCount(0);
  await expect(page.getByText(/3 transactions/).first()).toBeVisible();
});

test("a custom range with no activity is refused, not left blank", async ({ page }) => {
  await page.goto("/reports/statements/new");
  await page.getByLabel("Statement period").selectOption("custom");
  await page.getByLabel("From").fill("2019-01-01");
  await page.getByLabel("To").fill("2019-01-31");
  await page.getByRole("button", { name: "Preview statement" }).click();

  await expect(
    page.getByText(/No transactions were found/),
  ).toBeVisible();
});
