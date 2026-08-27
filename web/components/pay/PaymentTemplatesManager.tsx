"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { messages } from "../../lib/ussd/messages";
import { createTemplate, deleteTemplate } from "../../app/pay/assisted-actions";

const t = messages().pay.assisted;
const field =
  "w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent";

const TYPES = [
  ["pay_person", "Pay a person"],
  ["pay_merchant", "Pay a merchant"],
  ["pay_bill", "Pay a bill"],
  ["buy_electricity", "Buy electricity"],
  ["buy_airtime", "Buy airtime or data"],
  ["government", "Government services"],
] as const;

type Template = {
  id: string;
  name: string;
  payment_type: string;
  default_amount_minor: number | null;
  currency: string;
};

export function PaymentTemplatesManager({ initial }: { initial: Template[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [paymentType, setPaymentType] = useState<string>("pay_person");
  const [recipientName, setRecipientName] = useState("");
  const [recipientMsisdn, setRecipientMsisdn] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const amt = Number(amount.replace(/[,\s]/g, ""));
    const res = await createTemplate({
      name,
      paymentType,
      recipientName: recipientName || undefined,
      recipientMsisdn: recipientMsisdn || undefined,
      defaultAmountMinor: Number.isFinite(amt) && amt > 0 ? Math.round(amt) : undefined,
      note: note || undefined,
      category: category || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setRecipientName("");
    setRecipientMsisdn("");
    setAmount("");
    setNote("");
    setCategory("");
    setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    await deleteTemplate(id);
    router.refresh();
  }

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mb-4 min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
        >
          {t.addTemplate}
        </button>
      ) : (
        <form onSubmit={submit} className="mb-5 flex flex-col gap-3 rounded-card border border-border-subtle p-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" className={field} required />
          <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className={field}>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Recipient name (optional)" className={field} />
          <input value={recipientMsisdn} onChange={(e) => setRecipientMsisdn(e.target.value)} placeholder="Phone number (optional)" className={field} type="tel" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Default amount (optional)" className={field} inputMode="decimal" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={field} />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" className={field} />
          <p className="text-xs text-text-muted">Templates never store a PIN, OTP, or other secret.</p>
          {error && (
            <p className="text-xs text-attention" role="status">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background">
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul>
        {initial.map((tpl) => (
          <li key={tpl.id} className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0">
            <div>
              <span className="font-medium text-text-primary">{tpl.name}</span>
              <p className="text-xs text-text-muted">
                {TYPES.find(([v]) => v === tpl.payment_type)?.[1] ?? tpl.payment_type}
                {tpl.default_amount_minor
                  ? ` · ${tpl.currency === "RWF" ? tpl.default_amount_minor : tpl.default_amount_minor / 100} ${tpl.currency}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href={`/pay/new/${tpl.payment_type}`} className="text-xs font-medium text-accent hover:underline">
                Use
              </Link>
              <button type="button" onClick={() => remove(tpl.id)} className="text-xs font-medium text-attention hover:underline">
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
