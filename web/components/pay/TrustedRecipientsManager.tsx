"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../Badge";
import { messages } from "../../lib/ussd/messages";
import {
  createTrustedRecipient,
  deleteTrustedRecipient,
} from "../../app/pay/assisted-actions";

const t = messages().pay.assisted;
const field =
  "w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent";

type Recipient = {
  id: string;
  display_name: string;
  kind: string;
  normalized_msisdn: string | null;
  merchant_code: string | null;
  trust_status: "saved" | "trusted_by_user";
};

export function TrustedRecipientsManager({ initial }: { initial: Recipient[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState("phone");
  const [msisdn, setMsisdn] = useState("");
  const [merchantCode, setMerchantCode] = useState("");
  const [relationship, setRelationship] = useState("");
  const [trusted, setTrusted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createTrustedRecipient({
      displayName,
      kind,
      msisdn: kind === "phone" ? msisdn : undefined,
      merchantCode: kind === "merchant" ? merchantCode : undefined,
      relationship,
      trustStatus: trusted ? "trusted_by_user" : "saved",
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDisplayName("");
    setMsisdn("");
    setMerchantCode("");
    setRelationship("");
    setTrusted(false);
    setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    await deleteTrustedRecipient(id);
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
          {t.addRecipient}
        </button>
      ) : (
        <form onSubmit={submit} className="mb-5 flex flex-col gap-3 rounded-card border border-border-subtle p-4">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name"
            className={field}
            required
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            <option value="phone">Phone</option>
            <option value="merchant">Merchant</option>
            <option value="biller">Biller</option>
            <option value="meter">Meter</option>
            <option value="other">Other</option>
          </select>
          {kind === "phone" && (
            <input
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              placeholder="Phone number, e.g. 0781234567"
              className={field}
              type="tel"
            />
          )}
          {kind === "merchant" && (
            <input
              value={merchantCode}
              onChange={(e) => setMerchantCode(e.target.value)}
              placeholder="Merchant / MoMo Pay code"
              className={field}
            />
          )}
          <input
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="Relationship / purpose (optional)"
            className={field}
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
            Mark as “trusted by you”
          </label>
          <p className="text-xs text-text-muted">{t.trustNotProviderVerified}</p>
          {error && (
            <p className="text-xs text-attention" role="status">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul>
        {initial.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{r.display_name}</span>
                <Badge variant="neutral">
                  {r.trust_status === "trusted_by_user" ? t.trustBadgeTrusted : t.trustBadgeSaved}
                </Badge>
              </div>
              <p className="text-xs text-text-muted">
                {r.normalized_msisdn ?? r.merchant_code ?? r.kind}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(r.id)}
              className="text-xs font-medium text-attention hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
