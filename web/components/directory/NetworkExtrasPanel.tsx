"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  upsertNetworkOperator,
  upsertNetworkFee,
  upsertNetworkLimit,
} from "../../app/admin/directory/actions";
import { Badge } from "../Badge";
import { field, labelText, panel } from "./field-styles";

const OPERATOR_ROLES = ["system_operator", "processor", "switch", "other"] as const;
const FEE_TYPES = [
  "fixed",
  "percentage",
  "tiered",
  "none",
  "unknown",
  "varies_by_institution",
  "published_maximum",
] as const;

type Row = Record<string, unknown>;

export function NetworkExtrasPanel({
  networkId,
  operators,
  fees,
  limits,
  serviceOperators,
  canEdit,
}: {
  networkId: string;
  operators: Row[];
  fees: Row[];
  limits: Row[];
  serviceOperators: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // operator
  const [opId, setOpId] = useState(serviceOperators[0]?.id ?? "");
  const [opRole, setOpRole] = useState<(typeof OPERATOR_ROLES)[number]>("system_operator");
  // fee
  const [feeType, setFeeType] = useState<(typeof FEE_TYPES)[number]>("published_maximum");
  const [maxFee, setMaxFee] = useState("");
  const [feeNote, setFeeNote] = useState("");
  // limit
  const [maxTxn, setMaxTxn] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [limitNote, setLimitNote] = useState("");

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await p;
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={panel}>
        <span className="mb-2 block text-sm font-semibold text-text-primary">Operators (versioned)</span>
        {operators.length === 0 ? (
          <p className="text-xs text-text-muted">None recorded.</p>
        ) : (
          <ul className="mb-3 text-sm">
            {operators.map((o) => (
              <li key={o.id as string} className="flex items-center justify-between gap-2 border-b border-border-subtle py-1.5 last:border-b-0">
                <span>
                  {(o.service_operator as { name?: string })?.name ?? "?"}{" "}
                  <span className="text-xs text-text-muted">· {(o.operator_role as string).replace(/_/g, " ")}</span>
                </span>
                {o.is_current ? <Badge variant="positive">current</Badge> : <Badge variant="neutral">past</Badge>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && serviceOperators.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
            <label className="flex-1">
              <span className={labelText}>Operator</span>
              <select value={opId} onChange={(e) => setOpId(e.target.value)} className={field}>
                {serviceOperators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelText}>Role</span>
              <select value={opRole} onChange={(e) => setOpRole(e.target.value as typeof opRole)} className={field}>
                {OPERATOR_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  upsertNetworkOperator({
                    payment_network_id: networkId,
                    service_operator_id: opId,
                    operator_role: opRole,
                    is_current: true,
                  }),
                )
              }
              className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
            >
              Set as current
            </button>
          </div>
        )}
      </div>

      <div className={panel}>
        <span className="mb-2 block text-sm font-semibold text-text-primary">Network-level fee</span>
        {fees.length === 0 ? (
          <p className="text-xs text-text-muted">None recorded.</p>
        ) : (
          <ul className="mb-3 text-sm">
            {fees.map((f) => (
              <li key={f.id as string} className="border-b border-border-subtle py-1.5 last:border-b-0">
                <span className="font-medium">{(f.fee_type as string).replace(/_/g, " ")}</span>
                {f.max_fee_minor != null && (
                  <span className="ml-2 text-text-secondary">
                    max {String(f.max_fee_minor)} {String(f.currency)}
                  </span>
                )}
                {f.note_en ? <p className="text-xs text-text-muted">{String(f.note_en)}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
            <label>
              <span className={labelText}>Fee type</span>
              <select value={feeType} onChange={(e) => setFeeType(e.target.value as typeof feeType)} className={field}>
                {FEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelText}>Max fee (minor)</span>
              <input value={maxFee} onChange={(e) => setMaxFee(e.target.value)} className={field} inputMode="numeric" />
            </label>
            <label className="flex-1">
              <span className={labelText}>Note</span>
              <input value={feeNote} onChange={(e) => setFeeNote(e.target.value)} className={field} />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  upsertNetworkFee({
                    payment_network_id: networkId,
                    fee_type: feeType,
                    max_fee_minor: maxFee,
                    currency: "RWF",
                    note_en: feeNote.trim(),
                  }),
                )
              }
              className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
            >
              Add fee
            </button>
          </div>
        )}
      </div>

      <div className={panel}>
        <span className="mb-2 block text-sm font-semibold text-text-primary">Network-level limit</span>
        {limits.length === 0 ? (
          <p className="text-xs text-text-muted">None recorded.</p>
        ) : (
          <ul className="mb-3 text-sm">
            {limits.map((l) => (
              <li key={l.id as string} className="border-b border-border-subtle py-1.5 last:border-b-0">
                {l.max_txn_minor != null && (
                  <span className="text-text-secondary">
                    max txn {String(l.max_txn_minor)} {String(l.currency)}
                  </span>
                )}
                {l.is_published_maximum ? <Badge variant="neutral">published maximum</Badge> : null}
                {l.note_en ? <p className="text-xs text-text-muted">{String(l.note_en)}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
            <label>
              <span className={labelText}>Max txn (minor)</span>
              <input value={maxTxn} onChange={(e) => setMaxTxn(e.target.value)} className={field} inputMode="numeric" />
            </label>
            <label>
              <span className={labelText}>Daily limit (minor)</span>
              <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={field} inputMode="numeric" />
            </label>
            <label className="flex-1">
              <span className={labelText}>Note</span>
              <input value={limitNote} onChange={(e) => setLimitNote(e.target.value)} className={field} />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  upsertNetworkLimit({
                    payment_network_id: networkId,
                    max_txn_minor: maxTxn,
                    daily_limit_minor: dailyLimit,
                    currency: "RWF",
                    is_published_maximum: true,
                    note_en: limitNote.trim(),
                  }),
                )
              }
              className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
            >
              Add limit
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
