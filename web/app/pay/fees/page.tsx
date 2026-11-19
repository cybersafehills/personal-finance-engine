import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { InsightAmount } from "../../../components/insights/InsightAmount";
import { formatZonedDate } from "../../../lib/format";
import { formatMoney } from "../../../lib/insights/insights-facts";
import {
  FEE_TRANSACTION_TYPES,
  type LimitWarning,
  parseFeeQuery,
  type PublishedEstimate,
  RECIPIENT_SCOPE_LABEL,
} from "../../../lib/fees/fee-estimate";
import {
  loadFeeHistory,
  loadNetworkFees,
  loadProviderTariffs,
  loadTariffProviders,
  loadViewerTimezone,
} from "../../../lib/fees/fee-data";
import { buildFeeResult, FEE_DISCLAIMER } from "../../../lib/fees/fee-result";
import { SUPPORTED_CURRENCIES } from "../../../lib/money";
import { isOneLedger3FlagEnabled } from "../../../lib/oneledger3-flags";
import { isPaymentNetworksEnabled, isPayServicesEnabled } from "../../../lib/pay/gate";
import { getPublishedNetworks } from "../../../lib/directory/public-queries";
import { getActiveWorkspaceId, getWorkspaceDefaultCurrency } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";

export const dynamic = "force-dynamic";

const card = "rounded-card border border-border-subtle bg-surface p-4";
const control =
  "min-h-11 w-full rounded-control border border-border-subtle bg-background px-3 py-2 text-base text-text-primary";
const label = "flex flex-col gap-1 text-xs font-medium text-text-secondary";
const link = "font-medium text-accent hover:underline";

const NOT_COMPUTABLE: Record<string, string> = {
  tiered:
    "This fee depends on the amount, and OneLedger doesn't have the published bands, so it can't give you a number.",
  unknown: "No fee has been published for this.",
  varies_by_institution:
    "The fee varies by bank or provider. Ask yours before you pay.",
  incomplete: "The published fee is incomplete, so it can't be turned into a number.",
  currency_mismatch: "The published fee is in a different currency from your amount.",
  no_tiers: "This tariff has no amount bands recorded, so it can't give you a number.",
  amount_outside_bands:
    "This amount falls outside the bands the provider has published, so OneLedger won't guess a fee for it.",
  not_verified: "This tariff has not been verified yet.",
  unrecognised: "OneLedger doesn't recognise this kind of fee yet.",
};

function safeHttpsUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function PublishedLine({
  e,
  currency,
  tz,
  effectiveFrom,
  effectiveTo,
}: {
  e: PublishedEstimate;
  currency: string;
  tz: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}) {
  const m = (v: bigint) => formatMoney(v, currency);
  switch (e.status) {
    case "exact":
      return (
        <p className="text-2xl font-semibold">
          {e.feeMinor === 0n
            ? <span>No fee</span>
            : <InsightAmount text={m(e.feeMinor)} />}
        </p>
      );
    case "range":
      return (
        <p className="text-2xl font-semibold">
          <InsightAmount text={m(e.minMinor)} /> – <InsightAmount text={m(e.maxMinor)} />
        </p>
      );
    case "upper_bound":
      return (
        <div>
          <p className="text-2xl font-semibold">
            Up to <InsightAmount text={m(e.maxMinor)} />
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            This is a published <strong>maximum</strong>, not the fee you will
            necessarily pay. Your bank or provider sets the actual charge within
            it.
          </p>
        </div>
      );
    case "not_computable":
      return (
        <p className="text-sm text-text-secondary">
          {NOT_COMPUTABLE[e.reason] ?? NOT_COMPUTABLE.unrecognised}
        </p>
      );
    case "not_in_effect":
      return (
        <p className="text-sm text-text-secondary">
          {e.reason === "not_yet"
            ? `This published schedule starts on ${effectiveFrom ? formatZonedDate(effectiveFrom, tz) : "a later date"}.`
            : `This published schedule ended on ${effectiveTo ? formatZonedDate(effectiveTo, tz) : "an earlier date"}.`}
        </p>
      );
  }
}

function warningText(w: LimitWarning, currency: string): string {
  const x = formatMoney(w.limitMinor, currency);
  switch (w.kind) {
    case "above_maximum":
      return `This amount is above the ${w.publishedMaximum ? "published maximum" : "limit"} of ${x} for one transaction. Check the rules for larger amounts with your provider.`;
    case "above_daily":
      return `This amount is above the ${w.publishedMaximum ? "published " : ""}daily limit of ${x}. Check the rules with your provider.`;
    case "below_minimum":
      return `This amount is below the minimum of ${x} for one transaction.`;
  }
}

export default async function FeesPage({ searchParams }: PageProps<"/pay/fees">) {
  const workspaceId = await getActiveWorkspaceId();
  if (
    !workspaceId || !isPayServicesEnabled(workspaceId) ||
    !isOneLedger3FlagEnabled(process.env, "FEE_CALCULATOR", workspaceId)
  ) {
    notFound();
  }
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const sp = await searchParams;
  const q = parseFeeQuery(sp, await getWorkspaceDefaultCurrency());
  const networksOn = isPaymentNetworksEnabled(workspaceId);
  const kindLabel = FEE_TRANSACTION_TYPES.find((t) => t.value === q.type)?.label ??
    q.type;

  const [tz, networks, tariffProviders] = await Promise.all([
    loadViewerTimezone(supabase, user.id),
    networksOn ? getPublishedNetworks() : Promise.resolve([]),
    // empty until a verified tariff has been loaded: the choice then does not appear
    loadTariffProviders(supabase).catch(() => []),
  ]);

  let failed = false;
  let unknownNetwork = false;
  let unknownProvider = false;
  let result: ReturnType<typeof buildFeeResult> | null = null;
  if (q.amountMinor !== null) {
    try {
      const [history, network, provider] = await Promise.all([
        loadFeeHistory(supabase, workspaceId, q.type, q.currency),
        q.network && networksOn ? loadNetworkFees(supabase, q.network) : Promise.resolve(null),
        q.provider ? loadProviderTariffs(supabase, q.provider, q.type) : Promise.resolve(null),
      ]);
      unknownNetwork = Boolean(q.network && networksOn && !network);
      unknownProvider = Boolean(q.provider && !provider);
      result = buildFeeResult({
        amountMinor: q.amountMinor,
        currency: q.currency,
        type: q.type,
        history,
        network,
        provider,
        now: new Date(),
      });
    } catch (e) {
      console.error("fees page failed:", e instanceof Error ? e.message : "unknown error");
      failed = true;
    }
  }

  const m = (v: bigint) => formatMoney(v, q.currency);
  const h = result?.history;
  const pub = result?.published;
  const prov = result?.provider;
  const sourceUrl = safeHttpsUrl(pub?.schedule?.source_url ?? null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Estimate a transfer fee"
        subtitle="What similar payments have cost you, and what is published"
        backHref="/pay/activity"
        backLabel="Pay"
      />

      <form
        method="get"
        action="/pay/fees"
        aria-label="Fee estimate"
        className="grid grid-cols-2 gap-3 rounded-card border border-border-subtle bg-surface p-3 sm:grid-cols-4"
      >
        <label className={`${label} col-span-2 sm:col-span-1`}>
          Amount
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            defaultValue={q.amountText}
            placeholder="25,000"
            aria-invalid={q.amountError ? true : undefined}
            aria-describedby={q.amountError ? "fee-amount-error" : undefined}
            className={`${control} tabular-nums`}
          />
        </label>
        <label className={label}>
          Currency
          <select name="currency" defaultValue={q.currency} className={control}>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className={label}>
          Type of payment
          <select name="type" defaultValue={q.type} className={control}>
            {FEE_TRANSACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {tariffProviders.length > 0 && (
          <label className={label}>
            Provider’s own tariff
            <select name="provider" defaultValue={q.provider ?? ""} className={control}>
              <option value="">None</option>
              {tariffProviders.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        {networks.length > 0 && (
          <label className={label}>
            Published fees from
            <select name="network" defaultValue={q.network ?? ""} className={control}>
              <option value="">None</option>
              {networks.map((n) => (
                <option key={n.slug} value={n.slug}>{n.display_name_en || n.canonical_name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="col-span-2 sm:col-span-4">
          <button
            type="submit"
            className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
          >
            Estimate fee
          </button>
          {q.amountError && (
            <p id="fee-amount-error" role="alert" className="mt-2 text-sm text-attention">
              {q.amountError}
            </p>
          )}
        </div>
      </form>

      {failed && (
        <div role="alert" className={`${card} text-sm text-text-secondary`}>
          <p className="font-medium text-text-primary">We couldn’t work out an estimate.</p>
          <p className="mt-1">
            Nothing is shown rather than a number that might be wrong.{" "}
            <Link href="/pay/fees" className={link}>Try again</Link>
          </p>
        </div>
      )}

      {!result && !failed && !q.amountError && (
        <EmptyState
          title="Enter an amount to see what a payment like it costs"
          description="The estimate comes from fees you have actually been charged on similar payments, and from a published fee schedule when one exists. It never invents a tariff."
        />
      )}

      {result && h && (
        <section aria-label="Fees you have paid before" className={`${card} flex flex-col gap-3`}>
          <h2 className="text-base font-semibold text-text-primary">What you’ve paid before</h2>
          {h.status === "estimate"
            ? (
              <>
                <p className="text-2xl font-semibold">
                  {h.minMinor === h.maxMinor
                    ? <InsightAmount text={m(h.minMinor)} />
                    : (
                      <>
                        <InsightAmount text={m(h.minMinor)} /> – <InsightAmount text={m(h.maxMinor)} />
                      </>
                    )}
                </p>
                {h.typicalMinor !== null && h.minMinor !== h.maxMinor && (
                  <p className="text-sm text-text-secondary">
                    Most of them paid <InsightAmount text={m(h.typicalMinor)} />.
                  </p>
                )}
                <p className="text-sm text-text-secondary">
                  Based on {h.count} similar payments of yours ({kindLabel}), between{" "}
                  <InsightAmount text={m(h.windowLowMinor)} /> and{" "}
                  <InsightAmount text={m(h.windowHighMinor)} />, from{" "}
                  {formatZonedDate(h.firstAt, tz)} to {formatZonedDate(h.lastAt, tz)}.
                  Your provider may have changed its fees since then.
                  {result.historyCapped && " Only your latest 1,000 payments of this type were read."}
                </p>
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent similar payments (scrolls sideways)">
                  <table className="w-full min-w-[320px] text-sm">
                    <caption className="sr-only">Your most recent similar payments and the fee on each</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="py-1.5 pr-3 text-left text-xs font-medium text-text-muted">Date</th>
                        <th scope="col" className="py-1.5 pl-3 text-right text-xs font-medium text-text-muted">Amount</th>
                        <th scope="col" className="py-1.5 pl-3 text-right text-xs font-medium text-text-muted">Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {h.recent.map((r, i) => (
                        <tr key={`${r.at}-${i}`}>
                          <th scope="row" className="py-1.5 pr-3 text-left font-normal text-text-secondary">
                            {formatZonedDate(r.at, tz)}
                          </th>
                          <td className="py-1.5 pl-3 text-right"><InsightAmount text={m(r.amountMinor)} /></td>
                          <td className="py-1.5 pl-3 text-right"><InsightAmount text={m(r.feeMinor)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
            : h.status === "not_enough_history"
            ? (
              <p className="text-sm text-text-secondary">
                You have {h.similarCount === 0 ? "no" : `only ${h.similarCount}`}{" "}
                similar payment{h.similarCount === 1 ? "" : "s"} on record for
                “{kindLabel}” ({h.totalCount} of this kind in all, at any
                amount). At least 3 are needed to estimate a fee, so no
                estimate is shown.
              </p>
            )
            : (
              <p className="text-sm text-text-secondary">
                OneLedger has no recorded “{kindLabel}” payment in {q.currency}{" "}
                for you yet, so there is nothing to estimate from.
              </p>
            )}
        </section>
      )}

      {result && networksOn && q.network && unknownNetwork && (
        <p role="note" className={`${card} text-sm text-text-secondary`}>
          We couldn’t find that payment network.
        </p>
      )}

      {result && unknownProvider && (
        <p role="note" className={`${card} text-sm text-text-secondary`}>
          We couldn’t find that provider.
        </p>
      )}

      {result && prov && (
        <section aria-label={`Tariff published by ${prov.provider.name}`} className={`${card} flex flex-col gap-3`}>
          <h2 className="text-base font-semibold text-text-primary">
            {prov.provider.name}’s own tariff
          </h2>
          {!prov.hasTariff
            ? (
              <p className="text-sm text-text-secondary">
                OneLedger has no verified {prov.provider.name} tariff on record for “{kindLabel}”.
                Nothing is shown rather than a figure that hasn’t been checked against its source.
              </p>
            )
            : (
              <ul className="flex flex-col divide-y divide-border-subtle">
                {prov.rows.map((row) => {
                  const url = safeHttpsUrl(row.tariff.source_url);
                  return (
                    <li key={row.recipientScope} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium text-text-secondary">
                        {RECIPIENT_SCOPE_LABEL[row.recipientScope]}
                      </p>
                      <PublishedLine
                        e={row.estimate}
                        currency={q.currency}
                        tz={tz}
                        effectiveFrom={row.tariff.effective_from}
                        effectiveTo={row.tariff.effective_to}
                      />
                      <p className="text-xs text-text-muted">
                        {row.tariff.source_label ?? "Source not named"}
                        {url && (
                          <>
                            {" · "}
                            <a href={url} target="_blank" rel="noopener noreferrer" className={link}>
                              View the source<span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          </>
                        )}
                        {row.tariff.effective_from && ` · in effect since ${formatZonedDate(row.tariff.effective_from, tz)}`}
                        {row.tariff.verified_at && ` · checked against its source on ${formatZonedDate(row.tariff.verified_at, tz)}`}
                      </p>
                      {row.tariff.note_en && (
                        <p className="text-sm text-text-secondary">{row.tariff.note_en}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      )}

      {result && pub && (
        <section aria-label={`Published by ${pub.network.name}`} className={`${card} flex flex-col gap-3`}>
          <h2 className="text-base font-semibold text-text-primary">
            Published by {pub.network.name}
          </h2>
          {pub.estimate
            ? (
              <PublishedLine
                e={pub.estimate}
                currency={q.currency}
                tz={tz}
                effectiveFrom={pub.schedule?.effective_from ?? null}
                effectiveTo={pub.schedule?.effective_to ?? null}
              />
            )
            : (
              <p className="text-sm text-text-secondary">
                {pub.network.name} has no published fee on record with OneLedger.
              </p>
            )}
          {pub.schedule && (
            <p className="text-xs text-text-muted">
              {pub.schedule.source_label ?? "Source not named"}
              {sourceUrl && (
                <>
                  {" · "}
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className={link}>
                    View the source<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </>
              )}
              {pub.schedule.effective_from && ` · in effect since ${formatZonedDate(pub.schedule.effective_from, tz)}`}
            </p>
          )}
          {pub.schedule?.note_en && (
            <p className="text-sm text-text-secondary">{pub.schedule.note_en}</p>
          )}
          {pub.warnings.length > 0 && (
            <ul className="flex flex-col gap-2 rounded-control bg-attention-bg p-3 text-sm text-attention">
              {pub.warnings.map((w) => <li key={w.kind}>{warningText(w, q.currency)}</li>)}
            </ul>
          )}
        </section>
      )}

      <p className="text-xs text-text-muted">{FEE_DISCLAIMER}</p>
    </div>
  );
}
