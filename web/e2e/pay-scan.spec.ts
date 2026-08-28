import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Pay & Services - Phase R1 (Scan to pay, camera SHELL). Non-custodial
// and deliberately incomplete: R1 opens the camera, models every
// permission / no-camera / in-use / insecure state, and always releases
// the stream. It does NOT decode a QR code or hand off a payment.
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
// With neither, the entry point is server-gated off and there is nothing
// to test. See docs/pay-and-services.md "Scan to pay (Phase R1)".
test.describe("Scan to pay (R1)", () => {
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
    // State is conveyed as text, not by the video alone.
    await expect(dialog.getByRole("status")).toBeVisible();
    // The R1 build is honest that decoding isn't wired yet.
    await expect(dialog.getByText(/Reading a code isn't part of this build/)).toBeVisible();

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
