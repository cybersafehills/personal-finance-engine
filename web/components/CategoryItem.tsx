import Link from "next/link";
import { formatRwf } from "../lib/format";
import { Badge } from "./Badge";
import type { CategoryTotal } from "../lib/queries";

export function CategoryItem({
  category,
  share,
}: {
  category: CategoryTotal;
  /** This category's total as a fraction (0-1) of all spending shown. */
  share: number;
}) {
  const isUncategorized = category.category === "Uncategorized";
  const barWidthPercent = Math.max(share * 100, 2);

  return (
    <Link
      href={`/transactions?category=${encodeURIComponent(category.category)}`}
      className="flex flex-col gap-2 rounded-control px-3 py-3 transition-colors hover:bg-background focus-visible:bg-background"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {category.category}
          </span>
          {isUncategorized && <Badge variant="attention">Needs review</Badge>}
        </div>
        <span className="text-sm font-semibold tabular-nums text-text-primary">
          {formatRwf(category.totalRwf)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-background">
        <div
          className={`h-full rounded-full ${isUncategorized ? "bg-attention" : "bg-accent"}`}
          style={{ width: `${barWidthPercent}%` }}
        />
      </div>
      <span className="text-xs text-text-muted">
        {category.transactionCount}{" "}
        {category.transactionCount === 1 ? "transaction" : "transactions"}
      </span>
    </Link>
  );
}
