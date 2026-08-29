import { assertEquals } from "jsr:@std/assert@1";
import { redactErrorText } from "./monitoring.ts";

Deno.test("redactErrorText: scrubs ids, emails, urls, and long digit runs", () => {
  assertEquals(
    redactErrorText(
      new Error(
        'membership 8ba16fb0-0000-4000-8000-000000000000 for alice@example.com ' +
          "(phone 0788123456) failed: see https://db/logs/xyz",
      ),
    ),
    "membership ‹redacted-id› for ‹redacted-email› (phone ‹redacted›) failed: see ‹redacted-url›",
  );
});

Deno.test("redactErrorText: passes a clean RLS-style message through, capped", () => {
  assertEquals(
    redactErrorText("new row violates row-level security policy for table \"notifications\""),
    'new row violates row-level security policy for table "notifications"',
  );
  assertEquals(redactErrorText("x".repeat(400)).length, 240);
});

Deno.test("redactErrorText: non-Error inputs", () => {
  assertEquals(redactErrorText("plain string"), "plain string");
  assertEquals(redactErrorText(undefined), "unknown error");
  assertEquals(redactErrorText({ weird: true }), "unknown error");
});
