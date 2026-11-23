"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDraftIntent } from "../../app/pay/assisted-actions";
import { getSplitOfferAction, startSplitAction } from "../../app/pay/splits/actions";
import { SplitOfferCard } from "./SplitOfferCard";
import type { SplitOffer } from "../../lib/pay/splits/offer";
import { fill, formatRwf } from "../../lib/pay/splits/format";
import { messages } from "../../lib/ussd/messages";
import {
  guessProvider,
  normalizeRwandaMsisdn,
  providerNetworkForAccount,
} from "../../lib/pay/phone";

const t = messages().pay.assisted;
const ts = messages().pay.splits;

type PaymentType =
  | "pay_person"
  | "pay_merchant"
  | "pay_bill"
  | "buy_electricity"
  | "buy_airtime"
  | "government";

type Account = { id: string; name: string; provider: string; currency: string };
type Budget = { id: string; name: string; status: string };
type TrustedRecipient = {
  id: string;
  display_name: string;
  kind: string;
  normalized_msisdn: string | null;
  merchant_code: string | null;
  trust_status: string;
};
type RecentRecipient = { name: string; msisdn_masked: string | null; kind: string | null };

const field =
  "w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent";
const labelText = "mb-1 block text-sm font-medium text-text-secondary";

const NEEDS_MSISDN: PaymentType[] = ["pay_person", "buy_airtime"];
const NEEDS_MERCHANT: PaymentType[] = ["pay_merchant"];
const NEEDS_METER: PaymentType[] = ["buy_electricity"];
const NEEDS_BILL_REF: PaymentType[] = ["pay_bill"];
const NEEDS_GOV_REF: PaymentType[] = ["government"];

export function PaymentDraftForm({
  type,
  accounts,
  budgets,
  trustedRecipients,
  recentRecipients,
  defaults,
  splitsEnabled = false,
  ekashCapacityMinor = null,
}: {
  type: PaymentType;
  /** PAY_SPLITS_ENABLED for this workspace. Off: the form is exactly as before. */
  splitsEnabled?: boolean;
  /** eKash per-transaction capacity (minor units, digits) for the hint, when known. */
  ekashCapacityMinor?: string | null;
  accounts: Account[];
  budgets: Budget[];
  trustedRecipients: TrustedRecipient[];
  recentRecipients: RecentRecipient[];
  defaults: {
    accountId?: string;
    budgetId?: string;
    recipientId?: string;
    recipientName?: string;
    msisdn?: string;
    merchantCode?: string;
    billingReference?: string;
  };
}) {
  const router = useRouter();
  // One key per mounted form, so a double-submit dedupes into a single
  // intent (the Phase N RPC is idempotent on it). Used only in the
  // submit handler, never rendered - no hydration concern.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(defaults.accountId ?? accounts[0]?.id ?? "");
  const [recipientId, setRecipientId] = useState(defaults.recipientId ?? "");
  const [recipientName, setRecipientName] = useState(defaults.recipientName ?? "");
  const [msisdn, setMsisdn] = useState(defaults.msisdn ?? "");
  const [merchantCode, setMerchantCode] = useState(defaults.merchantCode ?? "");
  const [meterNumber, setMeterNumber] = useState("");
  const [billingReference, setBillingReference] = useState(defaults.billingReference ?? "");
  const [governmentReference, setGovernmentReference] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [budgetId, setBudgetId] = useState(defaults.budgetId ?? "");
  // Splits: whether the user chose to pay over eKash, and the server's offer.
  const [overEkash, setOverEkash] = useState(false);
  const [offerFor, setOfferFor] = useState<{ key: string; offer: SplitOffer | null } | null>(null);
  const [splitPending, setSplitPending] = useState(false);
  const splitCapable = splitsEnabled && (type === "pay_person" || type === "pay_merchant");

  const selectedRecipient = trustedRecipients.find((r) => r.id === recipientId);
  const effectiveMsisdn = selectedRecipient?.normalized_msisdn ?? msisdn;
  const norm = normalizeRwandaMsisdn(effectiveMsisdn);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? "RWF";

  // Recipient's network drives a send-money code; for a merchant / bill /
  // meter payment there's no recipient number, so fall back to the
  // paying account's own network (that's the SIM the USSD is dialled on).
  const providerGuess =
    guessProvider(norm.normalized) ?? providerNetworkForAccount(account?.provider);

  function parsedAmountMinor(): number | null {
    const amountNumber = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return null;
    // RWF is a zero-decimal currency in this app (lib/money.ts).
    return currency === "RWF" ? Math.round(amountNumber) : Math.round(amountNumber * 100);
  }

  // Ask the server whether this amount should be offered as parts. Debounced; an
  // answer is shown only while it still matches what is on screen. The server
  // decides; nothing is computed here.
  const offerMinor = splitCapable && currency === "RWF" ? parsedAmountMinor() : null;
  const offerKey = offerMinor !== null && Number.isSafeInteger(offerMinor)
    ? JSON.stringify([type, overEkash, accountId, effectiveMsisdn, offerMinor])
    : null;
  const offer = offerKey !== null && offerFor?.key === offerKey ? offerFor.offer : null;

  useEffect(() => {
    if (offerKey === null || offerMinor === null) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await getSplitOfferAction({
        paymentType: type,
        networkSlug: overEkash ? "ekash" : null,
        sourceAccountId: accountId || undefined,
        recipientMsisdn: NEEDS_MSISDN.includes(type) ? effectiveMsisdn.trim() || undefined : undefined,
        amountMinor: offerMinor,
      });
      if (!cancelled) setOfferFor({ key: offerKey, offer: res.ok ? res.offer : null });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey]);

  function buildDraft(amountMinor: number) {
    return {
      paymentType: type,
      sourceAccountId: accountId || undefined,
      provider: providerGuess ?? undefined,
      amountMinor,
      recipientName:
        selectedRecipient?.display_name || recipientName.trim() || undefined,
      recipientMsisdn: NEEDS_MSISDN.includes(type)
        ? selectedRecipient?.normalized_msisdn ?? (msisdn.trim() || undefined)
        : undefined,
      merchantCode: NEEDS_MERCHANT.includes(type)
        ? selectedRecipient?.merchant_code ?? (merchantCode.trim() || undefined)
        : undefined,
      meterNumber: NEEDS_METER.includes(type) ? meterNumber.trim() || undefined : undefined,
      billingReference: NEEDS_BILL_REF.includes(type)
        ? billingReference.trim() || undefined
        : undefined,
      governmentReference: NEEDS_GOV_REF.includes(type)
        ? governmentReference.trim() || undefined
        : undefined,
      note: note.trim() || undefined,
      category: category.trim() || undefined,
      budgetId: budgetId || undefined,
      trustedRecipientId: recipientId || undefined,
      idempotencyKey,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    const amountMinor = parsedAmountMinor();
    if (amountMinor === null) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setPending(true);
    const res = await createDraftIntent(buildDraft(amountMinor));
    setPending(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/pay/${res.id}`);
    router.refresh();
  }

  // Take the split the server offered. The server recomputes the parts from the
  // amount, so what is stored is never what the browser displayed.
  async function onStartSplit() {
    if (splitPending || pending) return;
    setError(null);
    const amountMinor = parsedAmountMinor();
    if (amountMinor === null) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setSplitPending(true);
    const res = await startSplitAction({
      ...buildDraft(amountMinor),
      networkSlug: overEkash ? "ekash" : null,
    });
    setSplitPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/pay/${res.intentId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {accounts.length > 0 && (
        <label>
          <span className={labelText}>{t.sourceAccount}</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>
      )}

      {(NEEDS_MSISDN.includes(type) || NEEDS_MERCHANT.includes(type)) && (
        <fieldset className="flex flex-col gap-2">
          <legend className={labelText}>{t.recipient}</legend>
          {trustedRecipients.length > 0 && (
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className={field}
              aria-label={t.recipient}
            >
              <option value="">Someone else…</option>
              {trustedRecipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name}
                  {r.trust_status === "trusted_by_user" ? " (trusted by you)" : ""}
                </option>
              ))}
            </select>
          )}
          {!recipientId && (
            <>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Name (optional)"
                className={field}
              />
              {NEEDS_MSISDN.includes(type) && (
                <input
                  type="tel"
                  inputMode="tel"
                  value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)}
                  placeholder="Phone number, e.g. 0781234567"
                  className={field}
                />
              )}
              {NEEDS_MERCHANT.includes(type) && (
                <input
                  type="text"
                  inputMode="numeric"
                  value={merchantCode}
                  onChange={(e) => setMerchantCode(e.target.value)}
                  placeholder="Merchant / MoMo Pay code"
                  className={field}
                />
              )}
            </>
          )}
          {NEEDS_MSISDN.includes(type) && norm.normalized && (
            <p className="text-xs text-text-muted">
              Reads as {norm.normalized}
              {providerGuess ? ` · looks like ${providerGuess.toUpperCase()}` : ""}
            </p>
          )}
          {recentRecipients.length > 0 && !recipientId && (
            <div className="flex flex-wrap gap-1.5">
              {recentRecipients.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setRecipientName(r.name)}
                  className="rounded-full border border-border-subtle px-2.5 py-1 text-xs text-text-secondary hover:bg-background"
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {splitCapable && (
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={overEkash}
            onChange={(e) => setOverEkash(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-text-primary">{ts.ekashChoice}</span>
            <span className="block text-xs">
              {fill(ts.ekashHint, { capacity: formatRwf(ekashCapacityMinor ?? "10000000") })}
            </span>
          </span>
        </label>
      )}

      {NEEDS_METER.includes(type) && (
        <label>
          <span className={labelText}>Meter number</span>
          <input
            type="text"
            inputMode="numeric"
            value={meterNumber}
            onChange={(e) => setMeterNumber(e.target.value)}
            className={field}
          />
        </label>
      )}
      {NEEDS_BILL_REF.includes(type) && (
        <label>
          <span className={labelText}>Biller / account reference</span>
          <input
            type="text"
            value={billingReference}
            onChange={(e) => setBillingReference(e.target.value)}
            className={field}
          />
        </label>
      )}
      {NEEDS_GOV_REF.includes(type) && (
        <label>
          <span className={labelText}>Service reference</span>
          <input
            type="text"
            value={governmentReference}
            onChange={(e) => setGovernmentReference(e.target.value)}
            className={field}
          />
        </label>
      )}

      <label>
        <span className={labelText}>
          {t.amount} ({currency})
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className={field}
          required
        />
      </label>

      <label>
        <span className={labelText}>{t.noteLabel}</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={labelText}>{t.categoryLabel}</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={field}
          />
        </label>
        {budgets.length > 0 && (
          <label>
            <span className={labelText}>{t.budgetLabel}</span>
            <select value={budgetId} onChange={(e) => setBudgetId(e.target.value)} className={field}>
              <option value="">None</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {splitCapable && offer && (
        <SplitOfferCard offer={offer} pending={splitPending} onAccept={onStartSplit} />
      )}
      {splitCapable && (
        <p className="text-xs text-text-muted">
          <Link href="/pay/splits" className="underline">
            {messages().pay.splits.settings.title}
          </Link>
        </p>
      )}

      <div className="rounded-control bg-background px-3 py-2.5 text-xs text-text-secondary">
        {t.handoffNotice}
      </div>

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {pending ? "Preparing…" : t.prepare}
      </button>
    </form>
  );
}
