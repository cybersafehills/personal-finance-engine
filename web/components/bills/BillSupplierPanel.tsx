"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSupplierForBill,
  linkBillSupplier,
  searchSuppliersAction,
} from "../../app/bills/actions";
import type {
  BillSupplierCandidateRow,
  BillSupplierLink,
  SupplierSearchRow,
} from "../../lib/bills/queries";

// Supplier resolution for one document (Phase 5). A reviewer confirms an
// existing supplier (from ranked candidates or a search) or, with
// bill.manage, creates a new one. Nothing is linked automatically.

export function BillSupplierPanel({
  documentId,
  linked,
  candidates,
  canReview,
  canManage,
  extractedName,
  extractedTaxId,
}: {
  documentId: string;
  linked: BillSupplierLink;
  candidates: BillSupplierCandidateRow[];
  canReview: boolean;
  canManage: boolean;
  extractedName: string | null;
  extractedTaxId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState(extractedName ?? "");
  const [results, setResults] = useState<SupplierSearchRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    displayName: extractedName ?? "",
    taxId: extractedTaxId ?? "",
    email: "",
    phone: "",
  });

  function link(supplierId: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await linkBillSupplier(documentId, supplierId);
      if (res.ok) {
        setChanging(false);
        setCreating(false);
        router.refresh();
      } else setError(res.error);
    });
  }

  function runSearch() {
    setError(null);
    startTransition(async () => {
      const res = await searchSuppliersAction(query);
      if (res.ok) setResults(res.rows);
      else setError(res.error);
    });
  }

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createSupplierForBill(documentId, form);
      if (res.ok) {
        setCreating(false);
        setChanging(false);
        router.refresh();
      } else setError(res.error);
    });
  }

  if (linked && !changing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-text-primary">
          Linked to <span className="font-medium">{linked.displayName}</span>
        </span>
        {canReview && (
          <>
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="min-h-11 rounded-control px-2 text-sm font-medium text-accent hover:underline"
            >
              Change
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => link(null)}
              className="min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
            >
              Unlink
            </button>
          </>
        )}
      </div>
    );
  }

  if (!canReview) {
    return (
      <p className="text-sm text-text-muted">
        {linked
          ? `Linked to ${linked.displayName}.`
          : "No supplier linked. You don't have permission to change it."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {candidates.length > 0 && !creating && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">Suggested matches</p>
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-3"
              >
                <span className="text-sm text-text-primary">
                  {c.displayName}
                  {c.taxId ? ` · ${c.taxId}` : ""}
                  <span className="ml-1 text-xs text-text-muted">
                    {Math.round(c.score * 100)}% · {c.match_reasons.join(", ") || "name"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => link(c.supplier_id)}
                  className="min-h-11 rounded-control bg-accent px-3 text-sm font-medium text-accent-foreground disabled:opacity-50"
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!creating && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-secondary">Search suppliers</span>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-11 flex-1 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
                placeholder="Supplier name"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={runSearch}
                className="min-h-11 rounded-control border border-border-strong px-3 text-sm font-medium text-text-primary disabled:opacity-50"
              >
                Search
              </button>
            </div>
          </label>
          {results.length > 0 && (
            <ul className="flex flex-col gap-1">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-text-primary">
                    {r.displayName}
                    {r.taxId ? ` · ${r.taxId}` : ""}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => link(r.id)}
                    className="min-h-11 rounded-control px-2 text-sm font-medium text-accent hover:underline"
                  >
                    Link
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canManage && !creating && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-11 w-fit rounded-control border border-border-strong px-3 text-sm font-medium text-text-primary"
        >
          Create new supplier
        </button>
      )}

      {creating && (
        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3">
          {(["displayName", "taxId", "email", "phone"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text-secondary">
                {k === "displayName" ? "Name" : k === "taxId" ? "Tax ID" : k[0].toUpperCase() + k.slice(1)}
              </span>
              <input
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
              />
            </label>
          ))}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={isPending}
              onClick={create}
              className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create & link"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="min-h-11 rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {changing && linked && (
        <button
          type="button"
          onClick={() => setChanging(false)}
          className="min-h-11 w-fit rounded-control px-2 text-sm font-medium text-text-muted hover:text-text-primary"
        >
          Keep {linked.displayName}
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
    </div>
  );
}
