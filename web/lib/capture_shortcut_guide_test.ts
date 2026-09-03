import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  CAPTURE_SHORTCUT_TROUBLESHOOTING,
  captureShortcutGuideSteps,
  MTN_SENDER_PLACEHOLDER,
} from "./capture-shortcut-guide.ts";

Deno.test("captureShortcutGuideSteps: numbered 1..N, every body paragraph non-empty", () => {
  const steps = captureShortcutGuideSteps({});
  assert(steps.length >= 4);
  steps.forEach((step, i) => {
    assertEquals(step.n, i + 1);
    assert(step.title.trim().length > 0);
    assert(step.body.length > 0);
    assert(step.body.every((p) => p.trim().length > 0));
  });
});

Deno.test("captureShortcutGuideSteps: sender placeholder vs a real sender", () => {
  const withoutSender = captureShortcutGuideSteps({});
  assert(
    withoutSender.some((s) =>
      s.body.some((p) => p.includes(MTN_SENDER_PLACEHOLDER))
    ),
  );
  const withSender = captureShortcutGuideSteps({ mtnSender: "M-Money" });
  assert(withSender.some((s) => s.body.some((p) => p.includes("M-Money"))));
  assert(
    !withSender.some((s) =>
      s.body.some((p) => p.includes(MTN_SENDER_PLACEHOLDER))
    ),
  );
});

Deno.test("captureShortcutGuideSteps: step 1 wording reflects whether a signed link exists", () => {
  const noLink = captureShortcutGuideSteps({})[0].body.join(" ");
  const link = captureShortcutGuideSteps({
    shortcutUrl: "https://x/s.shortcut",
  })[0]
    .body.join(" ");
  assert(link.includes("Get the ready-made Shortcut"));
  assert(link.includes("Add Shortcut"));
  assert(!noLink.includes("Get the ready-made Shortcut"));
  // With no published Shortcut the fallback must not point at a link that
  // isn't on screen - it sends the user to Advanced connection instead.
  assert(!noLink.toLowerCase().includes("add link"));
  assert(noLink.includes("Advanced connection"));
});

Deno.test("captureShortcutGuideSteps: never leaks HTTP mechanics to the user", () => {
  const text = captureShortcutGuideSteps({ mtnSender: "M-Money" })
    .flatMap((s) => [s.title, ...s.body]).join(" ").toLowerCase();
  for (
    const leak of [
      "http",
      "json",
      "x-ingest-key",
      "x-device-key",
      "header",
      "post ",
    ]
  ) {
    assert(!text.includes(leak), `guide mentions "${leak}"`);
  }
});

Deno.test("CAPTURE_SHORTCUT_TROUBLESHOOTING: rows have a symptom and a fix", () => {
  assert(CAPTURE_SHORTCUT_TROUBLESHOOTING.length > 0);
  for (const row of CAPTURE_SHORTCUT_TROUBLESHOOTING) {
    assert(row.symptom.trim().length > 0);
    assert(row.fix.trim().length > 0);
  }
});
