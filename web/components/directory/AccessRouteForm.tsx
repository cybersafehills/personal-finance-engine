"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { upsertAccessRoute } from "../../app/admin/directory/actions";
import { field, labelText, panel, primaryButton } from "./field-styles";

const CHANNELS = ["ussd", "mobile_app", "internet_banking", "provider_website", "qr", "other"] as const;
const FLOW_TYPES = [
  "account_to_wallet",
  "wallet_to_account",
  "account_to_account",
  "wallet_to_wallet",
  "merchant_payment",
  "other",
] as const;
const FEE_TYPES = [
  "fixed",
  "percentage",
  "tiered",
  "none",
  "unknown",
  "varies_by_institution",
  "published_maximum",
] as const;

type StepDraft = {
  action_label_en: string;
  instruction_en: string;
  expected_menu_label_en: string;
  expected_option_number: string;
  parameter_key: string;
  caution_en: string;
};
type FeeDraft = {
  fee_type: (typeof FEE_TYPES)[number];
  fixed_fee_minor: string;
  percentage_bps: string;
  min_fee_minor: string;
  max_fee_minor: string;
  currency: string;
  note_en: string;
};
type LimitDraft = {
  min_txn_minor: string;
  max_txn_minor: string;
  daily_limit_minor: string;
  currency: string;
  note_en: string;
};

type Existing = Record<string, unknown> & {
  id: string;
  supported_flows?: { flow_type: string }[];
  menu_steps?: Record<string, unknown>[];
  fees?: Record<string, unknown>[];
  limits?: Record<string, unknown>[];
};

const str = (r: Record<string, unknown>, k: string) => (r[k] as string | null) ?? "";

export function AccessRouteForm({
  providers,
  networks,
  serviceCodes,
  routes,
  existing,
}: {
  providers: { id: string; display_name: string }[];
  networks: { id: string; canonical_name: string }[];
  serviceCodes: { id: string; slug: string; display_name_en: string }[];
  routes: { id: string; slug: string; display_name_en: string }[];
  existing?: Existing;
}) {
  const router = useRouter();
  const s = (k: string) => (existing?.[k] as string | null) ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState(s("slug"));
  const [providerId, setProviderId] = useState(s("provider_id") || providers[0]?.id || "");
  const [networkId, setNetworkId] = useState(s("payment_network_id"));
  const [channel, setChannel] = useState(s("channel") || "ussd");
  const [serviceCodeId, setServiceCodeId] = useState(s("service_code_id"));
  const [entryPoint, setEntryPoint] = useState(s("approved_entry_point_en"));
  const [internetRequired, setInternetRequired] = useState(
    existing?.internet_required === true,
  );
  const [deviceCompat, setDeviceCompat] = useState(
    Array.isArray(existing?.device_compat) ? (existing!.device_compat as string[]).join(", ") : "",
  );
  const [nameEn, setNameEn] = useState(s("display_name_en"));
  const [nameRw, setNameRw] = useState(s("display_name_rw"));
  const [descEn, setDescEn] = useState(s("description_en"));
  const [risk, setRisk] = useState(s("risk_text"));
  const [caution, setCaution] = useState(s("caution_text"));
  const [replacementId, setReplacementId] = useState(s("replacement_route_id"));
  const [sourceUrl, setSourceUrl] = useState(s("official_source_url"));
  const [sourceLabel, setSourceLabel] = useState(s("official_source_label"));
  const [reviewDue, setReviewDue] = useState(s("review_due_at")?.slice(0, 10) ?? "");
  const [markVerified, setMarkVerified] = useState(false);
  const [minorEdit, setMinorEdit] = useState(false);
  const [changeReason, setChangeReason] = useState("");

  const [flows, setFlows] = useState<string[]>(
    existing?.supported_flows?.map((f) => f.flow_type) ?? [],
  );
  const [steps, setSteps] = useState<StepDraft[]>(
    (existing?.menu_steps ?? []).map((m) => ({
      action_label_en: str(m, "action_label_en"),
      instruction_en: str(m, "instruction_en"),
      expected_menu_label_en: str(m, "expected_menu_label_en"),
      expected_option_number: str(m, "expected_option_number"),
      parameter_key: str(m, "parameter_key"),
      caution_en: str(m, "caution_en"),
    })),
  );
  const [fees, setFees] = useState<FeeDraft[]>(
    (existing?.fees ?? []).map((f) => ({
      fee_type: (str(f, "fee_type") || "unknown") as FeeDraft["fee_type"],
      fixed_fee_minor: f.fixed_fee_minor != null ? String(f.fixed_fee_minor) : "",
      percentage_bps: f.percentage_bps != null ? String(f.percentage_bps) : "",
      min_fee_minor: f.min_fee_minor != null ? String(f.min_fee_minor) : "",
      max_fee_minor: f.max_fee_minor != null ? String(f.max_fee_minor) : "",
      currency: str(f, "currency") || "RWF",
      note_en: str(f, "note_en"),
    })),
  );
  const [limits, setLimits] = useState<LimitDraft[]>(
    (existing?.limits ?? []).map((l) => ({
      min_txn_minor: l.min_txn_minor != null ? String(l.min_txn_minor) : "",
      max_txn_minor: l.max_txn_minor != null ? String(l.max_txn_minor) : "",
      daily_limit_minor: l.daily_limit_minor != null ? String(l.daily_limit_minor) : "",
      currency: str(l, "currency") || "RWF",
      note_en: str(l, "note_en"),
    })),
  );

  function toggleFlow(f: string) {
    setFlows((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      id: existing?.id,
      slug: slug.trim(),
      provider_id: providerId,
      payment_network_id: networkId || "",
      channel,
      service_code_id: serviceCodeId || "",
      approved_entry_point_en: entryPoint.trim(),
      internet_required: internetRequired,
      device_compat: deviceCompat
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      display_name_en: nameEn.trim(),
      display_name_rw: nameRw.trim(),
      description_en: descEn.trim(),
      risk_text: risk.trim(),
      caution_text: caution.trim(),
      replacement_route_id: replacementId || "",
      official_source_url: sourceUrl.trim(),
      official_source_label: sourceLabel.trim(),
      review_due_at: reviewDue ? new Date(reviewDue).toISOString() : "",
      change_reason: changeReason.trim(),
      supported_flows: flows.map((f) => ({ flow_type: f })),
      menu_steps: steps
        .filter((st) => st.instruction_en.trim())
        .map((st, i) => ({
          position: i,
          action_label_en: st.action_label_en.trim(),
          instruction_en: st.instruction_en.trim(),
          expected_menu_label_en: st.expected_menu_label_en.trim(),
          expected_option_number: st.expected_option_number.trim(),
          parameter_key: st.parameter_key.trim(),
          caution_en: st.caution_en.trim(),
        })),
      fees: fees.map((f) => ({
        fee_type: f.fee_type,
        fixed_fee_minor: f.fixed_fee_minor,
        percentage_bps: f.percentage_bps,
        min_fee_minor: f.min_fee_minor,
        max_fee_minor: f.max_fee_minor,
        currency: f.currency.trim().toUpperCase() || "RWF",
        note_en: f.note_en.trim(),
      })),
      limits: limits.map((l) => ({
        min_txn_minor: l.min_txn_minor,
        max_txn_minor: l.max_txn_minor,
        daily_limit_minor: l.daily_limit_minor,
        currency: l.currency.trim().toUpperCase() || "RWF",
        note_en: l.note_en.trim(),
      })),
    };
    if (markVerified) payload.verified = true;
    if (existing && minorEdit) payload.minor_edit = true;

    const res = await upsertAccessRoute(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/directory/routes/${res.id ?? existing?.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={labelText}>Slug</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className={field} required />
        </label>
        <label>
          <span className={labelText}>Institution / provider</span>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={field} required>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Payment network (optional)</span>
          <select value={networkId} onChange={(e) => setNetworkId(e.target.value)} className={field}>
            <option value="">— standalone (no network) —</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.canonical_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Channel</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={field}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Linked USSD code (optional)</span>
          <select value={serviceCodeId} onChange={(e) => setServiceCodeId(e.target.value)} className={field}>
            <option value="">— none —</option>
            {serviceCodes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name_en} ({c.slug})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Approved entry point (if no USSD code)</span>
          <input value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Display name (English)</span>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={field} required />
        </label>
        <label>
          <span className={labelText}>Display name (Kinyarwanda)</span>
          <input value={nameRw} onChange={(e) => setNameRw(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Device compatibility (comma-separated)</span>
          <input value={deviceCompat} onChange={(e) => setDeviceCompat(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Replacement route (optional)</span>
          <select value={replacementId} onChange={(e) => setReplacementId(e.target.value)} className={field}>
            <option value="">— none —</option>
            {routes
              .filter((r) => r.id !== existing?.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name_en} ({r.slug})
                </option>
              ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={internetRequired}
          onChange={(e) => setInternetRequired(e.target.checked)}
        />
        Internet connection required
      </label>

      <label>
        <span className={labelText}>Description (English)</span>
        <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} className={field} />
      </label>

      <fieldset className={panel}>
        <legend className="text-sm font-semibold text-text-primary">Supported transfer flows</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {FLOW_TYPES.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={flows.includes(f)} onChange={() => toggleFlow(f)} />
              {f.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </fieldset>

      <StepEditor steps={steps} setSteps={setSteps} />
      <FeeEditor fees={fees} setFees={setFees} />
      <LimitEditor limits={limits} setLimits={setLimits} />

      <label>
        <span className={labelText}>Caution text (optional)</span>
        <textarea value={caution} onChange={(e) => setCaution(e.target.value)} rows={2} className={field} />
      </label>
      <label>
        <span className={labelText}>Risk text (optional)</span>
        <textarea value={risk} onChange={(e) => setRisk(e.target.value)} rows={2} className={field} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={labelText}>Official source URL</span>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Official source label</span>
          <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Review due date</span>
          <input type="date" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} className={field} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={markVerified} onChange={(e) => setMarkVerified(e.target.checked)} />
        Mark verified against the official source (stamps verified_at)
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

function StepEditor({
  steps,
  setSteps,
}: {
  steps: StepDraft[];
  setSteps: React.Dispatch<React.SetStateAction<StepDraft[]>>;
}) {
  const empty: StepDraft = {
    action_label_en: "",
    instruction_en: "",
    expected_menu_label_en: "",
    expected_option_number: "",
    parameter_key: "",
    caution_en: "",
  };
  const set = (i: number, patch: Partial<StepDraft>) =>
    setSteps((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className={panel}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">Ordered menu steps</span>
        <button type="button" onClick={() => setSteps((s) => [...s, empty])} className="text-sm font-medium text-accent">
          Add step
        </button>
      </div>
      <p className="mb-2 text-xs text-text-muted">
        Never reference a PIN, OTP, or other secret in a step or its input key. The final step may
        say to authorise with the provider&apos;s own secure process.
      </p>
      {steps.length === 0 && <p className="text-xs text-text-muted">None.</p>}
      <div className="flex flex-col gap-3">
        {steps.map((st, i) => (
          <div key={i} className="grid gap-2 border-t border-border-subtle pt-2 first:border-t-0 first:pt-0 sm:grid-cols-2">
            <span className="text-sm font-medium text-text-muted sm:col-span-2">Step {i + 1}</span>
            <input placeholder="Action label (English)" value={st.action_label_en} onChange={(e) => set(i, { action_label_en: e.target.value })} className={field} />
            <input placeholder="Expected menu label (English)" value={st.expected_menu_label_en} onChange={(e) => set(i, { expected_menu_label_en: e.target.value })} className={field} />
            <input placeholder="Instruction (English)" value={st.instruction_en} onChange={(e) => set(i, { instruction_en: e.target.value })} className={`${field} sm:col-span-2`} />
            <input placeholder='Expected option number (e.g. "1", "1.2") — only if verified' value={st.expected_option_number} onChange={(e) => set(i, { expected_option_number: e.target.value })} className={field} />
            <input placeholder="Input key (non-secret, e.g. phone, amount)" value={st.parameter_key} onChange={(e) => set(i, { parameter_key: e.target.value })} className={`${field} font-mono`} />
            <input placeholder="Caution note (optional)" value={st.caution_en} onChange={(e) => set(i, { caution_en: e.target.value })} className={`${field} sm:col-span-2`} />
            <button type="button" onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))} className="justify-self-start text-xs font-medium text-attention">
              Remove step
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeeEditor({
  fees,
  setFees,
}: {
  fees: FeeDraft[];
  setFees: React.Dispatch<React.SetStateAction<FeeDraft[]>>;
}) {
  const empty: FeeDraft = {
    fee_type: "unknown",
    fixed_fee_minor: "",
    percentage_bps: "",
    min_fee_minor: "",
    max_fee_minor: "",
    currency: "RWF",
    note_en: "",
  };
  const set = (i: number, patch: Partial<FeeDraft>) =>
    setFees((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className={panel}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">Institution-level fees</span>
        <button type="button" onClick={() => setFees((f) => [...f, empty])} className="text-sm font-medium text-accent">
          Add fee
        </button>
      </div>
      <p className="mb-2 text-xs text-text-muted">
        Leave amounts blank when unknown. Use the fee type to say &quot;none&quot;, &quot;varies by
        institution&quot;, or &quot;published maximum&quot; rather than entering 0.
      </p>
      {fees.length === 0 && <p className="text-xs text-text-muted">None.</p>}
      <div className="flex flex-col gap-3">
        {fees.map((f, i) => (
          <div key={i} className="grid gap-2 border-t border-border-subtle pt-2 first:border-t-0 first:pt-0 sm:grid-cols-3">
            <select value={f.fee_type} onChange={(e) => set(i, { fee_type: e.target.value as FeeDraft["fee_type"] })} className={field}>
              {FEE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input placeholder="fixed fee (minor)" value={f.fixed_fee_minor} onChange={(e) => set(i, { fixed_fee_minor: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="percentage (bps)" value={f.percentage_bps} onChange={(e) => set(i, { percentage_bps: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="min fee (minor)" value={f.min_fee_minor} onChange={(e) => set(i, { min_fee_minor: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="max fee (minor)" value={f.max_fee_minor} onChange={(e) => set(i, { max_fee_minor: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="currency" value={f.currency} onChange={(e) => set(i, { currency: e.target.value })} className={field} maxLength={3} />
            <input placeholder="note (English)" value={f.note_en} onChange={(e) => set(i, { note_en: e.target.value })} className={`${field} sm:col-span-3`} />
            <button type="button" onClick={() => setFees((cur) => cur.filter((_, j) => j !== i))} className="justify-self-start text-xs font-medium text-attention">
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LimitEditor({
  limits,
  setLimits,
}: {
  limits: LimitDraft[];
  setLimits: React.Dispatch<React.SetStateAction<LimitDraft[]>>;
}) {
  const empty: LimitDraft = {
    min_txn_minor: "",
    max_txn_minor: "",
    daily_limit_minor: "",
    currency: "RWF",
    note_en: "",
  };
  const set = (i: number, patch: Partial<LimitDraft>) =>
    setLimits((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className={panel}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">Institution-level limits</span>
        <button type="button" onClick={() => setLimits((l) => [...l, empty])} className="text-sm font-medium text-accent">
          Add limit
        </button>
      </div>
      {limits.length === 0 && <p className="text-xs text-text-muted">None.</p>}
      <div className="flex flex-col gap-3">
        {limits.map((l, i) => (
          <div key={i} className="grid gap-2 border-t border-border-subtle pt-2 first:border-t-0 first:pt-0 sm:grid-cols-3">
            <input placeholder="min txn (minor)" value={l.min_txn_minor} onChange={(e) => set(i, { min_txn_minor: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="max txn (minor)" value={l.max_txn_minor} onChange={(e) => set(i, { max_txn_minor: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="daily limit (minor)" value={l.daily_limit_minor} onChange={(e) => set(i, { daily_limit_minor: e.target.value })} className={field} inputMode="numeric" />
            <input placeholder="currency" value={l.currency} onChange={(e) => set(i, { currency: e.target.value })} className={field} maxLength={3} />
            <input placeholder="note (English)" value={l.note_en} onChange={(e) => set(i, { note_en: e.target.value })} className={`${field} sm:col-span-2`} />
            <button type="button" onClick={() => setLimits((cur) => cur.filter((_, j) => j !== i))} className="justify-self-start text-xs font-medium text-attention">
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
