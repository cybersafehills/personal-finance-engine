import { assert, assertEquals } from "jsr:@std/assert@1";
import { redactBillErrorText, sanitizeBillEventProps } from "./analytics.ts";

Deno.test("sanitizeBillEventProps: drops keys that could carry document data", () => {
  const out = sanitizeBillEventProps({
    filename: "Acme Invoice 4471.pdf",
    supplier: "Acme Ltd",
    amount: 125000,
    invoice_number: "INV-4471",
    tax: 18,
    reason: "too_large",
    to: "needs_review",
    mime: "application/pdf",
    count: 3,
    ok: true,
  });
  assertEquals(out, { reason: "too_large", to: "needs_review", mime: "application/pdf", count: 3, ok: true });
});

Deno.test("sanitizeBillEventProps: drops string values that look like identifiers", () => {
  const out = sanitizeBillEventProps({
    note: "2507 8812 3456",
    link: "https://example.com/x",
    kind: "receipt",
  });
  assertEquals(out, { kind: "receipt" });
});

Deno.test("sanitizeBillEventProps: caps long strings and handles undefined", () => {
  assertEquals(sanitizeBillEventProps(undefined), {});
  const out = sanitizeBillEventProps({ kind: "x".repeat(200) });
  assert((out.kind as string).length <= 64);
});

Deno.test("redactBillErrorText: strips digit runs, URLs and hashes; caps length", () => {
  const text = redactBillErrorText(
    new Error(
      "failed for key 11111111-1111-1111-1111-111111111111/" +
        "a".repeat(64) +
        ".pdf at https://storage.example/obj 123456789",
    ),
  );
  assert(!text.includes("a".repeat(64)));
  assert(!/https?:\/\//.test(text));
  assert(!/\d{6,}/.test(text));
  assert(text.length <= 200);
});

Deno.test("redactBillErrorText: non-Error inputs degrade safely", () => {
  assertEquals(redactBillErrorText("plain message"), "plain message");
  assertEquals(redactBillErrorText(undefined), "unknown error");
});
