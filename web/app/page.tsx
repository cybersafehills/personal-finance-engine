import Link from "next/link";
import {
  getAttentionItems,
  getCurrentBalance,
  getDashboardBudgetSummary,
  getRecentTransactions,
  getTodayTotals,
} from "../lib/queries";
import { BalanceCard } from "../components/BalanceCard";
import { SummaryMetric } from "../components/SummaryMetric";
import { BudgetStatusCard } from "../components/BudgetStatusCard";
import { AttentionItemsCard } from "../components/AttentionItemsCard";
import { DashboardTransactionItem } from "../components/DashboardTransactionItem";
import { EmptyState } from "../components/EmptyState";

// Always read live from the database - this is a live balance/transaction
// view, not cacheable content.
export const dynamic = "force-dynamic";

const RECENT_TRANSACTIONS_LIMIT = 6;

export default async function HomePage() {
  const [balance, today, recentTransactions, budgetSummary, attentionItems] = await Promise.all([
    getCurrentBalance(),
    getTodayTotals(),
    getRecentTransactions(RECENT_TRANSACTIONS_LIMIT),
    getDashboardBudgetSummary(),
    getAttentionItems(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <BalanceCard balanceRwf={balance} />

      <section
        aria-label="Today's activity"
        className="grid grid-cols-2 gap-3"
      >
        <SummaryMetric label="Received today" amountRwf={today.receivedRwf} />
        <SummaryMetric label="Spent today" amountRwf={-today.spentRwf} />
      </section>

      {/* Both omitted entirely (not an empty-state box) when there's no
          active budget / nothing needs attention - a quiet dashboard on a
          quiet day is correct, not broken (master prompt §8.2/§8.3). */}
      {budgetSummary && (
        <BudgetStatusCard
          budgetId={budgetSummary.budgetId}
          totalTargetMinor={budgetSummary.totalTargetMinor}
          totalActualMinor={budgetSummary.totalActualMinor}
          remainingMinor={budgetSummary.remainingMinor}
          percentUsed={budgetSummary.percentUsed}
          worstStatus={budgetSummary.worstStatus}
          daysRemainingInPeriod={budgetSummary.daysRemainingInPeriod}
        />
      )}

      <AttentionItemsCard items={attentionItems} />

      <section className="rounded-card border border-border-subtle bg-surface p-1.5">
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
  );
}
