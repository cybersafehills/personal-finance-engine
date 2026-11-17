import { Badge } from "../Badge";
import type { BillDocumentStatus } from "../../lib/bills/queries";
import { billStatusDisplay } from "../../lib/bills/display";

// Label + variant per lifecycle state (lib/bills/display.ts, shared with the
// mobile API). The label is always shown, so the status is never communicated
// by colour alone (master prompt §20/§22).

export function BillStatusBadge({ status }: { status: BillDocumentStatus }) {
  const display = billStatusDisplay(status);
  return <Badge variant={display.tone}>{display.label}</Badge>;
}
