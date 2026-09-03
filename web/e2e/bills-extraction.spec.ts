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
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    const detailUrl = page.url();

    // With extraction on, the upload queued the document.
    // Anchored so it matches only the status badge, never a timeline row
    // such as "Status: stored -> queued".
    await expect(page.getByText(/^(Queued|Scanning)$/)).toBeVisible();

    // Drive the cron worker until THIS document reaches review. Other
    // specs leave their own documents queued, and one tick only processes
    // a bounded batch, so a single tick isn't guaranteed to pick this one.
    let reachedReview = false;
    for (let tick = 0; tick < 8 && !reachedReview; tick++) {
      const res = await request.post("/api/cron/process-bill-documents", {
        headers: { "x-report-cron-secret": CRON_SECRET },
      });
      expect(res.ok()).toBeTruthy();
      await page.goto(detailUrl);
      reachedReview = await page
        .getByText("Needs review", { exact: true })
        .isVisible();
    }

    await expect(page.getByText("Needs review", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Fields", exact: true })).toBeVisible();
    await expect(page.getByText("Kigali Office Supplies Ltd")).toBeVisible();
    await expect(page.getByText("RWF 141,600")).toBeVisible();
    await expect(page.getByText("2026-08-12")).toBeVisible();
    // One per extracted field - just assert the confidence label renders.
    await expect(page.getByText(/confidence/).first()).toBeVisible();

    // Line items table rendered.
    await expect(page.getByRole("table", { name: "Extracted line items" })).toBeVisible();

    // The deterministic Checks section ran in the same tick. The mock
    // invoice is self-consistent (120,000 + 21,600 = 141,600; line totals
    // sum to the subtotal; dates in the past), so it has no findings.
    await expect(page.getByRole("heading", { name: "Checks" })).toBeVisible();
    await expect(page.getByText(/No issues found by the automated checks/)).toBeVisible();

    // The review layout: the reviewer affordances (inline field edit) and
    // the ledger + notes sections are present.
    await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approval & ledger" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();

    // Inline-correct the invoice number, then confirm it renders as
    // "(corrected)" and the checks re-ran clean.
    const fieldsRegion = page.locator("section", {
      has: page.getByRole("heading", { name: "Fields", exact: true }),
    });
    await fieldsRegion.getByText("INV-2026-0442").locator("..").getByRole("button", { name: "Edit" }).click();
    const editBox = page.getByRole("textbox").first();
    await editBox.fill("INV-2026-0442-R1");
    // Submit with Enter (the input handles it) rather than clicking Save -
    // on the mobile layout the sticky header can overlap the Save button
    // after it scrolls into view.
    await editBox.press("Enter");
    await expect(page.getByText("INV-2026-0442-R1")).toBeVisible();
    await expect(page.getByText("(corrected)").first()).toBeVisible();

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

  test("a second document with the same extracted identity is flagged as a possible duplicate", async ({
    page,
    request,
  }) => {
    async function uploadAndProcess(marker: string): Promise<string> {
      await page.goto("/bills");
      await page.getByLabel("Add an invoice or receipt").setInputFiles({
        name: `${marker}.pdf`,
        mimeType: "application/pdf",
        buffer: minimalPdf(marker),
      });
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
      const url = page.url();
      const res = await request.post("/api/cron/process-bill-documents", {
        headers: { "x-report-cron-secret": CRON_SECRET },
      });
      expect(res.ok()).toBeTruthy();
      return url;
    }

    const stamp = Date.now();
    // The mock provider returns the same invoice for every document, so
    // two distinct files resolve to the same supplier / number / total.
    await uploadAndProcess(`e2e-dupe-first-${stamp}`);
    const secondUrl = await uploadAndProcess(`e2e-dupe-second-${stamp}`);

    await page.goto(secondUrl);
    const section = page.getByRole("heading", { name: "Possible duplicates" });
    await expect(section).toBeVisible();
    await expect(page.getByText("Probable duplicate").first()).toBeVisible();
    // The candidate links to another bill document.
    await expect(
      page.locator('section', { has: section }).locator('a[href^="/bills/"]').first(),
    ).toBeVisible();

    // A reviewer can dismiss it.
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await expect(page.getByText("Dismissed").first()).toBeVisible();
  });
});
