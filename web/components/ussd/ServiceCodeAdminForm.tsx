"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminUpsertServiceCode } from "../../app/admin/ussd/actions";
import { CATEGORY_LABELS, DIRECTORY_CATEGORIES } from "../../lib/ussd/categories";
import type { ServiceCodeDetail } from "../../lib/ussd/queries";

const PARAM_KINDS = [
  "phone",
  "amount",
  "meter_number",
  "billing_id",
  "merchant_code",
  "account_reference",
  "national_id",
  "reference",
  "text",
] as const;

type ParamDraft = {
  key: string;
  label_en: string;
  kind: (typeof PARAM_KINDS)[number];
  required: boolean;
  format_regex: string;
  format_hint_en: string;
};

type StepDraft = { instruction_en: string };

const field =
  "w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent";
const labelText = "mb-1 block text-sm font-medium text-text-secondary";

export function ServiceCodeAdminForm({
  providers,
  existing,
}: {
  providers: { id: string; slug: string; display_name: string }[];
  existing?: ServiceCodeDetail;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providerId, setProviderId] = useState(existing?.provider.id ?? providers[0]?.id ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [category, setCategory] = useState<string>(existing?.category ?? "mobile_money");
  const [intent, setIntent] = useState(existing?.intent ?? "");
  const [nameEn, setNameEn] = useState(existing?.display_name_en ?? "");
  const [nameRw, setNameRw] = useState(existing?.display_name_rw ?? "");
  const [descEn, setDescEn] = useState(existing?.description_en ?? "");
  const [descRw, setDescRw] = useState(existing?.description_rw ?? "");
  const [template, setTemplate] = useState(existing?.ussd_template ?? "");
  const [networks, setNetworks] = useState<string[]>(existing?.supported_networks ?? []);
  const [sourceUrl, setSourceUrl] = useState(existing?.official_source_url ?? "");
  const [sourceLabel, setSourceLabel] = useState(existing?.official_source_label ?? "");
  const [reviewDue, setReviewDue] = useState(
    existing?.review_due_at ? existing.review_due_at.slice(0, 10) : "",
  );
  const [caution, setCaution] = useState(existing?.caution_text ?? "");
  const [risk, setRisk] = useState(existing?.risk_text ?? "");
  const [markVerified, setMarkVerified] = useState(false);
  const [changeReason, setChangeReason] = useState("");

  const [params, setParams] = useState<ParamDraft[]>(
    existing?.parameters.map((p) => ({
      key: p.key,
      label_en: p.label_en,
      kind: p.kind,
      required: p.required,
      format_regex: p.format_regex ?? "",
      format_hint_en: p.format_hint_en ?? "",
    })) ?? [],
  );
  const [steps, setSteps] = useState<StepDraft[]>(
    existing?.steps.map((s) => ({ instruction_en: s.instruction_en })) ?? [],
  );

  const acceptsParameters = template.includes("{");

  function toggleNetwork(n: string) {
    setNetworks((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      id: existing?.id,
      provider_id: providerId,
      slug: slug.trim(),
      category,
      intent: intent.trim(),
      display_name_en: nameEn.trim(),
      display_name_rw: nameRw.trim(),
      description_en: descEn.trim(),
      description_rw: descRw.trim(),
      ussd_template: template.trim(),
      accepts_parameters: acceptsParameters,
      supported_networks: networks,
      official_source_url: sourceUrl.trim(),
      official_source_label: sourceLabel.trim(),
      review_due_at: reviewDue ? new Date(reviewDue).toISOString() : "",
      caution_text: caution.trim(),
      risk_text: risk.trim(),
      change_reason: changeReason.trim(),
      parameters: params
        .filter((p) => p.key.trim() && p.label_en.trim())
        .map((p, i) => ({
          key: p.key.trim(),
          label_en: p.label_en.trim(),
          kind: p.kind,
          required: p.required,
          position: i,
          format_regex: p.format_regex.trim(),
          format_hint_en: p.format_hint_en.trim(),
        })),
      steps: steps
        .filter((s) => s.instruction_en.trim())
        .map((s, i) => ({ position: i, instruction_en: s.instruction_en.trim() })),
    };
    if (markVerified) payload.verified = true;

    const res = await adminUpsertServiceCode(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/ussd/${res.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={labelText}>Provider</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className={field}
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
          <span className={labelText}>Slug</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className={field} required />
        </label>
        <label>
          <span className={labelText}>Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={field}
          >
            {DIRECTORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Intent (optional)</span>
          <input value={intent} onChange={(e) => setIntent(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Display name (English)</span>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={field} required />
        </label>
        <label>
          <span className={labelText}>Display name (Kinyarwanda)</span>
          <input value={nameRw} onChange={(e) => setNameRw(e.target.value)} className={field} />
        </label>
      </div>

      <label>
        <span className={labelText}>Description (English)</span>
        <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={2} className={field} />
      </label>
      <label>
        <span className={labelText}>Description (Kinyarwanda)</span>
        <textarea value={descRw} onChange={(e) => setDescRw(e.target.value)} rows={2} className={field} />
      </label>

      <label>
        <span className={labelText}>USSD template</span>
        <input
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className={`${field} font-mono`}
          placeholder="*182*1*1*{phone}*{amount}#"
          required
        />
        <span className="mt-1 block text-xs text-text-muted">
          Use {"{key}"} placeholders that match a parameter below.
          {acceptsParameters ? " Parameterised." : " Literal code."}
        </span>
      </label>

      <fieldset className="flex gap-4">
        <legend className={labelText}>Supported networks</legend>
        {["mtn", "airtel"].map((n) => (
          <label key={n} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={networks.includes(n)}
              onChange={() => toggleNetwork(n)}
            />
            {n.toUpperCase()}
          </label>
        ))}
      </fieldset>

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
          <input
            type="date"
            value={reviewDue}
            onChange={(e) => setReviewDue(e.target.value)}
            className={field}
          />
        </label>
      </div>

      <label>
        <span className={labelText}>Caution text (optional)</span>
        <textarea value={caution} onChange={(e) => setCaution(e.target.value)} rows={2} className={field} />
      </label>
      <label>
        <span className={labelText}>Risk text (optional)</span>
        <textarea value={risk} onChange={(e) => setRisk(e.target.value)} rows={2} className={field} />
      </label>

      <ParamEditor params={params} setParams={setParams} />
      <StepEditor steps={steps} setSteps={setSteps} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={markVerified}
          onChange={(e) => setMarkVerified(e.target.checked)}
        />
        Mark verified against the official source (stamps verified_at)
      </label>

      <label>
        <span className={labelText}>Change reason (optional, recorded in history)</span>
        <input
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
          className={field}
        />
      </label>

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function ParamEditor({
  params,
  setParams,
}: {
  params: ParamDraft[];
  setParams: React.Dispatch<React.SetStateAction<ParamDraft[]>>;
}) {
  return (
    <div className="rounded-control border border-border-subtle p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">Parameters</span>
        <button
          type="button"
          onClick={() =>
            setParams((p) => [
              ...p,
              { key: "", label_en: "", kind: "text", required: true, format_regex: "", format_hint_en: "" },
            ])
          }
          className="text-sm font-medium text-accent"
        >
          Add
        </button>
      </div>
      {params.length === 0 && <p className="text-xs text-text-muted">None.</p>}
      <div className="flex flex-col gap-3">
        {params.map((p, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <input
              placeholder="key (e.g. phone)"
              value={p.key}
              onChange={(e) =>
                setParams((cur) => cur.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
              }
              className={field}
            />
            <input
              placeholder="Label (English)"
              value={p.label_en}
              onChange={(e) =>
                setParams((cur) =>
                  cur.map((x, j) => (j === i ? { ...x, label_en: e.target.value } : x)),
                )
              }
              className={field}
            />
            <select
              value={p.kind}
              onChange={(e) =>
                setParams((cur) =>
                  cur.map((x, j) =>
                    j === i ? { ...x, kind: e.target.value as ParamDraft["kind"] } : x,
                  ),
                )
              }
              className={field}
            >
              {PARAM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) =>
                  setParams((cur) =>
                    cur.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)),
                  )
                }
              />
              required
            </label>
            <input
              placeholder="format regex (optional)"
              value={p.format_regex}
              onChange={(e) =>
                setParams((cur) =>
                  cur.map((x, j) => (j === i ? { ...x, format_regex: e.target.value } : x)),
                )
              }
              className={`${field} font-mono`}
            />
            <input
              placeholder="format hint (English)"
              value={p.format_hint_en}
              onChange={(e) =>
                setParams((cur) =>
                  cur.map((x, j) => (j === i ? { ...x, format_hint_en: e.target.value } : x)),
                )
              }
              className={field}
            />
            <button
              type="button"
              onClick={() => setParams((cur) => cur.filter((_, j) => j !== i))}
              className="justify-self-start text-xs font-medium text-attention"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepEditor({
  steps,
  setSteps,
}: {
  steps: StepDraft[];
  setSteps: React.Dispatch<React.SetStateAction<StepDraft[]>>;
}) {
  return (
    <div className="rounded-control border border-border-subtle p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">Fallback steps</span>
        <button
          type="button"
          onClick={() => setSteps((s) => [...s, { instruction_en: "" }])}
          className="text-sm font-medium text-accent"
        >
          Add
        </button>
      </div>
      {steps.length === 0 && <p className="text-xs text-text-muted">None.</p>}
      <div className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-2">
            <span className="pt-2 text-sm text-text-muted">{i + 1}.</span>
            <input
              value={s.instruction_en}
              onChange={(e) =>
                setSteps((cur) =>
                  cur.map((x, j) => (j === i ? { instruction_en: e.target.value } : x)),
                )
              }
              className={field}
            />
            <button
              type="button"
              onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}
              className="text-xs font-medium text-attention"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
