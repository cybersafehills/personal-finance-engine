import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "../../components/Badge";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { InsightAmount } from "../../components/insights/InsightAmount";
import { RecordBalanceForm } from "../../components/wallets/RecordBalanceForm";
import { formatZonedDateTime } from "../../lib/format";
import { formatMoney, hasKnownScale } from "../../lib/insights/insights-facts";
import { isSupportedCurrency, minorUnitsPerMajor } from "../../lib/money";
import { isOneLedger3FlagEnabled } from "../../lib/oneledger3-flags";
import { getActiveWorkspaceId } from "../../lib/queries";
import { supabaseSession } from "../../lib/supabase-session-server";
import { isValidReportTimezone } from "../../lib/timezones";
import {
  type EnteredBalance,
  loadEnteredBalances,
  loadWallets,
  type WalletRow,
} from "../../lib/wallets/wallets-data";
import {
  PROVIDER_LABEL,
  reasonText,
  STATUS_LABEL,
  STATUS_MEANING,
  STATUS_VARIANT,
  totalsByCurrency,
} from "../../lib/wallets/wallets-display";

export const dynamic = "force-dynamic";

const card = "rounded-card border border-border-subtle bg-surface p-4";
const link = "text-sm font-medium text-accent hover:underline";
const HISTORY_PER_WALLET = 3;

function WalletCard({
  w,
  tz,
  entered,
  insightsEnabled,
}: {
  w: WalletRow;
  tz: string;
  entered: EnteredBalance[];
  insightsEnabled: boolean;
}) {
  const b = w.balance;
  const headingId = `wallet-${w.id}`;
  return (
    <section aria-labelledby={headingId} className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-base font-semibold text-text-primary">
            {w.name}
          </h2>
          <p className="text-xs text-text-muted">
            {PROVIDER_LABEL[w.provider] ?? "Other"} · {w.currency}
            {w.isPrimary ? " · Primary" : ""}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
      </div>

      <div>
        <p className="text-2xl font-semibold">
          {b.amountMinor === null
            ? <span className="text-text-muted">No balance yet</span>
            : (
              <InsightAmount
                kind="balance"
                text={formatMoney(b.amountMinor, w.currency)}
              />
            )}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {STATUS_MEANING[b.status]}
        </p>
        {b.asOf && (
          <p className="mt-1 text-xs text-text-muted">
            {b.status === "estimated" ? "Starting from a balance " : ""}
            as of {formatZonedDateTime(b.asOf, tz)}
            {b.basis === "manual"
              ? " (entered by a member of this Space)"
              : " (from your provider’s message)"}
          </p>
        )}
        {b.reasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-text-muted">
            {b.reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}
          </ul>
        )}
        {!hasKnownScale(w.currency) && b.amountMinor !== null && (
          <p className="mt-2 text-xs text-attention">
            OneLedger doesn’t yet know how {w.currency}{" "}
            amounts are divided, so this figure is shown as recorded.
          </p>
        )}
      </div>

      <RecordBalanceForm
        accountId={w.id}
        walletName={w.name}
        currency={w.currency}
        wholeUnitsOnly={!isSupportedCurrency(w.currency) ||
          minorUnitsPerMajor(w.currency) === 1}
      />

      {entered.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-secondary">
            Balances entered by hand
          </h3>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-text-muted">
            {entered.slice(0, HISTORY_PER_WALLET).map((o) => (
              <li key={o.id}>
                <InsightAmount
                  kind="balance"
                  text={formatMoney(o.amountMinor, o.currency)}
                />{" "}
                on {formatZonedDateTime(o.asOf, tz)}
                {o.note ? ` — ${o.note}` : ""}
              </li>
            ))}
          </ul>
          {entered.length > HISTORY_PER_WALLET && (
            <p className="mt-1 text-xs text-text-muted">
              Showing the latest {HISTORY_PER_WALLET}. Earlier entries are kept.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {w.financialSourceId && (
          <Link
            href={`/transactions?account=${w.financialSourceId}`}
            className={link}
          >
            Transactions<span className="sr-only">for {w.name}</span>
          </Link>
        )}
        {w.financialSourceId && insightsEnabled && (
          <Link
            href={`/insights?account=${w.financialSourceId}`}
            className={link}
          >
            Insights<span className="sr-only">for {w.name}</span>
          </Link>
        )}
        <Link href={`/settings/accounts/${w.id}`} className={link}>
          Wallet details<span className="sr-only">for {w.name}</span>
        </Link>
      </div>
    </section>
  );
}

export default async function WalletsPage() {
  const workspaceId = await getActiveWorkspaceId();
  if (
    !workspaceId ||
    !isOneLedger3FlagEnabled(process.env, "BALANCE_PROVENANCE", workspaceId)
  ) {
    notFound();
  }

  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const profileTz = typeof profile?.timezone === "string" ? profile.timezone : "";
  const tz = isValidReportTimezone(profileTz) ? profileTz : "Africa/Kigali";

  let wallets: WalletRow[];
  let entered: EnteredBalance[];
  const insightsEnabled = isOneLedger3FlagEnabled(
    process.env,
    "INSIGHTS_CENTER",
    workspaceId,
  );
  try {
    [wallets, entered] = await Promise.all([
      loadWallets(supabase, workspaceId),
      loadEnteredBalances(supabase, workspaceId),
    ]);
  } catch (e) {
    console.error(
      "wallets page failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return (
      <div>
        <PageHeader title="Wallets" />
        <div role="alert" className={`${card} text-sm text-text-secondary`}>
          <p className="font-medium text-text-primary">
            We couldn’t load your wallets.
          </p>
          <p className="mt-1">
            No balances are shown because they might be incomplete.{" "}
            <Link href="/wallets" className={link}>Try again</Link>
          </p>
        </div>
      </div>
    );
  }

  const totals = totalsByCurrency(
    wallets.map((w) => ({
      currency: w.currency,
      status: w.balance.status,
      amountMinor: w.balance.amountMinor,
    })),
  );
  const enteredByAccount = new Map<string, EnteredBalance[]>();
  for (const o of entered) {
    const list = enteredByAccount.get(o.accountId) ?? [];
    list.push(o);
    enteredByAccount.set(o.accountId, list);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Wallets"
        subtitle="What OneLedger knows about each balance, and how sure it is"
        action={
          <Link href="/settings/accounts" className={link}>
            Manage accounts
          </Link>
        }
      />

      {wallets.length === 0
        ? (
          <EmptyState
            variant="setup"
            title="No wallets yet"
            description="Add an account to see its balance here."
            action={
              <Link href="/settings/accounts" className={link}>
                Add an account
              </Link>
            }
          />
        )
        : (
          <>
            {wallets.length > 1 && totals.some((t) => t.counted > 0) && (
              <section aria-label="Known balances added up" className={card}>
                <h2 className="text-sm font-semibold text-text-primary">
                  Known balances added up
                </h2>
                <ul className="mt-2 flex flex-col gap-2">
                  {totals.filter((t) => t.counted > 0).map((t) => (
                    <li key={t.currency} className="text-sm text-text-secondary">
                      <span className="text-lg font-semibold">
                        <InsightAmount
                          kind="balance"
                          text={formatMoney(t.totalMinor, t.currency)}
                        />
                      </span>{" "}
                      across {t.counted} wallet{t.counted === 1 ? "" : "s"}.{" "}
                      {t.allConfirmed
                        ? "Each figure is the one your provider last reported."
                        : `${t.uncertain} of ${t.counted} ${
                          t.uncertain === 1 ? "figure is" : "figures are"
                        } estimated or out of date, so this is not a live total.`}
                      {t.unavailable > 0 &&
                        ` ${t.unavailable} wallet${
                          t.unavailable === 1 ? " has" : "s have"
                        } no balance yet and ${
                          t.unavailable === 1 ? "is" : "are"
                        } not included.`}
                    </li>
                  ))}
                </ul>
                {totals.length > 1 && (
                  <p className="mt-2 text-xs text-text-muted">
                    Currencies are never added together or converted.
                  </p>
                )}
              </section>
            )}

            {wallets.map((w) => (
              <WalletCard
                key={w.id}
                w={w}
                tz={tz}
                entered={enteredByAccount.get(w.id) ?? []}
                insightsEnabled={insightsEnabled}
              />
            ))}

            <p className="text-xs text-text-muted">
              OneLedger never asks your provider for a balance. “Confirmed”
              means the figure in your provider’s most recent message;
              everything else is worked out from your transactions and may
              differ from what your provider shows. Times are in{" "}
              {tz.replace(/_/g, " ")}.
            </p>
          </>
        )}
    </div>
  );
}
