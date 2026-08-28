"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctBillField, revalidateBillDocumentAction } from "../../app/bills/actions";
import type {
  BillExtractedFieldRow,
  BillExtractionRow,
  BillLineItemRow,
} from "../../lib/bills/queries";

// The Fields tab of the review workspace (Phase 7). Reviewers edit a
// field inline; the raw + model-normalised values are preserved and a
// "corrected" marker shows. Every correction bumps the document's
// review_revision and re-runs the checks - the page shows a "checks are
// out of date" prompt when a stale validation is detected.

const LABEL: Record<string, string> = {
  supplier_name: "Supplier",
  supplier_tax_id: "Tax ID",
  supplier_address: "Address",
  supplier_email: "Email",
  supplier_phone: "Phone",
  supplier_bank_details: "Bank details",
  invoice_number: "Invoice no.",
  receipt_number: "Receipt no.",
  credit_note_number: "Credit note no.",
  purchase_order_reference: "PO reference",
  payment_reference: "Payment reference",
  issue_date: "Issue date",
  receipt_date: "Receipt date",
  due_date: "Due date",
  payment_date: "Payment date",
  service_period_start: "Service from",
  service_period_end: "Service to",
  currency: "Currency",
  subtotal: "Subtotal",
  tax_amount: "Tax",
  tax_rate: "Tax rate",
  discount_amount: "Discount",
  additional_charges: "Charges",
  total: "Total",
  amount_paid: "Amount paid",
  outstanding_balance: "Balance due",
};

const RWF_LIKE = ["RWF", "UGX", "TZS", "JPY", "BIF", "XAF", "XOF"];

function displayOf(f: BillExtractedFieldRow): string {
  const v = f.user_corrected_value ?? f.normalized_value ?? f.raw_value ?? "";
  if (f.value_type === "money_minor" && /^-?\d+$/.test(v)) {
    const digits = f.currency && RWF_LIKE.includes(f.currency) ? 0 : 2;
    return `${f.currency ? f.currency + " " : ""}${(Number(v) / 10 ** digits).toLocaleString(
      undefined,
      { minimumFractionDigits: digits, maximumFractionDigits: digits },
    )}`;
  }
  if (f.field_key === "tax_rate" && v) return `${v}%`;
  return v || "—";
}

function editableOf(f: BillExtractedFieldRow): string {
  return f.user_corrected_value ?? f.normalized_value ?? f.raw_value ?? "";
}

function money(minor: number | null, currency: string | null): string {
  if (minor == null) return "—";
  const digits = currency && RWF_LIKE.includes(currency) ? 0 : 2;
  return `${currency ? currency + " " : ""}${(minor / 10 ** digits).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function BillFieldsEditor({
  documentId,
  extraction,
  fields,
  lineItems,
  canReview,
  validationStale,
}: {
  documentId: string;
  extraction: BillExtractionRow | null;
  fields: BillExtractedFieldRow[];
  lineItems: BillLineItemRow[];
  canReview: boolean;
  validationStale: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!extraction) {
    return <p className="text-sm text-text-muted">No extraction has run yet.</p>;
  }
  if (extraction.status === "failed") {
    return (
      <p className="text-sm text-attention" role="status">
        Extraction failed. An authorised reviewer can retry it.
      </p>
    );
  }

  function save(fieldKey: string) {
    setError(null);
    startTransition(async () => {
      const res = await correctBillField(documentId, fieldKey, draft);
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">
        Transcribed by {extraction.provider ?? "the extractor"}
        {extraction.model ? ` (${extraction.model})` : ""}. Extracted, not yet reviewed.
      </p>

      {validationStale && canReview && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-attention/40 bg-attention-bg p-3 text-sm">
          <span className="text-attention">
            The checks are out of date after your edits.
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await revalidateBillDocumentAction(documentId);
                router.refresh();
              })
            }
            className="min-h-11 rounded-control bg-accent px-3 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            Re-run checks
          </button>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-card border border-border-subtle bg-surface p-4 text-sm sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.id} className="flex flex-col gap-0.5">
            <dt className="text-text-muted">{LABEL[f.field_key] ?? f.field_key}</dt>
            <dd className="text-text-primary">
              {editing === f.field_key ? (
                <span className="flex items-center gap-2">
                  <input
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save(f.field_key);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="min-h-9 flex-1 rounded-control border border-border-strong bg-background px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => save(f.field_key)}
                    className="min-h-9 rounded-control bg-accent px-2 text-xs font-medium text-accent-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="min-h-9 px-1 text-xs text-text-muted"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-1">
                  {displayOf(f)}
                  {f.user_corrected_value != null && (
                    <span className="text-xs text-text-muted" title={`Was: ${f.normalized_value ?? f.raw_value ?? "—"}`}>
                      (corrected)
                    </span>
                  )}
                  {f.confidence != null && f.user_corrected_value == null && (
                    <span className="text-xs text-text-muted">
                      · {Math.round(f.confidence * 100)}% confidence
                    </span>
                  )}
                  {canReview && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(f.field_key);
                        setDraft(editableOf(f));
                      }}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {error && (
        <p role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}

      {lineItems.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">Extracted line items</caption>
            <thead>
              <tr className="border-b border-border-subtle text-left text-text-muted">
                <th scope="col" className="py-1 pr-3 font-medium">Description</th>
                <th scope="col" className="py-1 pr-3 font-medium">Qty</th>
                <th scope="col" className="py-1 pr-3 font-medium">Unit price</th>
                <th scope="col" className="py-1 font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id} className="border-b border-border-subtle/60">
                  <td className="py-1 pr-3 text-text-primary">{li.description ?? "—"}</td>
                  <td className="py-1 pr-3 text-text-secondary">{li.quantity ?? "—"}</td>
                  <td className="py-1 pr-3 text-text-secondary">
                    {money(li.unit_price_minor, li.currency)}
                  </td>
                  <td className="py-1 text-text-primary">
                    {money(li.line_total_minor, li.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
