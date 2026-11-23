// Framework-free contract used by web and native, including offline projections.
// Legacy *_rwf columns hold minor units of the row's currency, never implicit FX.
export const CURRENCY_SCALE = { RWF: 0, USD: 2, EUR: 2 } as const;
export type Currency = keyof typeof CURRENCY_SCALE;
export function isCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_SCALE, value);
}
export function minor(value: number | string | bigint): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("unsafe_money");
  }
  return BigInt(value);
}
export function formatAmount(
  value: number | string | bigint,
  currency: string,
  signed = true,
): string {
  if (!isCurrency(currency)) throw new RangeError("unsupported_currency");
  const amount = minor(value);
  const scale = CURRENCY_SCALE[currency];
  const digits = (amount < 0n ? -amount : amount).toString().padStart(
    scale + 1,
    "0",
  );
  const whole = (scale ? digits.slice(0, -scale) : digits).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${
    amount < 0n ? "−" : signed && amount > 0n ? "+" : ""
  }${currency} ${whole}${scale ? `.${digits.slice(-scale)}` : ""}`;
}
export type FinancialRow = {
  id: string;
  currency: string;
  direction: string;
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
  settlement_state?: string | null;
  dedupe_state?: string;
  sync_state?: string;
  is_own_transfer?: boolean | number;
};
export type CurrencyFlow = {
  currency: Currency;
  sentMinor: number;
  receivedMinor: number;
  count: number;
};
/** Own-account movements (including their fees) follow existing web exclusion
 * semantics. They still affect wallet balances. No new fee-spending policy here. */
export function currencyFlows(
  rows: readonly FinancialRow[],
  excluded: ReadonlySet<string> = new Set(),
): CurrencyFlow[] {
  const totals = new Map<
    Currency,
    { sent: bigint; received: bigint; count: number }
  >();
  for (const row of rows) {
    if (
      row.dedupe_state === "merged" || row.sync_state === "failed" ||
      (row.settlement_state !== undefined && row.settlement_state !== "settled")
    ) continue;
    if (excluded.has(row.id) || row.is_own_transfer) continue;
    if (row.direction !== "in" && row.direction !== "out") continue;
    if (
      !isCurrency(row.currency) || row.principal_effect_rwf === null ||
      row.fee_effect_rwf === null
    ) throw new RangeError("financial_value_unavailable");
    const effect = minor(row.principal_effect_rwf) + minor(row.fee_effect_rwf);
    const total = totals.get(row.currency) ??
      { sent: 0n, received: 0n, count: 0 };
    if (row.direction === "out") total.sent += effect < 0n ? -effect : effect;
    else total.received += effect;
    total.count++;
    totals.set(row.currency, total);
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(
    ([currency, t]) => {
      const sentMinor = Number(t.sent), receivedMinor = Number(t.received);
      if (
        !Number.isSafeInteger(sentMinor) || !Number.isSafeInteger(receivedMinor)
      ) throw new RangeError("unsafe_money_total");
      return { currency, sentMinor, receivedMinor, count: t.count };
    },
  );
}
/** Short pages are not exhaustion: deployments can cap below our page size.
 * Request another page until the server actually returns no rows. */
export async function completePages<T>(
  fetchPage: (offset: number, size: number) => Promise<readonly T[]>,
  maxRows = 100_000,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await fetchPage(
      rows.length,
      Math.min(pageSize, maxRows - rows.length + 1),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
    if (rows.length > maxRows) {
      throw new RangeError("financial_coverage_exceeded");
    }
  }
}
