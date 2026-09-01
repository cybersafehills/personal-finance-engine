import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getAttentionItems,
  getCurrentBalance,
  getDashboardBudgetSummary,
  getHouseholdSpendingBreakdown,
  getOnboardingState,
  getProfileOnboarding,
  getRecentTransactions,
  getTodayTotals,
} from "../lib/queries";
import { BalanceCard } from "../components/BalanceCard";
import { OnboardingCard } from "../components/OnboardingCard";
import { SummaryMetric } from "../components/SummaryMetric";
import { BudgetStatusCard } from "../components/BudgetStatusCard";
import { AttentionItemsCard } from "../components/AttentionItemsCard";
import { DashboardTransactionItem } from "../components/DashboardTransactionItem";
import { HouseholdSpendingCard } from "../components/HouseholdSpendingCard";
import { EmptyState } from "../components/EmptyState";

// Always read live from the database - this is a live balance/transaction
// view, not cacheable content.
export const dynamic = "force-dynamic";

const RECENT_TRANSACTIONS_LIMIT = 6;

export default async function HomePage() {
  const profileOnboarding = await getProfileOnboarding();
  if (profileOnboarding?.step === "profile") redirect("/onboarding/profile");
  if (profileOnboarding?.step === "preferences") redirect("/onboarding/preferences");

  const [
    balance,
    today,
    recentTransactions,
    budgetSummary,
    attentionItems,
    householdSpending,
    onboarding,
  ] = await Promise.all([
    getCurrentBalance(),
    getTodayTotals(),
    getRecentTransactions(RECENT_TRANSACTIONS_LIMIT),
    getDashboardBudgetSummary(),
    getAttentionItems(),
    getHouseholdSpendingBreakdown(),
    getOnboardingState(),
  ]);

  // Whether the secondary (right) column has anything to show at all -
  // when neither exists (a new/quiet account), the main column expands
  // to the full width instead of leaving a permanently blank third
  // column, per master prompt §10's "do not leave the majority of the
  // desktop viewport unused without a design reason" - an empty right
  // column here has no design reason, it's just nothing to show yet.
  const hasSecondaryColumn = Boolean(budgetSummary) || attentionItems.length > 0;
  const mainColumnSpan = hasSecondaryColumn ? "lg:col-span-2" : "lg:col-span-3";

  return (
    <div className="flex flex-col gap-5">
      {householdSpending && (
        <div className="flex flex-col gap-3">
          <h1 className="text-lg font-semibold text-text-primary">
            {householdSpending.workspaceName}
          </h1>
          <HouseholdSpendingCard breakdown={householdSpending} />
        </div>
      )}

      {/* Single column on mobile/tablet, in the exact IA order from
          master prompt §8 (balance, today's totals, budget status,
          attention items, recent transactions). At lg: and up this
          becomes a 2:1 two-column grid (§10) - the wider left column
          spans both grid columns via col-span-2, while budget/attention
          get explicit col-start-3 placement into the narrower right
          column, so document/reading order stays identical across
          breakpoints and only the visual position changes. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-3 lg:items-start lg:gap-5">
      {onboarding.showNudge && (
        <div className={`lg:col-start-1 ${mainColumnSpan}`}>
          <OnboardingCard snapshot={onboarding} />
        </div>
      )}

      <div className={`lg:col-start-1 ${mainColumnSpan}`}>
        <BalanceCard balanceRwf={balance?.amountRwf ?? null} asOfIso={balance?.asOfIso ?? null} />
      </div>

      <section
        aria-label="Today's activity"
        className={`grid grid-cols-2 gap-3 lg:col-start-1 ${mainColumnSpan}`}
      >
        <SummaryMetric label="Received today" amountRwf={today.receivedRwf} />
        <SummaryMetric label="Spent today" amountRwf={-today.spentRwf} />
      </section>

      {/* Both omitted entirely (not an empty-state box) when there's no
          active budget / nothing needs attention - a quiet dashboard on a
          quiet day is correct, not broken (master prompt §8.2/§8.3). */}
      {budgetSummary && (
        <div className="lg:col-start-3 lg:row-start-1">
          <BudgetStatusCard
            budgetId={budgetSummary.budgetId}
            totalTargetMinor={budgetSummary.totalTargetMinor}
            totalActualMinor={budgetSummary.totalActualMinor}
            remainingMinor={budgetSummary.remainingMinor}
            percentUsed={budgetSummary.percentUsed}
            worstStatus={budgetSummary.worstStatus}
            daysRemainingInPeriod={budgetSummary.daysRemainingInPeriod}
          />
        </div>
      )}

      {attentionItems.length > 0 && (
        <div className="lg:col-start-3 lg:row-start-2">
          <AttentionItemsCard items={attentionItems} />
        </div>
      )}

      <section className={`rounded-card border border-border-subtle bg-surface p-1.5 lg:col-start-1 ${mainColumnSpan}`}>
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Recent transactions
          </h2>
          <Link
            href="/transactions"
            className="rounded px-1 text-sm font-medium text-accent hover:underline"
          >
            See all
          </Link>
        </div>
        {recentTransactions.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="New MoMo transactions will appear here automatically."
          />
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle">
            {recentTransactions.map((transaction) => (
              <DashboardTransactionItem
                key={transaction.id}
                transaction={transaction}
                showDate
              />
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
