import { expect, test } from "./fixtures";
import { adminClient, ensureWorkspaceAndAccount } from "./seed";

// An ACTIVE budget whose month is over used to keep saying "On track" on Home
// and "needs attention" in the Inbox forever. Now Home says it ended and one
// button starts this month's budget (copy -> archive the old -> activate).
//
// There is at most one active budget per workspace+currency, so if another
// spec left one active this spec does nothing (it never archives a budget it
// did not create). It cleans up everything it made, by name, in afterAll.

const NAME = "E2E Rollover Budget";
const day = (d: Date) => d.toISOString().slice(0, 10);

let ownsActiveSlot = false;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const admin = adminClient();
  const { workspaceId } = await ensureWorkspaceAndAccount(admin);
  await admin.from("budgets").delete().eq("name", NAME);

  const { data: existing } = await admin
    .from("budgets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("currency", "RWF")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (existing) return; // someone else holds the single active slot
  ownsActiveSlot = true;

  // Two months ago through last month: over, whatever day this runs.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const { data: budget, error } = await admin
    .from("budgets")
    .insert({
      workspace_id: workspaceId,
      name: NAME,
      currency: "RWF",
      period_start: day(start),
      period_end: day(end),
      income_amount_minor: 1_000_000,
      normalized_monthly_income_minor: 1_000_000,
      normalized_annual_income_minor: 12_000_000,
      income_frequency: "monthly",
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !budget) throw new Error(`could not create the e2e budget: ${error?.message}`);
  const split = [["ESSENTIALS", 50], ["INVESTING", 15], ["EMERGENCY", 5], ["WANTS", 30]] as const;
  const { error: allocError } = await admin.from("budget_allocations").insert(
    split.map(([type, pct], i) => ({
      budget_id: budget.id,
      workspace_id: workspaceId,
      allocation_type: type,
      percentage: pct,
      target_amount_minor: (1_000_000 * pct) / 100,
      sort_order: i,
    })),
  );
  if (allocError) throw new Error(`could not create allocations: ${allocError.message}`);
  const { error: activateError } = await admin
    .from("budgets")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", budget.id);
  if (activateError) throw new Error(`could not activate the e2e budget: ${activateError.message}`);
});

test.afterAll(async () => {
  await adminClient().from("budgets").delete().eq("name", NAME);
});

test("an ended active budget says it ended and starts this month's with one tap", async ({ page }) => {
  test.skip(!ownsActiveSlot, "another spec holds the single active budget");

  await page.goto("/");
  await expect(page.getByText(`${NAME} ended on`)).toBeVisible();
  // It must not claim to be on track, and shows no amounts for a finished month.
  await expect(page.getByText("On track")).toHaveCount(0);
  await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  // The Inbox tells the same story instead of "needs attention".
  await page.goto("/inbox");
  await expect(page.getByText(`${NAME} has ended`)).toBeVisible();
  await expect(page.getByText(`${NAME} needs attention`)).toHaveCount(0);

  await page.goto("/budgets");
  const button = page.getByRole("button", { name: /^Start .+'s budget$/ });
  await expect(button).toBeVisible();
  await button.click();

  // The card is gone and the new month's budget is the active one.
  await expect(page.getByText(`${NAME} ended on`)).toHaveCount(0, { timeout: 15_000 });
  const admin = adminClient();
  const { workspaceId } = await ensureWorkspaceAndAccount(admin);
  const { data: rows } = await admin
    .from("budgets")
    .select("status, period_start, period_end")
    .eq("workspace_id", workspaceId)
    .eq("name", NAME)
    .order("period_start", { ascending: true });
  expect(rows?.map((r) => r.status)).toEqual(["archived", "active"]);
  const today = day(new Date());
  const current = rows![1];
  expect(current.period_start <= today && today <= current.period_end).toBe(true);

  // Pressing it again never creates a second budget for the month.
  await page.goto("/budgets");
  await expect(page.getByRole("button", { name: /^Start .+'s budget$/ })).toHaveCount(0);
  const { count } = await admin
    .from("budgets")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("name", NAME);
  expect(count).toBe(2);
});
