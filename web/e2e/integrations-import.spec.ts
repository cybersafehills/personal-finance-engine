import ExcelJS from "exceljs";
import { test, expect } from "./fixtures";
import {
  adminClient,
  cleanupImportArtifacts,
  ensureImportTargetSource,
} from "./seed";

// The Import Studio end-to-end: upload -> map -> review -> commit ->
// rows in the ledger, plus the multi-sheet workbook analyzer (#167) and
// file-type rejection. chromium-desktop only (Track B e2e; the
// cross-browser projects skip `integrations-import` in
// playwright.config.ts) — it seeds a financial source + account and
// commits real `transactions`, cleaned up in afterAll.

const CSV = [
  "Date,Merchant,Description,Amount,Currency",
  "02/02/2026,E2E Import Alpha,card payment,5000,RWF",
  "03/02/2026,E2E Import Bravo,invoice 12,12000,RWF",
  "04/02/2026,E2E Import Charlie,supplies,8000,RWF",
].join("\n");

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function twoSheetWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sales = wb.addWorksheet("Sales");
  sales.addRow(["Date", "Merchant", "Amount", "Currency"]);
  sales.addRow(["02/02/2026", "E2E WB Alpha", "5000", "RWF"]);
  sales.addRow(["03/02/2026", "E2E WB Bravo", "7000", "RWF"]);
  const notes = wb.addWorksheet("Notes");
  notes.addRow(["Topic", "Detail"]);
  notes.addRow(["reminder", "call the supplier"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test.beforeAll(async () => {
  const admin = adminClient();
  await cleanupImportArtifacts(admin);
  await ensureImportTargetSource(admin);
});

test.afterAll(async () => {
  await cleanupImportArtifacts();
});

test("a CSV imports end to end and the rows land in the ledger", async ({ page }) => {
  await page.goto("/integrations/imports/new");
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  await page.getByRole("button", { name: /Upload and detect/ }).click();

  await expect(page).toHaveURL(/\/integrations\/imports\/[0-9a-f-]{36}$/);
  await expect(page.getByText("What we detected")).toBeVisible();

  // The mapping is pre-filled from the header names — apply it as-is.
  await page.getByRole("button", { name: /Apply mapping and validate/ }).click();
  await expect(
    page.getByRole("heading", { name: "Review and import" }),
  ).toBeVisible();

  await page.getByLabel("Import into").selectOption({
    label: "E2E Import Source (RWF)",
  });
  await page.getByRole("button", { name: "Set account" }).click();
  await page.getByRole("button", { name: /Import \d+ ready rows?/ }).click();

  await page.goto("/transactions");
  await expect(
    page.getByRole("link", { name: /E2E Import Alpha/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /E2E Import Charlie/ }),
  ).toBeVisible();
});

test("an expense register imports as money-out, and a row without a category is blocked", async ({ page }) => {
  // "Supplier" isn't a merchant synonym for suggestMapping, so the row's
  // visible name comes from Description — put the marker there.
  const csv = [
    "Date,Supplier,Description,Category,Amount,Currency",
    "05/02/2026,Office Ltd,E2E Expense Kept,Office,4000,RWF",
    "06/02/2026,Taxi Co,E2E Expense Blocked,,2500,RWF",
  ].join("\n");

  await page.goto("/integrations/imports/new?target=expense");
  await expect(
    page.getByRole("heading", { name: "Import an expense register", level: 1 }),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "expenses.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: /Upload and detect/ }).click();
  await expect(page).toHaveURL(/\/integrations\/imports\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Every row imports as money out/)).toBeVisible();

  await page.getByRole("button", { name: /Apply mapping and validate/ }).click();
  await expect(
    page.getByRole("heading", { name: "Review and import" }),
  ).toBeVisible();
  // One row is ready, the uncategorised one is blocked.
  await expect(page.getByRole("button", { name: /Import 1 ready row\b/ })).toBeVisible();

  await page.getByLabel("Import into").selectOption({
    label: "E2E Import Source (RWF)",
  });
  await page.getByRole("button", { name: "Set account" }).click();
  await page.getByRole("button", { name: /Import 1 ready row\b/ }).click();

  await page.goto("/transactions");
  await expect(
    page.getByRole("link", { name: /E2E Expense Kept/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /E2E Expense Blocked/ }),
  ).toHaveCount(0);
});

test("an unsupported file type is rejected before anything is staged", async ({ page }) => {
  await page.goto("/integrations/imports/new");
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("just some notes"),
  });
  await page.getByRole("button", { name: /Upload and detect/ }).click();

  await expect(
    page.getByText(/Only \.csv and \.xlsx files are supported/),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/integrations\/imports\/new$/);
});

test("a multi-sheet workbook is classified and the chosen sheet is staged", async ({ page }) => {
  await page.goto("/integrations/imports/analyze");
  await page.locator('input[type="file"]').setInputFiles({
    name: "records.xlsx",
    mimeType: XLSX_MIME,
    buffer: await twoSheetWorkbook(),
  });
  await page.getByRole("button", { name: "Analyze workbook" }).click();

  await expect(page.getByText(/2 sheets found/)).toBeVisible();
  await expect(page.getByText(/1 look like transactions/)).toBeVisible();
  await expect(page.getByText("Sales", { exact: true })).toBeVisible();
  await expect(page.getByText("Notes", { exact: true })).toBeVisible();

  // "Sales" is the recommended candidate and pre-ticked; "Notes" is not
  // selectable (unrecognised).
  await page.getByRole("button", { name: /Import 1 sheet/ }).click();

  await expect(page).toHaveURL(/\/integrations\/imports$/);
  await expect(page.getByText(/records\.xlsx — Sales/)).toBeVisible();
});
