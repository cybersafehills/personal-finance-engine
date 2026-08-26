"use client";

import { TransactionItem } from "./TransactionItem";
import { usePrivacy } from "./PrivacyProvider";
import type { TransactionRow } from "../lib/queries";

/**
 * TransactionItem as used specifically in the Home dashboard's recent-
 * transactions preview: reads full privacy mode from the shared
 * PrivacyProvider (already bootstrapped server-side, no extra fetch) so
 * the Home page itself can stay a plain server component. The full
 * Transactions page renders TransactionItem directly, unmasked - see
 * TransactionItem's own `masked` prop comment.
 */
export function DashboardTransactionItem({
  transaction,
  showDate,
}: {
  transaction: TransactionRow;
  showDate?: boolean;
}) {
  const { isDashboardMasked } = usePrivacy();
  return (
    <TransactionItem
      transaction={transaction}
      showDate={showDate}
      masked={isDashboardMasked}
    />
  );
}
