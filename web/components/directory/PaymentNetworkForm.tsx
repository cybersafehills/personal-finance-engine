"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { upsertPaymentNetwork } from "../../app/admin/directory/actions";
import { field, labelText, panel, primaryButton } from "./field-styles";

const ENTITY_TYPES = [
  "interoperable_network",
  "card_scheme",
  "mobile_money_scheme",
  "other",
] as const;

type AliasDraft = { alias: string; is_primary: boolean };

type Existing = Record<string, unknown> & {
  id: string;
  aliases?: { alias: string; is_primary: boolean }[];
};

function triState(v: unknown): "unknown" | "yes" | "no" {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "unknown";
}

export function PaymentNetworkForm({
  authorities,
  existing,
}: {
  authorities: { id: string; name: string }[];
  existing?: Existing;
}) {
  const router = useRouter();
  const s = (k: string) => (existing?.[k] as string | null) ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState(s("slug"));
  const [canonicalName, setCanonicalName] = useState(s("canonical_name"));
  const [nameEn, setNameEn] = useState(s("display_name_en"));
  const [nameRw, setNameRw] = useState(s("display_name_rw"));
  const [descEn, setDescEn] = useState(s("description_en"));
  const [descRw, setDescRw] = useState(s("description_rw"));
  const [entityType, setEntityType] = useState(s("entity_type") || "interoperable_network");
  const [country, setCountry] = useState(s("country") || "RW");
  const [authorityId, setAuthorityId] = useState(s("regulatory_authority_id"));
  const [interopDate, setInteropDate] = useState(
    s("full_interoperability_effective_date")?.slice(0, 10) ?? "",
  );
  const [sepReg, setSepReg] = useState(triState(existing?.separate_registration_required));
  const [sepApp, setSepApp] = useState(triState(existing?.separate_app_required));
  const [channelsEn, setChannelsEn] = useState(s("access_channel_summary_en"));
  const [custodyEn, setCustodyEn] = useState(s("custody_note_en"));
  const [sourceUrl, setSourceUrl] = useState(s("official_source_url"));
  const [sourceLabel, setSourceLabel] = useState(s("official_source_label"));
  const [reviewDue, setReviewDue] = useState(s("review_due_at")?.slice(0, 10) ?? "");
  const [markVerified, setMarkVerified] = useState(false);
  const [minorEdit, setMinorEdit] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [aliases, setAliases] = useState<AliasDraft[]>(
    existing?.aliases?.map((a) => ({ alias: a.alias, is_primary: a.is_primary })) ?? [
      { alias: "", is_primary: true },
    ],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      id: existing?.id,
      slug: slug.trim(),
      canonical_name: canonicalName.trim(),
      display_name_en: nameEn.trim(),
      display_name_rw: nameRw.trim(),
      description_en: descEn.trim(),
      description_rw: descRw.trim(),
      entity_type: entityType,
      country: country.trim().toUpperCase(),
      regulatory_authority_id: authorityId || "",
      full_interoperability_effective_date: interopDate || "",
      access_channel_summary_en: channelsEn.trim(),
      custody_note_en: custodyEn.trim(),
      official_source_url: sourceUrl.trim(),
      official_source_label: sourceLabel.trim(),
      review_due_at: reviewDue ? new Date(reviewDue).toISOString() : "",
      change_reason: changeReason.trim(),
      aliases: aliases
        .filter((a) => a.alias.trim())
        .map((a) => ({ alias: a.alias.trim(), is_primary: a.is_primary })),
    };
    if (sepReg !== "unknown") payload.separate_registration_required = sepReg === "yes";
    if (sepApp !== "unknown") payload.separate_app_required = sepApp === "yes";
    if (markVerified) payload.verified = true;
    if (existing && minorEdit) payload.minor_edit = true;

    const res = await upsertPaymentNetwork(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/directory/networks/${res.id ?? existing?.id}`);
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
          <span className={labelText}>Canonical name</span>
          <input
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            className={field}
            required
          />
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
          <span className={labelText}>Entity type</span>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={field}>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Country</span>
          <input value={country} onChange={(e) => setCountry(e.target.value)} className={field} maxLength={2} />
        </label>
        <label>
          <span className={labelText}>Regulatory authority</span>
          <select value={authorityId} onChange={(e) => setAuthorityId(e.target.value)} className={field}>
            <option value="">— none —</option>
            {authorities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Full interoperability effective date</span>
          <input
            type="date"
            value={interopDate}
            onChange={(e) => setInteropDate(e.target.value)}
            className={field}
          />
        </label>
        <label>
          <span className={labelText}>Separate registration required?</span>
          <select value={sepReg} onChange={(e) => setSepReg(e.target.value as typeof sepReg)} className={field}>
            <option value="unknown">Unknown</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <label>
          <span className={labelText}>Separate app required?</span>
          <select value={sepApp} onChange={(e) => setSepApp(e.target.value as typeof sepApp)} className={field}>
            <option value="unknown">Unknown</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
      </div>

      <label>
        <span className={labelText}>Description (English)</span>
        <textarea value={descEn} onChange={(e) => setDescEn(e.target.value)} rows={3} className={field} />
      </label>
      <label>
        <span className={labelText}>Description (Kinyarwanda)</span>
        <textarea value={descRw} onChange={(e) => setDescRw(e.target.value)} rows={3} className={field} />
      </label>
      <label>
        <span className={labelText}>Access channel summary (English)</span>
        <textarea
          value={channelsEn}
          onChange={(e) => setChannelsEn(e.target.value)}
          rows={2}
          className={field}
          placeholder="Existing USSD, mobile-banking apps, Mobile Money apps, internet-banking services."
        />
      </label>
      <label>
        <span className={labelText}>Custody note (English)</span>
        <textarea
          value={custodyEn}
          onChange={(e) => setCustodyEn(e.target.value)}
          rows={2}
          className={field}
          placeholder="Customer funds remain in the customer's existing regulated bank account or mobile wallet."
        />
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

      <AliasEditor aliases={aliases} setAliases={setAliases} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={markVerified} onChange={(e) => setMarkVerified(e.target.checked)} />
        Mark verified against the official source (stamps verified_at)
      </label>
      {existing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={minorEdit} onChange={(e) => setMinorEdit(e.target.checked)} />
          Minor edit — keep the current publication state (otherwise a live record returns to review)
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

function AliasEditor({
  aliases,
  setAliases,
}: {
  aliases: AliasDraft[];
  setAliases: React.Dispatch<React.SetStateAction<AliasDraft[]>>;
}) {
  return (
    <div className={panel}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">Search aliases</span>
        <button
          type="button"
          onClick={() => setAliases((a) => [...a, { alias: "", is_primary: false }])}
          className="text-sm font-medium text-accent"
        >
          Add
        </button>
      </div>
      <p className="mb-2 text-xs text-text-muted">
        Alternate spellings (e.g. e-Kash, eCash). Normalised and de-duplicated on save.
      </p>
      <div className="flex flex-col gap-2">
        {aliases.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={a.alias}
              onChange={(e) =>
                setAliases((cur) => cur.map((x, j) => (j === i ? { ...x, alias: e.target.value } : x)))
              }
              className={field}
              placeholder="alias"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs">
              <input
                type="radio"
                name="primary-alias"
                checked={a.is_primary}
                onChange={() =>
                  setAliases((cur) => cur.map((x, j) => ({ ...x, is_primary: j === i })))
                }
              />
              primary
            </label>
            <button
              type="button"
              onClick={() => setAliases((cur) => cur.filter((_, j) => j !== i))}
              className="shrink-0 text-xs font-medium text-attention"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
