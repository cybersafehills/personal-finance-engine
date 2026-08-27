"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { upsertParticipation } from "../../app/admin/directory/actions";
import { field, labelText, primaryButton } from "./field-styles";

const ROLES = ["bank", "emi", "both", "other"] as const;

type Existing = Record<string, unknown> & { id: string };

export function ParticipationForm({
  providers,
  networks,
  existing,
  lockTargets,
}: {
  providers: { id: string; display_name: string }[];
  networks: { id: string; canonical_name: string }[];
  existing?: Existing;
  /** When creating from an institution page, the provider is fixed. */
  lockTargets?: { providerId?: string; networkId?: string };
}) {
  const router = useRouter();
  const s = (k: string) => (existing?.[k] as string | null) ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providerId, setProviderId] = useState(
    s("provider_id") || lockTargets?.providerId || providers[0]?.id || "",
  );
  const [networkId, setNetworkId] = useState(
    s("payment_network_id") || lockTargets?.networkId || networks[0]?.id || "",
  );
  const [role, setRole] = useState(s("participant_role") || "bank");
  const [sourceUrl, setSourceUrl] = useState(s("official_source_url"));
  const [sourceLabel, setSourceLabel] = useState(s("official_source_label"));
  const [reviewDue, setReviewDue] = useState(s("review_due_at")?.slice(0, 10) ?? "");
  const [markVerified, setMarkVerified] = useState(false);
  const [minorEdit, setMinorEdit] = useState(false);
  const [changeReason, setChangeReason] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      id: existing?.id,
      provider_id: providerId,
      payment_network_id: networkId,
      participant_role: role,
      official_source_url: sourceUrl.trim(),
      official_source_label: sourceLabel.trim(),
      review_due_at: reviewDue ? new Date(reviewDue).toISOString() : "",
      change_reason: changeReason.trim(),
    };
    if (markVerified) payload.verified = true;
    if (existing && minorEdit) payload.minor_edit = true;

    const res = await upsertParticipation(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/directory/institutions/participation/${res.id ?? existing?.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={labelText}>Institution / provider</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className={field}
            disabled={Boolean(existing) || Boolean(lockTargets?.providerId)}
            required
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Payment network</span>
          <select
            value={networkId}
            onChange={(e) => setNetworkId(e.target.value)}
            className={field}
            disabled={Boolean(existing)}
            required
          >
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.canonical_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Participant role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Review due date</span>
          <input type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Official source URL</span>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Official source label</span>
          <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} className={field} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={markVerified} onChange={(e) => setMarkVerified(e.target.checked)} />
        Mark this participation verified against the source (stamps verified_at)
      </label>
      {existing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={minorEdit} onChange={(e) => setMinorEdit(e.target.checked)} />
          Minor edit — keep the current publication state
        </label>
      )}
      <label>
        <span className={labelText}>Change reason (recorded in history)</span>
        <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} className={field} />
      </label>

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}
      <div>
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
