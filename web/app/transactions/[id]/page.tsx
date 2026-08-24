import { notFound } from "next/navigation";
import { getTransactionById, getTransactionSplits } from "../../../lib/queries";
import { formatFullDateTime, formatRwf } from "../../../lib/format";
import { displayName } from "../../../lib/display-name";
import { isSupportedCurrency } from "../../../lib/money";
import { MoneyAmount } from "../../../components/MoneyAmount";
import { Badge } from "../../../components/Badge";
import { CategoryCorrectionForm } from "../../../components/CategoryCorrectionForm";
import { TransactionSplitForm } from "../../../components/TransactionSplitForm";

export const dynamic = "force-dynamic";

function reasonToSentence(source: string | null): string {
  if (source === "manual") return "You corrected this category.";
  if (source === "rule") return "Matched an existing merchant rule.";
  if (source === "ai") return "Suggested automatically.";
  if (source === "system") return "Assigned by the system.";
  return "Not categorized yet.";
}

export default async function TransactionDetailPage({
  params,
}: PageProps<"/transactions/[id]">) {
  const { id } = await params;
  const transaction = await getTransactionById(id);

  if (!transaction) {
    notFound();
  }

  const canSplit = transaction.direction === "out" &&
    transaction.settlement_state === "settled" &&
    transaction.principal_effect_rwf !== null &&
    isSupportedCurrency(transaction.currency);
  const splits = canSplit ? await getTransactionSplits(id) : [];
  const transactionEffectMinor = canSplit
    ? Math.abs(Number(transaction.principal_effect_rwf) + Number(transaction.fee_effect_rwf))
    : 0;

  const signedAmount =
    transaction.direction === "in"
      ? transaction.amount_rwf
      : transaction.direction === "out"
        ? -transaction.amount_rwf
        : 0;

  const isFailed = transaction.status !== "success";

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-card border border-border-subtle bg-surface px-6 py-7 text-center">
        <p className="text-sm font-medium text-text-muted">
          {displayName(transaction)}
        </p>
        <div className="mt-2">
          <MoneyAmount amountRwf={isFailed ? 0 : signedAmount} size="xl" />
        </div>
        <p className="mt-2 text-sm text-text-muted">
          {formatFullDateTime(transaction.occurred_at)}
        </p>
        {isFailed && (
          <div className="mt-3">
            <Badge variant="attention">
              {transaction.status === "failed"
                ? "Failed"
                : transaction.status}
            </Badge>
          </div>
        )}
      </section>

      <section
        aria-label="Transaction details"
        className="rounded-card border border-border-subtle bg-surface p-4"
      >
        <dl className="flex flex-col divide-y divide-border-subtle text-sm">
          <Row label="Amount" value={formatRwf(transaction.amount_rwf)} />
          {transaction.fee_rwf > 0 && (
            <Row label="Fee" value={formatRwf(transaction.fee_rwf)} />
          )}
          <Row
            label="Direction"
            value={
              transaction.direction === "in"
                ? "Money in"
                : transaction.direction === "out"
                  ? "Money out"
                  : "Neutral"
            }
          />
          {transaction.balance_after_rwf !== null && (
            <Row
              label="Balance after"
              value={formatRwf(transaction.balance_after_rwf)}
            />
          )}
          <Row
            label="Type"
            value={transaction.transaction_type.replaceAll("_", " ")}
          />
        </dl>
      </section>

      <section
        aria-label="Category"
        className="rounded-card border border-border-subtle bg-surface p-4"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Category
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <p className="text-base font-medium text-text-primary">
            {transaction.category ?? "Uncategorized"}
            {transaction.subcategory ? ` · ${transaction.subcategory}` : ""}
          </p>
          {!transaction.category && <Badge variant="attention">Needs review</Badge>}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {reasonToSentence(transaction.category_source)}
        </p>
        <CategoryCorrectionForm
          transactionId={transaction.id}
          currentCategory={transaction.category}
          currentSubcategory={transaction.subcategory}
          counterpartyName={transaction.counterparty_name}
        />
      </section>

      {canSplit && isSupportedCurrency(transaction.currency) && (
        <section
          aria-label="Budget split"
          className="rounded-card border border-border-subtle bg-surface p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Budget allocation
          </p>
          <p className="mt-1 text-sm text-text-muted">
            By default this transaction counts entirely toward its
            category&apos;s mapped allocation. Split it to divide the
            amount across multiple allocations instead.
          </p>
          <TransactionSplitForm
            transactionId={transaction.id}
            currency={transaction.currency}
            transactionEffectMinor={transactionEffectMinor}
            existingSplits={splits}
          />
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
