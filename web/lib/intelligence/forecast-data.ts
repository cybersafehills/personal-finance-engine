import "server-only";

import { completePages, minor } from "../../shared/financial";
import { lastNCompleteMonthKeys } from "../budget-math";
import { isBillsEnabled } from "../bills/gate";
import { kigaliDateKey, kigaliDayBoundsUtc } from "../kigali-time";
import { isOneLedger3FlagEnabled } from "../oneledger3-flags";
import { getCurrentBalance } from "../queries";
import { supabaseSession } from "../supabase-session-server";
import { loadWallets } from "../wallets/wallets-data";
import type { ForecastHorizon, WalletForecastEntry } from "./forecast-api";
import {
  buildWalletForecast,
  type DueBillInput,
  type ForecastTxn,
} from "./wallet-forecast";

export const FORECAST_HISTORY_MONTHS = 4;
export const MAX_FORECAST_ROWS = 20_000;
type Client = Awaited<ReturnType<typeof supabaseSession>>;
type ScopedTxn = ForecastTxn & { accountId: string | null };

type HistoryRow = {
  id: string;
  account_id: string | null;
  direction: string;
  counterparty_name: string | null;
  category: string | null;
  principal_effect_rwf: number | string | null;
  fee_effect_rwf: number | string | null;
  occurred_at: string;
};

function safeAmount(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError("forecast_amount_unavailable");
  }
  return number;
}

export async function loadForecastHistory(
  client: Client,
  workspaceId: string,
  now: Date,
  accountId?: string,
): Promise<ScopedTxn[]> {
  const month = kigaliDateKey(now.toISOString()).slice(0, 7);
  const months = lastNCompleteMonthKeys(month, FORECAST_HISTORY_MONTHS);
  const { startUtc } = kigaliDayBoundsUtc(`${months[0]}-01`);
  let coverage = 0n;
  let lastId: string | undefined;
  const rows = await completePages<HistoryRow>(async (_offset, size) => {
    let query = client.from("financial_activity_v")
      .select(
        "id,account_id,direction,counterparty_name,category,principal_effect_rwf,fee_effect_rwf,occurred_at",
      )
      .eq("workspace_id", workspaceId).eq("currency", "RWF").eq(
        "settlement_state",
        "settled",
      )
      .neq("dedupe_state", "merged").eq("is_own_transfer", false).in(
        "direction",
        ["in", "out"],
      )
      .gte("occurred_at", startUtc.toISOString()).lte(
        "occurred_at",
        now.toISOString(),
      );
    if (accountId) query = query.eq("account_id", accountId);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query.order("id").limit(size);
    if (error) throw new Error("Forecast history is unavailable.");
    lastId = data?.at(-1)?.id ?? lastId;
    return data ?? [];
  }, MAX_FORECAST_ROWS);

  return rows.map((row) => {
    if (row.principal_effect_rwf === null || row.fee_effect_rwf === null) {
      throw new RangeError("forecast_amount_unavailable");
    }
    const net = minor(row.principal_effect_rwf) + minor(row.fee_effect_rwf);
    const amount = net < 0n ? -net : net;
    coverage += amount;
    safeAmount(coverage);
    return {
      id: row.id,
      accountId: row.account_id,
      direction: row.direction,
      settled: true,
      counterpartyName: row.counterparty_name,
      category: row.category,
      amountMinor: safeAmount(amount),
      occurredAt: row.occurred_at,
    };
  });
}

async function loadDueBills(
  client: Client,
  workspaceId: string,
  now: Date,
  days: number,
): Promise<DueBillInput[]> {
  if (!isBillsEnabled(workspaceId)) return [];
  const first = kigaliDateKey(now.toISOString());
  const last = kigaliDateKey(
    new Date(now.getTime() + days * 86_400_000).toISOString(),
  );
  const rows = await completePages<
    { total_minor: number | string; due_date: string }
  >(async (offset, size) => {
    const { data, error } = await client.from("bills").select(
      "total_minor,due_date",
    )
      .eq("workspace_id", workspaceId).eq("currency", "RWF")
      .eq("status", "open").eq("paid_state", "unpaid")
      .gte("due_date", first).lte("due_date", last).order("id").range(
        offset,
        offset + size - 1,
      );
    if (error) throw new Error("Scheduled bills are unavailable.");
    return data ?? [];
  }, MAX_FORECAST_ROWS);
  return rows.map((row) => ({
    totalMinor: safeAmount(minor(row.total_minor)),
    dueDate: row.due_date,
  }));
}

export async function loadCashFlowForecast(workspaceId: string, options: {
  days?: ForecastHorizon;
  accountId?: string;
  now?: Date;
  history?: Promise<ScopedTxn[]>;
} = {}): Promise<WalletForecastEntry[]> {
  const { days = 30, accountId, now = new Date() } = options;
  const client = await supabaseSession();
  const perWallet = isOneLedger3FlagEnabled(
    process.env,
    "BALANCE_PROVENANCE",
    workspaceId,
  );
  if (!perWallet && accountId) return [];

  const [wallets, legacy] = await Promise.all([
    perWallet ? loadWallets(client, workspaceId, now) : [],
    perWallet ? null : getCurrentBalance(),
  ]);
  const eligible = wallets.filter((wallet) =>
    wallet.currency === "RWF" &&
    wallet.balance.amountMinor !== null &&
    wallet.balance.basis === "provider_reported"
  );
  const defaultId = (eligible.find((wallet) => wallet.isPrimary) ?? eligible[0])
    ?.id;
  const chosen = eligible.filter((wallet) =>
    !accountId || wallet.id === accountId
  );
  if (!legacy?.accountId && chosen.length === 0) return [];

  const [history, bills] = await Promise.all([
    options.history ?? loadForecastHistory(client, workspaceId, now, accountId),
    !accountId || accountId === defaultId
      ? loadDueBills(client, workspaceId, now, days)
      : [],
  ]);
  const build = (
    txns: ForecastTxn[],
    balanceMinor: number,
    dueBills: DueBillInput[],
  ) => {
    const { forecast } = buildWalletForecast({
      balanceMinor,
      currency: "RWF",
      txns,
      dueBills,
      nowMs: now.getTime(),
      truncated: false,
      horizonDays: days,
      historyMonths: FORECAST_HISTORY_MONTHS,
    });
    if (
      !forecast || ![
        forecast.projectedEnd.knownBalanceMinor,
        forecast.projectedEnd.estimatedBalanceMinor,
        forecast.projectedEnd.noIncomeBalanceMinor,
        forecast.projectedLow.estimatedBalanceMinor,
        ...forecast.points.flatMap((
          point,
        ) => [point.knownBalanceMinor, point.estimatedBalanceMinor]),
      ].every(Number.isSafeInteger)
    ) throw new RangeError("forecast_amount_unavailable");
    return forecast;
  };

  if (legacy?.accountId) {
    return [{
      walletId: legacy.accountId,
      name: "Wallet with latest recorded balance",
      isDefault: true,
      balanceAsOf: legacy.asOfIso,
      forecast: build(
        history.filter((row) => row.accountId === legacy.accountId),
        safeAmount(minor(legacy.amountRwf)),
        bills,
      ),
    }];
  }

  const byAccount = new Map<string, ForecastTxn[]>();
  for (const row of history) {
    if (!row.accountId) continue;
    const bucket = byAccount.get(row.accountId) ?? [];
    bucket.push(row);
    byAccount.set(row.accountId, bucket);
  }
  return chosen.map((wallet) => ({
    walletId: wallet.id,
    name: wallet.name,
    isDefault: wallet.id === defaultId,
    balanceAsOf: wallet.balance.asOf,
    forecast: build(
      byAccount.get(wallet.id) ?? [],
      safeAmount(wallet.balance.amountMinor!),
      wallet.id === defaultId ? bills : [],
    ),
  }));
}
