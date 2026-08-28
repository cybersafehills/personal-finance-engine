import { assertEquals } from "jsr:@std/assert@1";
import { buildResendRequest, deliveryConfig, summarize } from "../lib.ts";

function env(map: Record<string, string>) {
  return (k: string) => map[k];
}

Deno.test("deliveryConfig: dark unless both switches are set", () => {
  assertEquals(deliveryConfig(env({})).enabled, false);
  assertEquals(
    deliveryConfig(env({ NOTIFICATION_EMAIL_ENABLED: "true" })).enabled,
    false,
  );
  assertEquals(
    deliveryConfig(env({ RESEND_API_KEY: "re_x" })).enabled,
    false,
  );
  const on = deliveryConfig(env({
    NOTIFICATION_EMAIL_ENABLED: "true",
    RESEND_API_KEY: "  re_abc  ",
  }));
  assertEquals(on.enabled, true);
  if (on.enabled) {
    assertEquals(on.apiKey, "re_abc");
    assertEquals(on.from, "OneLedger <notifications@oneledger.app>");
  }
});

Deno.test("deliveryConfig: NOTIFICATION_EMAIL_FROM overrides the sender", () => {
  const c = deliveryConfig(env({
    NOTIFICATION_EMAIL_ENABLED: "true",
    RESEND_API_KEY: "re_x",
    NOTIFICATION_EMAIL_FROM: "Household <hi@example.com>",
  }));
  assertEquals(c.enabled && c.from, "Household <hi@example.com>");
});

Deno.test("buildResendRequest: subject is the title; body is appended when present", () => {
  assertEquals(
    buildResendRequest(
      { id: "1", email: "a@b.com", title: "A member joined", body: null },
      "from@x.com",
    ),
    {
      from: "from@x.com",
      to: ["a@b.com"],
      subject: "A member joined",
      text: "A member joined",
    },
  );
  assertEquals(
    buildResendRequest(
      {
        id: "2",
        email: "a@b.com",
        title: "Budget at 90%",
        body: "Groceries budget is nearly spent.",
      },
      "from@x.com",
    ).text,
    "Budget at 90%\n\nGroceries budget is nearly spent.",
  );
});

Deno.test("summarize: counts ok / failed and carries the skip reason", () => {
  assertEquals(summarize(false, 0, [], "RESEND_API_KEY is not set"), {
    configured: false,
    reason: "RESEND_API_KEY is not set",
    considered: 0,
    sent: 0,
    failed: 0,
  });
  assertEquals(
    summarize(true, 3, [
      { id: "1", ok: true },
      { id: "2", ok: false, error: "resend 422" },
      { id: "3", ok: true },
    ]),
    { configured: true, considered: 3, sent: 2, failed: 1 },
  );
});
