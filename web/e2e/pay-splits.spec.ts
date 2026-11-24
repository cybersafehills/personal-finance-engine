import { test, expect, grantClipboard } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// Pay: Splits. A payment is sent as several transfers; each part is an ordinary
// payment intent the person hands off themselves, one at a time. OneLedger never
// moves money, and part N+1 only opens once part N is settled.
//
// eKash takes up to RWF 10,000,000 as ONE transfer, so an offer exists only when
// the amount EXCEEDS that. The parts are computed by the server; the maths is
// covered by the Deno tests in web/lib/pay/splits/. This spec drives the real
// flow (offer card, start, plan panel, next part, stop) with PAY_SPLITS_ENABLED
// wired in playwright.config.ts. The MTN fee-saving kind is dormant until a
// verified tariff is loaded, so it is not exercised here.

const CARD_TITLE = "Above the eKash limit for one transfer";

/** Waits for the debounced "is there an offer?" server action to answer. */
function offerAnswered(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && "next-action" in r.request().headers(),
  );
}

async function openPersonForm(page: Page) {
  await page.goto("/pay/new/pay_person");
  await page.getByPlaceholder("Phone number, e.g. 0781234567").fill("0781234567");
  await page.getByRole("checkbox", { name: /Send over eKash/ }).check();
}

/** Types an amount and returns once the server has answered for it. */
async function enterAmount(page: Page, amount: string) {
  const answered = offerAnswered(page);
  await page.getByLabel(/^Amount/).fill(amount);
  await answered;
}

const offerCard = (page: Page) => page.getByRole("region", { name: CARD_TITLE });

/** Copies the code (the hand-off) and confirms the part by hand, like pay-assisted.spec.ts. */
async function handOffAndConfirm(page: Page) {
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I've confirmed this with my provider" }).click();
  await expect(page.getByText("Manually confirmed", { exact: true })).toBeVisible();
}

test.describe("Pay: splits (eKash over capacity)", () => {
  test("no offer at the network limit; parts only above it", async ({ page }) => {
    await openPersonForm(page);

    // Positive control first: above the limit the card is offered, so the
    // "no offer" check below cannot pass just because nothing ever loads.
    await enterAmount(page, "10000001");
    await expect(offerCard(page)).toBeVisible();
    await expect(offerCard(page).getByText("Part 1 · 5,000,001 RWF")).toBeVisible();
    await expect(offerCard(page).getByText("Part 2 · 5,000,000 RWF")).toBeVisible();
    await expect(offerCard(page).getByRole("button", { name: "Split into 2 parts" })).toBeVisible();

    // Exactly at the limit goes as ONE transfer.
    await enterAmount(page, "10000000");
    await expect(offerCard(page)).toHaveCount(0);
  });

  test("a larger amount is offered as three parts, largest first", async ({ page }) => {
    await openPersonForm(page);
    await enterAmount(page, "25000000");

    const card = offerCard(page);
    await expect(card).toBeVisible();
    await expect(card.getByText("Part 1 · 8,333,334 RWF")).toBeVisible();
    await expect(card.getByText("Part 2 · 8,333,333 RWF")).toBeVisible();
    await expect(card.getByText("Part 3 · 8,333,333 RWF")).toBeVisible();
    // Honest copy: fees are a ceiling, the institution's own limits may be lower,
    // and OneLedger says it never moves the money.
    // The e2e user pays from an MTN account, and MTN publishes its own charge for the eKash
    // route (a flat RWF 20, loaded as a verified tariff), so the fee is exact, not a ceiling.
    await expect(card.getByText(/60 RWF in total \(20 RWF per transfer\), from your provider's published tariff/)).toBeVisible();
    await expect(card.getByText(/lower limits of its own/)).toBeVisible();
    await expect(card.getByText(/OneLedger never moves money/)).toBeVisible();
  });

  test("without eKash chosen there is no capacity offer", async ({ page }) => {
    await page.goto("/pay/new/pay_person");
    await page.getByPlaceholder("Phone number, e.g. 0781234567").fill("0781234567");
    await enterAmount(page, "25000000");
    await expect(offerCard(page)).toHaveCount(0);
  });

  test("start, hand off part 1, then part 2 opens only once it is settled; stop ends it", async ({
    page,
    context,
    browserName,
  }) => {
    await grantClipboard(context, browserName);
    await openPersonForm(page);
    await enterAmount(page, "10000001");
    await offerCard(page).getByRole("button", { name: "Split into 2 parts" }).click();
    await expect(page).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);

    // The plan panel lists every part and marks this one.
    const plan = page.getByRole("region", { name: "Sending in 2 parts" });
    await expect(plan).toBeVisible();
    // The panel lists the parts already prepared, and what is not yet prepared.
    await expect(plan.getByText(/Part 1 · 5,000,001 RWF/)).toBeVisible();
    await expect(plan.getByText("Not yet prepared: 5,000,000 RWF")).toBeVisible();
    await expect(plan.getByText(/This payment/)).toBeVisible();

    // Part 2 cannot be prepared before part 1 is settled.
    await expect(plan.getByText("Confirm that part 1 went through to continue.")).toBeVisible();
    await expect(plan.getByRole("button", { name: /Prepare part 2/ })).toHaveCount(0);

    await handOffAndConfirm(page);

    // Now it can, and it becomes a normal payment of its own.
    await expect(plan.getByRole("button", { name: "Prepare part 2" })).toBeVisible();
    const firstUrl = page.url();
    await plan.getByRole("button", { name: "Prepare part 2" }).click();
    await expect(page).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toBe(firstUrl);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    // Stopping ends the plan: nothing more can be prepared.
    await page.getByRole("button", { name: "Stop here" }).click();
    await expect(page.getByText("This split was stopped.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Prepare part/ })).toHaveCount(0);
  });

  test("the offer and the plan panel have no serious/critical accessibility violations", async ({
    page,
  }) => {
    await openPersonForm(page);
    await enterAmount(page, "25000000");
    await expect(offerCard(page)).toBeVisible();
    const scan = async () => {
      const results = await new AxeBuilder({ page }).analyze();
      return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    };
    expect(await scan(), "offer card").toEqual([]);

    await offerCard(page).getByRole("button", { name: "Split into 3 parts" }).click();
    await expect(page.getByRole("region", { name: "Sending in 3 parts" })).toBeVisible();
    expect(await scan(), "plan panel").toEqual([]);
  });

  test("the offer card does not overflow the viewport", async ({ page }) => {
    await openPersonForm(page);
    await enterAmount(page, "25000000");
    await expect(offerCard(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("the Save On page shows what has been saved, over the periods asked for, honestly", async ({ page }) => {
  await page.goto("/pay/splits");
  const section = page.getByRole("region", { name: "Saved with Save On" });
  await expect(section).toBeVisible();
  // Every window is offered, and switching is instant.
  for (const label of ["Last 24 hours", "Last 7 days", "Last 2 weeks", "Last month", "Last 3 months", "Last 12 months", "All time"]) {
    await expect(section.getByRole("button", { name: label })).toBeVisible();
  }
  await section.getByRole("button", { name: "Last 7 days" }).click();
  await expect(section.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "true");
  // A fresh e2e user has saved nothing: it says so rather than showing a made-up figure,
  // and it is clear the numbers are estimates that count only once every part went through.
  await expect(section.getByText("Nothing saved yet")).toBeVisible();
  await expect(section.getByText(/only once every part has gone through/)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("Reports carries the savings as its own section", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("region", { name: "Saved with Save On" })).toBeVisible();
});

test("the Save On settings page opens and keeps fee-saving off by default", async ({ page }) => {
  await page.goto("/pay/splits");
  await expect(page.getByRole("heading", { name: "Save On", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Turn on Save On/ })).not.toBeChecked();
  await expect(page.getByText(/does not depend on this setting/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "How Save On works" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
