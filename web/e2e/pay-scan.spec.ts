import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Pay & Services - Phase R1/R2 (Scan to pay). Non-custodial and
// deliberately incomplete: the scanner opens the camera, models every
// permission / device failure, decodes a QR (native BarcodeDetector),
// and classifies the payload server-side - stopping at "here's what we
// read". It does NOT show a full review screen or hand off a payment
// (that's R3). The payload pipeline itself is covered exhaustively by
// the Deno unit tests in web/lib/pay/scan/*_test.ts.
//
// This spec needs two things the default local run does NOT set, so the
// whole file is skipped unless they're present:
//
//   1. SCAN_TO_PAY_ENABLED=true in the Playwright webServer env
//      (playwright.config.ts -> webServer.env), because the flag is
//      opt-in (off unless exactly "true"), unlike the other Pay flags.
//   2. Chromium launched with a fake camera so getUserMedia resolves
//      headlessly:
//        use: { launchOptions: { args: [
//          "--use-fake-device-for-media-stream",
//          "--use-fake-ui-for-media-stream",
//        ] } }
//
// Note: headless Chromium does not ship BarcodeDetector, so these tests
// assert the scanner *shell* (open / status / Back / Esc / a11y), not a
// live decode. With neither env set, the entry point is server-gated off
// and there is nothing to test.
test.describe("Scan to pay (R1/R2)", () => {
  test.skip(
    process.env.SCAN_TO_PAY_ENABLED !== "true",
    "SCAN_TO_PAY_ENABLED is not 'true' for this run - see file header.",
  );

  async function openScanner(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.locator("header").getByRole("button", { name: "Pay", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pay & Services" });
    await dialog.getByRole("button", { name: "Scan to pay" }).click();
    return dialog;
  }

  test("the entry point opens a scanner view with a Back path and a status line", async ({
    page,
  }) => {
    const dialog = await openScanner(page);

    await expect(dialog.getByRole("heading", { name: "Scan to pay" })).toBeVisible();
    // Guidance + a live status line - state is conveyed as text, never by
    // the video pixels alone.
    await expect(dialog.getByText(/hold steady inside the frame/i)).toBeVisible();
    await expect(dialog.getByRole("status")).toBeVisible();

    // Back returns to the menu and restores focus to the entry.
    const back = dialog.getByRole("button", { name: "Back to payment options" });
    await back.click();
    await expect(dialog.getByRole("button", { name: "Scan to pay" })).toBeFocused();
  });

  test("Escape steps back to the menu before it closes the sheet", async ({ page }) => {
    const dialog = await openScanner(page);
    await expect(dialog.getByRole("heading", { name: "Scan to pay" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Scan to pay" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("the scanner view has no serious/critical accessibility violations", async ({
    page,
  }) => {
    await openScanner(page);
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
  });
});
