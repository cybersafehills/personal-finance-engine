import { assert, assertEquals } from "jsr:@std/assert@1";
import { scoreDuplicates, type Fingerprint } from "./detect.ts";

function fp(over: Partial<Fingerprint>): Fingerprint {
  return {
    billDocumentId: over.billDocumentId ?? crypto.randomUUID(),
    status: "needs_review",
    supplierName: null,
    invoiceNumber: null,
    receiptNumber: null,
    issueDate: null,
    currency: null,
    totalMinor: null,
    ...over,
  };
}

const SUBJECT = fp({
  billDocumentId: "s",
  supplierName: "Kigali Office Supplies Ltd",
  invoiceNumber: "INV-2026-0442",
  issueDate: "2026-08-12",
  currency: "RWF",
  totalMinor: "141600",
});

Deno.test("same invoice number + same supplier -> probable, high score", () => {
  const c = scoreDuplicates(SUBJECT, [fp({ billDocumentId: "p", supplierName: "Kigali Office Supplies, Ltd.", invoiceNumber: "inv-2026-0442" })]);
  assertEquals(c.length, 1);
  assertEquals(c[0].relation, "probable");
  assert(c[0].score >= 0.9);
  assert(c[0].signals.includes("document_number"));
  assert(c[0].signals.includes("supplier_name"));
});

Deno.test("same identity, no document number -> multi_file", () => {
  const c = scoreDuplicates(SUBJECT, [
    fp({ billDocumentId: "p", supplierName: "Kigali Office Supplies Ltd", issueDate: "2026-08-12", currency: "RWF", totalMinor: "141600" }),
  ]);
  assertEquals(c[0].relation, "multi_file");
  assert(c[0].score >= 0.85);
});

Deno.test("same supplier + amount + currency, different date within 45 days -> recurring", () => {
  const c = scoreDuplicates(SUBJECT, [
    fp({ billDocumentId: "p", supplierName: "Kigali Office Supplies Ltd", issueDate: "2026-07-12", currency: "RWF", totalMinor: "141600" }),
  ]);
  assertEquals(c[0].relation, "recurring");
});

Deno.test("same supplier + amount, date far apart -> similar (still surfaced)", () => {
  const c = scoreDuplicates(SUBJECT, [
    fp({ billDocumentId: "p", supplierName: "Kigali Office Supplies Ltd", issueDate: "2025-01-01", currency: "RWF", totalMinor: "141600" }),
  ]);
  assertEquals(c[0].relation, "similar");
  assert(c[0].score >= 0.5);
});

Deno.test("amount within tolerance still matches", () => {
  const c = scoreDuplicates(
    SUBJECT,
    [fp({ billDocumentId: "p", supplierName: "Kigali Office Supplies Ltd", issueDate: "2026-08-12", currency: "RWF", totalMinor: "141602" })],
    { amountToleranceMinor: 5n },
  );
  assertEquals(c[0].relation, "multi_file");
});

Deno.test("nothing in common -> no candidates", () => {
  const c = scoreDuplicates(SUBJECT, [
    fp({ billDocumentId: "p", supplierName: "Totally Different Vendor", invoiceNumber: "X-1", issueDate: "2020-01-01", currency: "USD", totalMinor: "5" }),
  ]);
  assertEquals(c, []);
});

Deno.test("the subject is never its own candidate", () => {
  const c = scoreDuplicates(SUBJECT, [SUBJECT]);
  assertEquals(c, []);
});

Deno.test("candidates are sorted by score and capped at 10", () => {
  const priors = Array.from({ length: 15 }, (_, i) =>
    fp({ billDocumentId: `p${i}`, supplierName: "Kigali Office Supplies Ltd", issueDate: "2026-08-12", currency: "RWF", totalMinor: "141600" }),
  );
  const c = scoreDuplicates(SUBJECT, priors);
  assertEquals(c.length, 10);
  for (let i = 1; i < c.length; i++) assert(c[i - 1].score >= c[i].score);
});
