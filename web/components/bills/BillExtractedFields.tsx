import type {
  BillExtractedFieldRow,
  BillExtractionRow,
  BillLineItemRow,
} from "../../lib/bills/queries";

// Read-only rendering of the current extraction (Phase 2). Editable
// correction lands with the Phase 7 review workspace; this just shows
// what the model transcribed, with an explicit confidence figure (never
// colour alone) and the raw value where it differs from the normalized
// one, so "extracted" is visibly not "verified" (master prompt §21).

const FIELD_LABEL: Record<string, string> = {
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

function formatMinor(minor: string | number | null, currency: string | null): string {
  if (minor == null) return "—";
  const n = typeof minor === "string" ? Number(minor) : minor;
  if (!Number.isFinite(n)) return "—";
  const digits = currency && ["RWF", "UGX", "TZS", "JPY", "BIF", "XAF", "XOF"].includes(currency) ? 0 : 2;
  const major = n / 10 ** digits;
  return `${currency ? currency + " " : ""}${major.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function displayValue(f: BillExtractedFieldRow): string {
  if (f.user_corrected_value != null) return f.user_corrected_value;
  if (f.value_type === "money_minor") {
    return f.normalized_value != null
      ? formatMinor(f.normalized_value, f.currency)
      : f.raw_value ?? "—";
  }
  if (f.value_type === "decimal" && f.field_key === "tax_rate") {
    return f.normalized_value != null ? `${f.normalized_value}%` : f.raw_value ?? "—";
  }
  return f.normalized_value ?? f.raw_value ?? "—";
}

function confidenceText(c: number | null): string {
  if (c == null) return "confidence unknown";
  return `${Math.round(c * 100)}% confidence`;
}

export function BillExtractedFields({
  extraction,
  fields,
  lineItems,
}: {
  extraction: BillExtractionRow | null;
  fields: BillExtractedFieldRow[];
  lineItems: BillLineItemRow[];
}) {
  if (!extraction) {
    return <p className="text-sm text-text-muted">No extraction has run yet.</p>;
  }

  if (extraction.status === "failed") {
    return (
      <p className="text-sm text-attention" role="status">
        Extraction failed
        {extraction.error && typeof extraction.error === "object" && "kind" in extraction.error
          ? ` (${String((extraction.error as { kind: unknown }).kind)})`
          : ""}
        . An authorised reviewer can retry it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">
        Transcribed by {extraction.provider ?? "the extractor"}
        {extraction.model ? ` (${extraction.model})` : ""} · ruleset{" "}
        {extraction.ruleset_version}. Extracted, not yet reviewed.
      </p>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-card border border-border-subtle bg-surface p-4 text-sm sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.id} className="flex flex-col">
            <dt className="text-text-muted">{FIELD_LABEL[f.field_key] ?? f.field_key}</dt>
            <dd className="text-text-primary">
              {displayValue(f)}
              {f.user_corrected_value != null && (
                <span className="ml-1 text-xs text-text-muted">(corrected)</span>
              )}
              <span className="ml-1 text-xs text-text-muted">· {confidenceText(f.confidence)}</span>
            </dd>
          </div>
        ))}
      </dl>

      {lineItems.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Extracted line items</caption>
            <thead>
              <tr className="border-b border-border-subtle text-left text-text-muted">
                <th scope="col" className="py-1 pr-3 font-medium">Description</th>
                <th scope="col" className="py-1 pr-3 font-medium">Qty</th>
                <th scope="col" className="py-1 pr-3 font-medium">Unit price</th>
                <th scope="col" className="py-1 pr-3 font-medium">Tax rate</th>
                <th scope="col" className="py-1 font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id} className="border-b border-border-subtle/60">
                  <td className="py-1 pr-3 text-text-primary">{li.description ?? "—"}</td>
                  <td className="py-1 pr-3 text-text-secondary">{li.quantity ?? "—"}</td>
                  <td className="py-1 pr-3 text-text-secondary">
                    {formatMinor(li.unit_price_minor, li.currency)}
                  </td>
                  <td className="py-1 pr-3 text-text-secondary">
                    {li.tax_rate != null ? `${li.tax_rate}%` : "—"}
                  </td>
                  <td className="py-1 text-text-primary">
                    {formatMinor(li.line_total_minor, li.currency)}
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
