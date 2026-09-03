import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Bills & Expenses Phase 1 (Invoice & Expense Processor) - secure intake,
// original preservation, lifecycle + audit, tenant isolation. Runs with
// BILLS_ENABLED=true (set in playwright.config.ts's webServer env); the
// dark default is exercised implicitly by every other spec, none of
// which can reach /bills.
//
// Synthetic fixtures only - a minimal valid one-page PDF and a byte
// blob that lies about its type. No real personal or financial data.

function minimalPdf(marker: string): Buffer {
  const body =
    "%PDF-1.4\n" +
    "1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n" +
    `3 0 obj<</Type /Page /Parent 2 0 R /Contents 4 0 R>>endobj\n` +
    `4 0 obj<</Length ${marker.length}>>stream\n${marker}\nendstream endobj\n` +
    "trailer<</Root 1 0 R>>\n%%EOF\n";
  return Buffer.from(body, "latin1");
}

test.describe("Bills & Expenses - Phase 1 intake", () => {
  test("upload a valid PDF: it stores, shows in the list, and records a processing event", async ({
    page,
  }) => {
    await page.goto("/bills");
    await expect(page.getByRole("heading", { name: "Bills & Expenses" })).toBeVisible();

    const unique = `e2e-receipt-${Date.now()}`;
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: `${unique}.pdf`,
      mimeType: "application/pdf",
      buffer: minimalPdf(unique),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();

    // Redirects to the detail page on success.
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: `${unique}.pdf` })).toBeVisible();
    // The status badge - anchored so it never also matches a timeline
    // row like "Status: stored -> queued". With BILLS_EXTRACTION_ENABLED
    // the upload moves the document straight to "queued".
    await expect(page.getByText(/^(Stored|Queued|Needs review)$/)).toBeVisible();

    // The append-only processing history shows the intake event (the e2e
    // user is the workspace owner, so holds bill.audit.view).
    await expect(
      page.getByText("Document received and original stored"),
    ).toBeVisible();

    // Back on the list, the document is present.
    await page.getByRole("link", { name: "All documents", exact: true }).click();
    await expect(page.getByRole("link", { name: new RegExp(unique) })).toBeVisible();
  });

  test("uploading the exact same bytes again is reported as a duplicate, not stored twice", async ({
    page,
  }) => {
    const unique = `e2e-dup-${Date.now()}`;
    const buffer = minimalPdf(unique);

    await page.goto("/bills");
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: `${unique}.pdf`,
      mimeType: "application/pdf",
      buffer,
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);

    await page.goto("/bills");
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: `${unique}-again.pdf`,
      mimeType: "application/pdf",
      buffer,
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();

    await expect(
      page.getByText("You've already uploaded this exact document."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View the existing document" }),
    ).toBeVisible();
  });

  test("a non-PDF disguised as .pdf is rejected on content, not extension", async ({ page }) => {
    await page.goto("/bills");
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: "totally-a.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("MZ\x90\x00 this is a PE binary, not a PDF"),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();

    await expect(page.getByText(/Only PDF, JPEG, PNG and HEIC/i)).toBeVisible();
    await expect(page).toHaveURL(/\/bills$/);
  });

  test("the /bills pages have no serious or critical accessibility violations", async ({ page }) => {
    await page.goto("/bills");
    // Wait for the route to settle so axe scans the page, not the
    // Suspense loading fallback.
    await expect(page.getByRole("heading", { name: "Bills & Expenses" })).toBeVisible();
    let results = await new AxeBuilder({ page }).analyze();
    let bad = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);

    // Upload one so the detail page has content to scan.
    const unique = `e2e-a11y-${Date.now()}`;
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: `${unique}.pdf`,
      mimeType: "application/pdf",
      buffer: minimalPdf(unique),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: `${unique}.pdf` })).toBeVisible();

    results = await new AxeBuilder({ page }).analyze();
    bad = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });

  test("upload works with the keyboard alone", async ({ page }) => {
    await page.goto("/bills");
    const unique = `e2e-kbd-${Date.now()}`;

    // Tab to the file input and set files (the OS picker can't be driven,
    // but focus + programmatic setInputFiles mirrors a keyboard user
    // activating it), then Tab to the Upload button and press Enter.
    const input = page.getByLabel("Add an invoice or receipt");
    await input.focus();
    await input.setInputFiles({
      name: `${unique}.pdf`,
      mimeType: "application/pdf",
      buffer: minimalPdf(unique),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: `${unique}.pdf` })).toBeVisible();
  });
});
