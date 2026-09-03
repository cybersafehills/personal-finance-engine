import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Bills & Expenses accessibility + responsive coverage (master prompt
// §20/§22). Scoped to serious/critical impact on the two Bills pages at a
// desktop and a mobile width, plus a keyboard-only path through the
// review workspace.

function minimalPdf(marker: string): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n" +
      "3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n" +
      `4 0 obj<</Length ${marker.length}>>stream\n${marker}\nendstream endobj\n` +
      "trailer<</Root 1 0 R>>\n%%EOF\n",
    "latin1",
  );
}

async function axeClean(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
}

test.describe("Bills & Expenses - a11y & responsive", () => {
  test("the list and review pages are axe-clean at desktop and mobile widths", async ({ page }) => {
    // Seed one document so the review page has content.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/bills");
    const marker = `e2e-a11y-${Date.now()}`;
    await page.getByLabel("Add an invoice or receipt").setInputFiles({
      name: `${marker}.pdf`,
      mimeType: "application/pdf",
      buffer: minimalPdf(marker),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    const detailUrl = page.url();

    for (const size of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/bills");
      await expect(page.getByRole("heading", { name: "Bills & Expenses" })).toBeVisible();
      await axeClean(page);

      await page.goto(detailUrl);
      await expect(page.getByRole("heading", { name: marker + ".pdf" })).toBeVisible();
      await axeClean(page);
    }
  });

  test("the list status filters work with the keyboard", async ({ page }) => {
    await page.goto("/bills");
    const filters = page.getByRole("group", { name: "Filter by status" });
    await filters.getByRole("button", { name: "Needs review" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/status=needs_review/);
    await expect(filters.getByRole("button", { name: "Needs review" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
