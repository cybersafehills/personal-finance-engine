import { assertEquals } from "jsr:@std/assert@1";
import { sanitizeEventProps } from "./analytics.ts";

Deno.test("sanitizeEventProps: drops forbidden keys outright", () => {
  const out = sanitizeEventProps({
    phone: "0788123456",
    account_number: "1234567890",
    meter: "04012345678",
    amount: 5000,
    reference: "INV-42",
    query: "eKash",
  });
  assertEquals(out, { query: "eKash" });
});

Deno.test("sanitizeEventProps: drops string values that look like identifiers", () => {
  const out = sanitizeEventProps({
    label: "*182*1*1#",
    other: "078 812 3456",
    channel: "ussd",
  });
  assertEquals(out, { channel: "ussd" });
});

Deno.test("sanitizeEventProps: keeps safe primitives and caps string length", () => {
  const long = "x".repeat(200);
  const out = sanitizeEventProps({
    network: "ekash",
    verified: true,
    count: 3,
    note: long,
  });
  assertEquals(out.network, "ekash");
  assertEquals(out.verified, true);
  assertEquals(out.count, 3);
  assertEquals((out.note as string).length, 64);
});

Deno.test("sanitizeEventProps: undefined input yields an empty object", () => {
  assertEquals(sanitizeEventProps(undefined), {});
});
