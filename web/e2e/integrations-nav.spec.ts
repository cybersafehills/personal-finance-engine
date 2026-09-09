import { test, expect } from "./fixtures";

// Track B (#165 templates, #166 connect wizard, #167 workbook analyzer).
// Navigation-only coverage of the new Integrations surfaces — no file
// upload, no DB seeding — so it runs cross-browser alongside the shell
// journeys. The end-to-end import + commit flow is in
// integrations-import.spec.ts (chromium-desktop only).

test.describe("Integrations shell", () => {
  test("the dashboard offers a Connect a system entry", async ({ page }) => {
    await page.goto("/integrations");
    await expect(
      page.getByRole("heading", { name: "Integrations", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Connect a system" }),
    ).toBeVisible();
  });

  test("the connect wizard walks source → direction → data type to Import Studio", async ({ page }) => {
    await page.goto("/integrations/connect");
    await expect(page.getByText("Step 1 of 3")).toBeVisible();

    await page.getByRole("link", { name: /Spreadsheet or CSV file/ }).click();
    await expect(page).toHaveURL(/[?&]source=file/);
    await expect(page.getByText("Step 2 of 3")).toBeVisible();

    await page.getByRole("link", { name: /Bring data into OneLedger/ }).click();
    await expect(page).toHaveURL(/[?&]direction=import/);

    await page.getByRole("link", { name: /^Transactions/ }).click();
    await expect(page).toHaveURL(/\/integrations\/imports\/new$/);
  });

  test("a coming-soon source is honest — it links to the Marketplace, not a fake flow", async ({ page }) => {
    await page.goto("/integrations/connect");
    const sheets = page.getByRole("link", { name: /Google Sheets/ });
    await expect(sheets).toBeVisible();
    await expect(sheets).toHaveAttribute("href", "/integrations/marketplace");
  });
});

test.describe("Starter templates", () => {
  test("the picker lists the register templates with downloads", async ({ page }) => {
    await page.goto("/integrations/imports/templates");
    for (const name of ["Daily Sales Register", "Expense Register", "Cashbook"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole("link", { name: "Download CSV" }).first(),
    ).toHaveAttribute("href", /\/api\/integrations\/imports\/templates\/.+format=csv/);
  });

  test("a blank template downloads as CSV with its header row", async ({ page }) => {
    const res = await page.request.get(
      "/api/integrations/imports/templates/cashbook?format=csv",
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = await res.text();
    expect(body).toContain("Money In");
    expect(body).toContain("Money Out");
  });

  test("an unknown template key is a 404", async ({ page }) => {
    const res = await page.request.get(
      "/api/integrations/imports/templates/invoices?format=csv",
    );
    expect(res.status()).toBe(404);
  });
});

test.describe("Workbook analyzer", () => {
  test("the analyze page renders its upload form", async ({ page }) => {
    await page.goto("/integrations/imports/analyze");
    await expect(
      page.getByRole("heading", { name: "Analyze a workbook", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Analyze workbook" }),
    ).toBeVisible();
  });
});
