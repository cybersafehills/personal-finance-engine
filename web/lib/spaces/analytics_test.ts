import { assertEquals } from "jsr:@std/assert@1";
import { sanitizeSpacesEventProps } from "./analytics.ts";

Deno.test("sanitizeSpacesEventProps: drops id/name/amount keys and identifier-shaped values", () => {
  assertEquals(
    sanitizeSpacesEventProps({
      workspace_id: "8ba16fb0-0000-4000-8000-000000000000",
      user_id: "abc",
      household_name: "Niyoyo Household",
      amount: 45000,
      counterparty: "SIMBA SUPERMARKET",
      note: "rent",
      // kept:
      mode: "share_transactions",
      role: "member",
      created: 12,
      is_default: true,
    }),
    {
      mode: "share_transactions",
      role: "member",
      created: 12,
      is_default: true,
    },
  );
});

Deno.test("sanitizeSpacesEventProps: scrubs a bare uuid / long digit run / email even under an allowed key", () => {
  assertEquals(
    sanitizeSpacesEventProps({
      scope: "8ba16fb0-0000-4000-8000-000000000000",
      label: "0788123456",
      via: "a@b.com",
      kind: "source",
    }),
    { kind: "source" },
  );
});

Deno.test("sanitizeSpacesEventProps: caps a runaway count and a long string", () => {
  assertEquals(
    sanitizeSpacesEventProps({
      skipped: 9_999_999,
      status: "x".repeat(64),
      ok: "paused",
    }),
    { skipped: 100000, ok: "paused" },
  );
});

Deno.test("sanitizeSpacesEventProps: undefined / empty in => empty out", () => {
  assertEquals(sanitizeSpacesEventProps(undefined), {});
  assertEquals(sanitizeSpacesEventProps({}), {});
});
