"use client";

import Link from "next/link";
import { useState } from "react";
import { qrSvg } from "../../lib/qr";
import { buildShareMessage, parseAmountMinor } from "../../lib/payment-requests/owner";
import { createPaymentRequestAction } from "../../app/pay/requests/actions";

const field =
  "w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent";
const label = "flex flex-col gap-1 text-sm font-medium text-text-secondary";

const EXPIRIES = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 2160, label: "90 days" },
];

type Created = { id: string; url: string | null; message: string };

export function PaymentRequestForm({ defaultName }: { defaultName: string }) {
  // One key per mounted form: a double-click or retry creates ONE request.
  const [idem] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("RWF");
  const [destType, setDestType] = useState<"momo_phone" | "merchant_code">("momo_phone");
  const [dest, setDest] = useState("");
  const [name, setName] = useState(defaultName);
  const [reference, setReference] = useState("");
  const [hours, setHours] = useState(168);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createPaymentRequestAction({
      amountText: amount,
      currency,
      destinationType: destType,
      destinationValue: dest,
      recipientDisplay: name,
      reference,
      expiresInHours: hours,
      idempotencyKey: idem,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const minor = parseAmountMinor(amount, currency) ?? 0n;
    setCreated({
      id: res.id,
      url: res.url,
      message: res.url
        ? buildShareMessage({ amountMinor: minor, currency, recipientDisplay: name, url: res.url })
        : "",
    });
  }

  if (created) {
    const url = created.url;
    return (
      <div className="flex flex-col gap-4">
        {url ? (
          <>
            <p className="rounded-card border border-attention/30 bg-attention-bg p-4 text-sm text-attention">
              Your link is ready. <strong>This is the only time it is shown</strong> - copy
              or share it now. If you lose it, cancel the request and create a new one.
            </p>
            <div className="flex flex-col gap-3 rounded-card border border-border-subtle p-4">
              <input
                readOnly
                value={url}
                aria-label="Payment request link"
                className={field}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                {typeof navigator !== "undefined" && "share" in navigator ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-control border border-border-subtle px-4 py-2.5 text-sm font-semibold text-text-primary"
                    onClick={() => navigator.share({ text: created.message }).catch(() => {})}
                  >
                    Share
                  </button>
                ) : null}
              </div>
              <div
                className="mx-auto w-48 text-text-primary"
                role="img"
                aria-label="QR code for the payment request link"
                // qrSvg output is generated locally from our own URL (no user HTML).
                dangerouslySetInnerHTML={{ __html: qrSvg(url, { scale: 6 }) }}
              />
            </div>
          </>
        ) : (
          <p className="rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-secondary">
            This request was already created. For security its link can&apos;t be shown
            again - cancel it and create a new one if you need a fresh link.
          </p>
        )}
        <p className="text-xs text-text-muted">
          OneLedger doesn&apos;t collect or verify the payment. When you receive the money,
          open the request and link the incoming transaction (or mark it paid yourself).
        </p>
        <Link href={`/pay/requests/${created.id}`} className="text-sm font-medium text-accent hover:underline">
          View this request
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <label className={`${label} col-span-2`}>
          Amount
          <input
            className={field}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5,000"
            required
          />
        </label>
        <label className={label}>
          Currency
          <select className={field} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option>RWF</option>
            <option>USD</option>
            <option>EUR</option>
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text-secondary">Where should it be sent?</legend>
        <div className="flex gap-4 text-sm text-text-primary">
          <label className="flex items-center gap-2">
            <input type="radio" checked={destType === "momo_phone"} onChange={() => setDestType("momo_phone")} />
            Mobile Money number
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={destType === "merchant_code"} onChange={() => setDestType("merchant_code")} />
            Merchant code
          </label>
        </div>
        <input
          className={field}
          inputMode="tel"
          autoComplete="off"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder={destType === "momo_phone" ? "0788 123 456" : "093011"}
          aria-label={destType === "momo_phone" ? "Mobile Money number" : "Merchant code"}
          required
        />
      </fieldset>

      <label className={label}>
        Name shown to the payer
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </label>
      <label className={label}>
        Reference (optional)
        <input className={field} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} placeholder="e.g. Rent November" />
      </label>
      <label className={label}>
        Valid for
        <select className={field} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {EXPIRIES.map((x) => (
            <option key={x.hours} value={x.hours}>{x.label}</option>
          ))}
        </select>
      </label>

      <p className="text-xs text-text-muted">
        The payer will see the name and number above and a warning that OneLedger
        doesn&apos;t verify them or the payment. Double-check the number - money sent to a
        wrong number may not be recoverable.
      </p>

      {error ? (
        <p role="alert" className="rounded-card border border-attention/30 bg-attention-bg p-3 text-sm text-attention">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {busy ? "Creating..." : "Create request"}
      </button>
    </form>
  );
}
