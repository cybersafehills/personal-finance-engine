import { test, expect } from "./fixtures";
import { cleanupSeededTransactions, seedTransaction } from "./seed";

// PR #150: the transaction detail page shows a "Pay <name> again" button
// when assisted Pay is enabled AND the transaction carries a reusable
// send target. It deep-links the Pay draft prefilled with the same
// phone number / merchant code. Assumes ASSISTED_PAY_ENABLED is on
// (default, same as pay-assisted.spec.ts).

const TAG = "payagain";
let sendMoneyId = "";
let withdrawalId = "";

test.beforeAll(async () => {
  await cleanupSeededTransactions(TAG);
  sendMoneyId = await seedTransaction({
    tag: TAG,
    counterpartyName: "Denis KWIZERA",
    counterpartyReference: "0788111222",
    transactionType: "send_money",
    direction: "out",
    amountRwf: 3000,
  });
  withdrawalId = await seedTransaction({
    tag: TAG,
    counterpartyName: "ATM",
    transactionType: "cash_withdrawal",
    direction: "out",
    amountRwf: 10000,
  });
});

test.afterAll(async () => {
  await cleanupSeededTransactions(TAG);
});

test("a send-money transaction offers 'Pay … again' and prefills the draft", async ({ page }) => {
  await page.goto(`/transactions/${sendMoneyId}`);

  const again = page.getByRole("link", { name: /again$/ });
  await expect(again).toBeVisible();
  await expect(again).toHaveAttribute(
    "href",
    /\/pay\/new\/pay_person\?msisdn=0788111222/,
  );

  await again.click();
  await expect(page).toHaveURL(/\/pay\/new\/pay_person/);
  await expect(
    page.getByPlaceholder("Phone number, e.g. 0781234567"),
  ).toHaveValue("0788111222");
});

test("a cash-withdrawal transaction has no 'Pay … again' button", async ({ page }) => {
  await page.goto(`/transactions/${withdrawalId}`);
  await expect(page.getByRole("link", { name: /again$/ })).toHaveCount(0);
});
