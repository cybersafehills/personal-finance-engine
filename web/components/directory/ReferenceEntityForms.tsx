"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  upsertRegulatoryAuthority,
  upsertServiceOperator,
  upsertDirectorySource,
  type ActionResult,
} from "../../app/admin/directory/actions";
import { field, labelText, panel } from "./field-styles";

const SOURCE_CLASSIFICATIONS = [
  "official_regulator",
  "official_system_operator",
  "official_financial_institution",
  "official_telecom_emoney",
  "approved_internal_verification",
  "community_suggestion_unverified",
] as const;

export function ReferenceEntityForms({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) {
    return (
      <p className="text-sm text-text-muted">
        `directory.create` is required to add authorities, operators, or sources.
      </p>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <MiniForm
        title="New regulatory authority"
        fields={[
          { key: "slug", label: "Slug", required: true },
          { key: "name", label: "Name", required: true },
          { key: "country", label: "Country", value: "RW" },
          { key: "website_url", label: "Website URL" },
        ]}
        submit={(v) => upsertRegulatoryAuthority(v)}
      />
      <MiniForm
        title="New system operator"
        fields={[
          { key: "slug", label: "Slug", required: true },
          { key: "name", label: "Name", required: true },
          { key: "country", label: "Country", value: "RW" },
          { key: "website_url", label: "Website URL" },
        ]}
        submit={(v) => upsertServiceOperator(v)}
      />
      <MiniForm
        title="New verification source"
        fields={[
          { key: "organization", label: "Organization", required: true },
          { key: "title", label: "Title" },
          { key: "classification", label: "Classification", select: [...SOURCE_CLASSIFICATIONS] },
          { key: "source_url", label: "Source URL" },
          { key: "publication_date", label: "Publication date", type: "date" },
          { key: "is_public", label: "Approved for public display", checkbox: true },
        ]}
        submit={(v) => upsertDirectorySource(v)}
      />
    </div>
  );
}

type FieldSpec = {
  key: string;
  label: string;
  required?: boolean;
  value?: string;
  type?: string;
  select?: string[];
  checkbox?: boolean;
};

function MiniForm({
  title,
  fields,
  submit,
}: {
  title: string;
  fields: FieldSpec[];
  submit: (v: Record<string, unknown>) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const initial: Record<string, string | boolean> = {};
  for (const f of fields) initial[f.key] = f.checkbox ? false : (f.value ?? "");
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state)) {
      payload[k] = typeof v === "string" ? v.trim() : v;
    }
    const res = await submit(payload);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: "Saved." });
    setState(initial);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={`${panel} flex flex-col gap-2`}>
      <span className="text-sm font-semibold text-text-primary">{title}</span>
      {fields.map((f) => (
        <label key={f.key} className={f.checkbox ? "flex items-center gap-2 text-sm" : undefined}>
          {f.checkbox ? (
            <>
              <input
                type="checkbox"
                checked={Boolean(state[f.key])}
                onChange={(e) => setState((s) => ({ ...s, [f.key]: e.target.checked }))}
              />
              {f.label}
            </>
          ) : (
            <>
              <span className={labelText}>{f.label}</span>
              {f.select ? (
                <select
                  value={String(state[f.key] ?? "")}
                  onChange={(e) => setState((s) => ({ ...s, [f.key]: e.target.value }))}
                  className={field}
                >
                  <option value="">— select —</option>
                  {f.select.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={String(state[f.key] ?? "")}
                  onChange={(e) => setState((s) => ({ ...s, [f.key]: e.target.value }))}
                  className={field}
                  required={f.required}
                />
              )}
            </>
          )}
        </label>
      ))}
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-money-positive" : "text-attention"}`} role="status">
          {msg.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 w-fit rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
