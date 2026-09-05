import { assertEquals } from "jsr:@std/assert@1";
import {
  DEFAULT_ALERT_THRESHOLDS,
  resolveAlertThresholds,
  type StoredAlertThresholds,
} from "./report-math.ts";

Deno.test("resolveAlertThresholds: null/undefined row yields the system defaults verbatim", () => {
  assertEquals(resolveAlertThresholds(null), DEFAULT_ALERT_THRESHOLDS);
  assertEquals(resolveAlertThresholds(undefined), DEFAULT_ALERT_THRESHOLDS);
  assertEquals(resolveAlertThresholds({}), DEFAULT_ALERT_THRESHOLDS);
});

Deno.test("resolveAlertThresholds: a fully-populated row is mapped column-for-field", () => {
  const stored: StoredAlertThresholds = {
    alert_large_transaction_rwf: 250_000,
    alert_high_daily_spend_rwf: 400_000,
    alert_elevated_fees_rwf: 8_000,
    alert_low_balance_rwf: 25_000,
    alert_sustained_negative_cashflow_days: 5,
    alert_uncategorized_percent: 70,
  };
  assertEquals(resolveAlertThresholds(stored), {
    largeTransactionRwf: 250_000,
    highDailySpendRwf: 400_000,
    elevatedFeesRwf: 8_000,
    lowBalanceRwf: 25_000,
    sustainedNegativeCashflowDays: 5,
    uncategorizedPercentThreshold: 70,
  });
});

Deno.test("resolveAlertThresholds: a stored null low-balance disables the check (not a fallback to default)", () => {
  const resolved = resolveAlertThresholds({
    alert_large_transaction_rwf: 100_000,
    alert_high_daily_spend_rwf: 200_000,
    alert_elevated_fees_rwf: 5_000,
    alert_low_balance_rwf: null,
    alert_sustained_negative_cashflow_days: 3,
    alert_uncategorized_percent: 50,
  });
  assertEquals(resolved.lowBalanceRwf, null);
});

Deno.test("resolveAlertThresholds: a missing low-balance column (pre-migration row) falls back to the default", () => {
  // alert_low_balance_rwf absent entirely - undefined, not null.
  const resolved = resolveAlertThresholds({
    alert_large_transaction_rwf: 100_000,
  });
  assertEquals(resolved.lowBalanceRwf, DEFAULT_ALERT_THRESHOLDS.lowBalanceRwf);
});

Deno.test("resolveAlertThresholds: each field falls back independently when its column is absent", () => {
  const resolved = resolveAlertThresholds({ alert_uncategorized_percent: 90 });
  assertEquals(resolved, {
    ...DEFAULT_ALERT_THRESHOLDS,
    uncategorizedPercentThreshold: 90,
  });
});

Deno.test("DEFAULT_ALERT_THRESHOLDS matches the values the DB migration defaults each column to", () => {
  // If these drift, migration 20261128000000_report_alert_thresholds.sql
  // and this constant disagree and existing rows behave differently from
  // a fresh unset one. Keep them in lockstep.
  assertEquals(DEFAULT_ALERT_THRESHOLDS, {
    largeTransactionRwf: 100_000,
    highDailySpendRwf: 200_000,
    elevatedFeesRwf: 5_000,
    lowBalanceRwf: 10_000,
    sustainedNegativeCashflowDays: 3,
    uncategorizedPercentThreshold: 50,
  });
});
