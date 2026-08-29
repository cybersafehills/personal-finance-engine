import { assertEquals } from "jsr:@std/assert@1";
import { INGEST_RESPONSE_HELP } from "./ingest.ts";
import {
  ENDPOINT_URL_FALLBACK,
  MTN_SENDER_PLACEHOLDER,
  SHORTCUT_TROUBLESHOOTING,
  shortcutGuideSteps,
} from "./shortcut-guide.ts";

Deno.test("shortcutGuideSteps: numbered 1..N with non-empty titles and body", () => {
  const steps = shortcutGuideSteps({ endpointUrl: "https://x.supabase.co/functions/v1/ingest-momo" });
  assertEquals(steps.length > 0, true);
  steps.forEach((step, i) => {
    assertEquals(step.n, i + 1);
    assertEquals(step.title.length > 0, true);
    assertEquals(step.body.length > 0, true);
    assertEquals(step.body.every((p) => p.trim().length > 0), true);
  });
});

Deno.test("shortcutGuideSteps: injects the resolved endpoint URL into step 3", () => {
  const url = "https://abc123.supabase.co/functions/v1/ingest-momo";
  const steps = shortcutGuideSteps({ endpointUrl: url });
  const urlField = steps.flatMap((s) => s.fields ?? []).find((f) => f.label === "URL");
  assertEquals(urlField?.value, url);
});

Deno.test("shortcutGuideSteps: falls back to a placeholder URL when none is resolved", () => {
  const steps = shortcutGuideSteps({ endpointUrl: null });
  const urlField = steps.flatMap((s) => s.fields ?? []).find((f) => f.label === "URL");
  assertEquals(urlField?.value, ENDPOINT_URL_FALLBACK);
});

Deno.test("shortcutGuideSteps: uses the placeholder sender until a real one is passed", () => {
  const withoutSender = shortcutGuideSteps({ endpointUrl: null });
  assertEquals(
    withoutSender.some((s) => s.body.some((p) => p.includes(MTN_SENDER_PLACEHOLDER))),
    true,
  );

  const withSender = shortcutGuideSteps({ endpointUrl: null, mtnSender: "M-Money" });
  assertEquals(
    withSender.some((s) => s.body.some((p) => p.includes("M-Money"))),
    true,
  );
  assertEquals(
    withSender.some((s) => s.body.some((p) => p.includes(MTN_SENDER_PLACEHOLDER))),
    false,
  );
});

Deno.test("SHORTCUT_TROUBLESHOOTING: every responseKey maps to a real ingest response", () => {
  for (const row of SHORTCUT_TROUBLESHOOTING) {
    assertEquals(row.symptom.trim().length > 0, true);
    assertEquals(row.fix.trim().length > 0, true);
    if (row.responseKey !== undefined) {
      assertEquals(
        typeof INGEST_RESPONSE_HELP[row.responseKey],
        "string",
        `unknown responseKey: ${row.responseKey}`,
      );
    }
  }
});
