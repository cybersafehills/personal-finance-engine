import { assert, assertEquals } from "jsr:@std/assert@1";
import { redactErrorText, sanitizeScanEventProps } from "./scan-analytics.ts";

Deno.test("sanitizeScanEventProps: drops forbidden keys outright", () => {
  const out = sanitizeScanEventProps({
    qr_payload: "tel:*182*1*1*250781234567*5000%23",
    raw: "anything",
    merchant_name: "Kigali Coffee",
    amount: 5000,
    phone: "0788123456",
    outcome: "granted",
  });
  assertEquals(out, { outcome: "granted" });
});

Deno.test("sanitizeScanEventProps: drops string values that look like identifiers or URLs", () => {
  const out = sanitizeScanEventProps({
    a: "*182*1*1#",
    b: "078 812 3456",
    c: "https://pay.example/redirect",
    kind: "denied",
  });
  assertEquals(out, { kind: "denied" });
});

Deno.test("sanitizeScanEventProps: keeps safe primitives and caps string length", () => {
  const out = sanitizeScanEventProps({
    outcome: "no_camera",
    torch_available: true,
    attempt: 2,
    blob: "y".repeat(120),
  });
  assertEquals(out.outcome, "no_camera");
  assertEquals(out.torch_available, true);
  assertEquals(out.attempt, 2);
  assertEquals((out.blob as string).length, 64);
});

Deno.test("sanitizeScanEventProps: undefined input yields an empty object", () => {
  assertEquals(sanitizeScanEventProps(undefined), {});
});

Deno.test("redactErrorText: strips digit runs, URLs, and USSD-shaped runs", () => {
  assertEquals(
    redactErrorText(new Error("failed for 250781234567 at *182*1*1*5000#")),
    "failed for ‹redacted› at ‹redacted-ussd›",
  );
  assertEquals(
    redactErrorText("bad redirect https://evil.example/x?a=1"),
    "bad redirect ‹redacted-url›",
  );
});

Deno.test("redactErrorText: non-Error inputs and length cap", () => {
  assertEquals(redactErrorText(null), "unknown error");
  assertEquals(redactErrorText({ weird: true }), "unknown error");
  assert(redactErrorText("x".repeat(500)).length <= 200);
});
