"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { attachEvidence, detachEvidence } from "../../app/admin/directory/actions";
import { Badge } from "../Badge";
import { field, labelText, panel } from "./field-styles";
import type { EvidenceRow } from "../../lib/directory/admin-queries";

// Verification evidence for a directory subject. The uploaded file bytes
// live in the private `directory-evidence` bucket and are reachable only
// through /api/admin/directory/evidence/[id], which re-checks
// directory.view_evidence server-side. This panel just records the
// citation + metadata (directory.manage_evidence).

export function EvidencePanel({
  subjectType,
  subjectId,
  evidence,
  sources,
  canManage,
}: {
  subjectType:
    | "payment_network"
    | "network_operator"
    | "institution_participation"
    | "access_route"
    | "service_code";
  subjectId: string;
  evidence: EvidenceRow[];
  sources: { id: string; organization: string; title: string | null; classification: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [storagePath, setStoragePath] = useState("");
  const [note, setNote] = useState("");
  const [caveat, setCaveat] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [markVerified, setMarkVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId) {
      setError("Create a verification source first.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await attachEvidence({
      source_id: sourceId,
      subject_type: subjectType,
      subject_id: subjectId,
      storage_path: storagePath.trim(),
      internal_note: note.trim(),
      public_caveat_en: caveat.trim(),
      is_public: isPublic,
      verified: markVerified,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStoragePath("");
    setNote("");
    setCaveat("");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await detachEvidence(id, "removed from admin");
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={panel}>
      <span className="mb-2 block text-sm font-semibold text-text-primary">Verification evidence</span>

      {evidence.length === 0 ? (
        <p className="text-xs text-text-muted">No evidence attached.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {evidence.map((ev) => (
            <li key={ev.id} className="flex items-start justify-between gap-3 border-b border-border-subtle pb-2 last:border-b-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">
                  {ev.source?.organization ?? "Unknown source"}
                  {ev.source?.title ? ` — ${ev.source.title}` : ""}
                </p>
                <p className="text-xs text-text-muted">
                  {ev.source?.classification?.replace(/_/g, " ")}
                  {ev.verification_date
                    ? ` · verified ${new Date(ev.verification_date).toLocaleDateString()}`
                    : ""}
                </p>
                {ev.internal_note && (
                  <p className="mt-0.5 text-xs text-text-secondary">{ev.internal_note}</p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  {ev.is_public ? (
                    <Badge variant="neutral">Public</Badge>
                  ) : (
                    <Badge variant="attention">Private</Badge>
                  )}
                  {ev.storage_path && (
                    <a
                      href={`/api/admin/directory/evidence/${ev.id}`}
                      className="text-xs font-medium text-accent hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open file
                    </a>
                  )}
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(ev.id)}
                  disabled={busy}
                  className="shrink-0 text-xs font-medium text-attention disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={add} className="flex flex-col gap-2 border-t border-border-subtle pt-3">
          <label>
            <span className={labelText}>Source</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={field}>
              {sources.length === 0 && <option value="">No sources — create one first</option>}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.organization}
                  {s.title ? ` — ${s.title}` : ""} ({s.classification.replace(/_/g, " ")})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelText}>Storage path (in the directory-evidence bucket, optional)</span>
            <input value={storagePath} onChange={(e) => setStoragePath(e.target.value)} className={`${field} font-mono`} />
          </label>
          <label>
            <span className={labelText}>Internal note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </label>
          <label>
            <span className={labelText}>Public caveat (shown on the public page, optional)</span>
            <input value={caveat} onChange={(e) => setCaveat(e.target.value)} className={field} />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Approved for public display
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={markVerified} onChange={(e) => setMarkVerified(e.target.checked)} />
              Stamp verification date
            </label>
          </div>
          {error && (
            <p className="text-xs text-attention" role="status">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-fit rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Attach evidence
          </button>
        </form>
      )}
    </div>
  );
}
