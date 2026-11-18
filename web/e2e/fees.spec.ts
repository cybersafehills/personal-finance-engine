import AxeBuilder from "@axe-core/playwright";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect } from "./fixtures";
import { cleanupSeededTransactions, seedTransaction } from "./seed";
import { E2E_USER } from "./test-users";

// OneLedger 3.0 fee calculator (/pay/fees, GET /api/mobile/fees/estimate).
// Seeds send_money payments in a band no other spec uses (around 77,777) so the
// "similar payments" window holds exactly these rows, then checks the estimate
// against hand-computed values: window 62,222-93,332 contains four payments
// (fees 700, 700, 700, 900); a 5,000 payment is outside it.

const TAG = "fees";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3417";
const AMOUNT = "77777";

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const seed = (amountRwf: number, feeRwf: number, ago: number) =>
    seedTransaction({
      tag: TAG,
      counterpartyName: "Fee Spec Person",
      transactionType: "send_money",
      direction: "out",
      amountRwf,
      feeRwf,
      occurredAt: daysAgo(ago),
    });
  await seed(70_000, 700, 40);
  await seed(75_000, 700, 30);
  await seed(78_000, 700, 20);
  await seed(80_000, 900, 10);
  await seed(5_000, 100, 5); // outside the window: must not count
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
});

test("with no amount it explains itself instead of showing a number", async ({ page }) => {
  await page.goto("/pay/fees");
  await expect(page.getByRole("heading", { name: "Estimate a transfer fee", level: 1 })).toBeVisible();
  await expect(page.getByText("Enter an amount to see what a payment like it costs")).toBeVisible();
  await expect(page.getByRole("region", { name: "Fees you have paid before" })).toHaveCount(0);
});

test("the estimate comes from similar past payments, with its evidence", async ({ page }) => {
  await page.goto(`/pay/fees?amount=${AMOUNT}&type=send_money`);
  const hist = page.getByRole("region", { name: "Fees you have paid before" });
  await expect(hist.getByText("700 RWF – 900 RWF")).toBeVisible();
  await expect(hist.getByText(/Most of them paid/)).toBeVisible();
  await expect(hist.getByText(/Based on 4 similar payments of yours/)).toBeVisible();
  const table = hist.getByRole("table", { name: /most recent similar payments/i });
  await expect(table.getByRole("row")).toHaveCount(5); // header + the 4 similar payments
  // exact: "75,000 RWF" also contains the substring "5,000 RWF"
  await expect(table.getByText("5,000 RWF", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/not guarantees/)).toBeVisible();
});

test("too little history is said plainly, not padded", async ({ page }) => {
  await page.goto("/pay/fees?amount=999999&type=send_money");
  const hist = page.getByRole("region", { name: "Fees you have paid before" });
  await expect(hist.getByText(/At least 3 are needed|nothing to estimate from/)).toBeVisible();
  await expect(hist).not.toContainText("–"); // no range invented from too little evidence
});

test("an invalid amount is refused with a reason, never rounded", async ({ page }) => {
  await page.goto("/pay/fees?amount=12.5&type=send_money");
  // not getByRole("alert") alone: Next's route announcer is also role=alert
  await expect(page.locator("#fee-amount-error")).toContainText("Enter a whole amount");
  await expect(page.getByRole("region", { name: "Fees you have paid before" })).toHaveCount(0);
});

test("a published maximum is shown as an upper bound with its source", async ({ page }) => {
  await page.goto(`/pay/fees?amount=${AMOUNT}&type=send_money&network=ekash`);
  const pub = page.getByRole("region", { name: "Published by eKash" });
  await expect(pub.getByText("Up to 20 RWF")).toBeVisible();
  await expect(pub.getByText(/not the fee you will\s+necessarily pay/)).toBeVisible();
  await expect(pub.getByText(/RSwitch Ltd/)).toBeVisible();
  await expect(pub.getByText(/above the .* of/)).toHaveCount(0);
});

test("an amount above the published maximum warns and offers no workaround", async ({ page }) => {
  await page.goto("/pay/fees?amount=20000000&type=send_money&network=ekash");
  const pub = page.getByRole("region", { name: "Published by eKash" });
  await expect(pub.getByText(/above the published maximum of 10,000,000 RWF/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/split (it|your|the)/i);
});

test("the eKash network page links to the calculator", async ({ page }) => {
  await page.goto("/pay/networks/ekash");
  await page.getByRole("link", { name: "Estimate a fee for an amount" }).click();
  await expect(page).toHaveURL(/\/pay\/fees\?network=ekash/);
  await expect(page.getByLabel("Published fees from")).toHaveValue("ekash");
});

for (const width of [1280, 390]) {
  test(`Fee calculator has no serious/critical accessibility violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/pay/fees?amount=${AMOUNT}&type=send_money&network=ekash`);
    await expect(page.getByRole("region", { name: "Published by eKash" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrWorse, JSON.stringify(seriousOrWorse, null, 2)).toEqual([]);
  });
}

test.describe("mobile API", () => {
  async function signedIn() {
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const signIn = await api.post("/api/mobile/auth/sign-in", {
      data: { email: E2E_USER.email, password: E2E_USER.password },
    });
    expect(signIn.status()).toBe(200);
    const session = await signIn.json();
    return { api, headers: { authorization: `Bearer ${session.access_token}` } };
  }

  test("GET /api/mobile/fees/estimate returns the same answer, amounts as strings", async () => {
    const { api, headers } = await signedIn();
    try {
      const res = await api.get(
        `/api/mobile/fees/estimate?amount=${AMOUNT}&currency=RWF&type=send_money&network=ekash`,
        { headers },
      );
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toContain("no-store");
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.amount_minor).toBe(AMOUNT);
      expect(body.history).toMatchObject({
        status: "estimate",
        min_minor: "700",
        max_minor: "900",
        typical_minor: "700",
        count: 4,
      });
      expect(body.published).toMatchObject({
        fee_type: "published_maximum",
        estimate: { status: "upper_bound", max_minor: "20" },
      });
      expect(body.disclaimer).toMatch(/estimates, not guarantees/i);
    } finally {
      await api.dispose();
    }
  });

  test("bad input and unknown networks are refused cleanly", async () => {
    const { api, headers } = await signedIn();
    try {
      const noAmount = await api.get("/api/mobile/fees/estimate?currency=RWF", { headers });
      expect(noAmount.status()).toBe(400);
      const fraction = await api.get("/api/mobile/fees/estimate?amount=12.5&currency=RWF", { headers });
      expect(fraction.status()).toBe(400);
      expect((await fraction.json()).error).toBe("invalid_amount");
      const ghost = await api.get(
        `/api/mobile/fees/estimate?amount=${AMOUNT}&currency=RWF&network=no-such-network`,
        { headers },
      );
      expect(ghost.status()).toBe(404);
      const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
      expect((await anon.get(`/api/mobile/fees/estimate?amount=${AMOUNT}`)).status()).toBe(401);
      await anon.dispose();
    } finally {
      await api.dispose();
    }
  });
});
