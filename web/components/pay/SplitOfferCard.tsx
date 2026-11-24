"use client";

import { messages } from "../../lib/ussd/messages";
import type { SplitOffer } from "../../lib/pay/splits/offer";
import { fill, formatRwf } from "../../lib/pay/splits/format";

const t = messages().pay.splits;

/**
 * The suggestion shown under the amount. It only describes the offer the server
 * computed; the parts are never taken from here when the split is started.
 *
 * Wording rule: a capacity split says why (the amount is above the network's
 * limit for one transfer); a fee-saving split shows the verified source of the
 * fee table. Neither presents a split as a way around anything.
 */
export function SplitOfferCard({
  offer,
  pending,
  onAccept,
}: {
  offer: SplitOffer;
  pending: boolean;
  onAccept: () => void;
}) {
  const n = offer.parts.length;
  const isCapacity = offer.kind === "capacity";
  return (
    <section
      aria-label={isCapacity ? t.capacityTitle : t.savingTitle}
      className="flex flex-col gap-3 rounded-control border border-border-subtle bg-surface px-4 py-3"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t.brand}</p>
        <h2 className="text-sm font-semibold text-text-primary">
          {isCapacity ? t.capacityTitle : t.savingTitle}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {isCapacity
            ? fill(t.capacityBody, {
              capacity: formatRwf(offer.capacityMinor ?? "0"),
              total: formatRwf(offer.totalMinor),
              n,
            })
            : fill(t.savingBody, {
              total: formatRwf(offer.totalMinor),
              single: formatRwf(offer.singleFeeMinor ?? "0"),
              planned: formatRwf(offer.plannedFeeMinor ?? "0"),
              savings: formatRwf(offer.savingsMinor ?? "0"),
              n,
            })}
        </p>
      </div>

      <ol className="flex flex-col gap-1 text-sm text-text-primary">
        {offer.parts.map((p) => (
          <li key={p.index}>
            {fill(t.partRow, { i: p.index, amount: formatRwf(p.amountMinor) })}
            {p.feeMinor !== null && (
              <span className="text-text-muted">
                {isCapacity && offer.feeBasis !== "verified_tariff" ? " · up to " : " · fee "}
                {formatRwf(p.feeMinor)} RWF
              </span>
            )}
          </li>
        ))}
      </ol>

      {isCapacity && offer.plannedFeeMinor !== null && offer.parts[0]?.feeMinor && (
        <p className="text-xs text-text-secondary">
          {fill(offer.feeBasis === "verified_tariff" ? t.capacityFeeExact : t.capacityFee, {
            fee: formatRwf(offer.plannedFeeMinor),
            perPart: formatRwf(offer.parts[0].feeMinor),
          })}
        </p>
      )}
      {isCapacity && <p className="text-xs text-text-secondary">{t.limitsNote}</p>}

      {offer.source && (
        <p className="text-xs text-text-muted">
          {t.source}: {offer.source.url
            ? (
              <a
                href={offer.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {offer.source.label}
              </a>
            )
            : offer.source.label}
          {offer.source.asOf &&
            ` · ${fill(t.verifiedOn, { date: offer.source.asOf.slice(0, 10) })}`}
        </p>
      )}

      <p className="text-xs text-text-secondary">{t.howItWorks}</p>

      <button
        type="button"
        onClick={onAccept}
        disabled={pending}
        className="min-h-11 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {pending ? t.working : fill(t.accept, { n })}
      </button>
    </section>
  );
}
