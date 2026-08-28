import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Bills & Expenses Phase 2 - classification + structured extraction.
// Runs with BILLS_EXTRACTION_ENABLED=true and AI_PROVIDER=mock (set in
// playwright.config.ts webServer env), so the extractor returns a
// deterministic supplier invoice with no API key. The worker is
// cron-driven, so the test POSTs the cron route directly with the shared
// secret to run one tick.

const CRON_SECRET = "e2e-bills-cron-secret";

function minimalPdf(marker: string): Buffer {
  const body =
    "%PDF-1.4\n" +
    "1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n" +
    "3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n" +
    `4 0 obj<</Length ${marker.length}>>stream\n${marker}\nendstream endobj\n` +
    "trailer<</Root 1 0 R>>\n%%EOF\n";
  return Buffer.from(body, "latin1");
}

test.describe("Bills & Expenses - Phase 2 extraction", () => {
  test("upload -> worker tick -> classified + fields extracted, visible on the detail page", async ({
    page,
    request,
  }) => {
    await page.goto("/bills");
    const unique = `e2e-extract-${Date.now()}`;
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: `${unique}.pdf`,
      mimeType: "application/pdf",
      buffer: minimalPdf(unique),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    const detailUrl = page.url();

    // With extraction on, the upload queued the document.
    await expect(page.getByText("Queued").or(page.getByText("Scanning"))).toBeVisible();

    // Run one worker tick.
    const res = await request.post("/api/cron/process-bill-documents", {
      headers: { "x-report-cron-secret": CRON_SECRET },
    });
    expect(res.ok()).toBeTruthy();
    const summary = await res.json();
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);

    await page.goto(detailUrl);
    await expect(page.getByText("Needs review")).toBeVisible();

    const extracted = page.getByRole("heading", { name: "Extracted details" });
    await expect(extracted).toBeVisible();
    await expect(page.getByText("Kigali Office Supplies Ltd")).toBeVisible();
    await expect(page.getByText("RWF 141,600")).toBeVisible();
    await expect(page.getByText("2026-08-12")).toBeVisible();
    await expect(page.getByText(/confidence/)).toBeVisible();

    // Line items table rendered.
    await expect(page.getByRole("table", { name: "Extracted line items" })).toBeVisible();

    // The deterministic Checks section ran in the same tick. The mock
    // invoice is self-consistent (120,000 + 21,600 = 141,600; line totals
    // sum to the subtotal; dates in the past), so it has no findings.
    await expect(page.getByRole("heading", { name: "Checks" })).toBeVisible();
    await expect(page.getByText(/No issues found by the automated checks/)).toBeVisible();

    // No serious/critical a11y violations on the populated detail page.
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });

  test("the cron route rejects a request without the shared secret", async ({ request }) => {
    const res = await request.post("/api/cron/process-bill-documents");
    expect(res.status()).toBe(401);
  });
});
