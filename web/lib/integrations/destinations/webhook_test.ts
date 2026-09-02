import { assertEquals } from "jsr:@std/assert@1";
import {
  buildWebhookHeaders,
  isSafeWebhookUrl,
  signWebhookPayload,
} from "./webhook.ts";

Deno.test("signWebhookPayload is deterministic and covers timestamp+body", async () => {
  const a = await signWebhookPayload("secret", "1700000000", `{"x":1}`);
  const b = await signWebhookPayload("secret", "1700000000", `{"x":1}`);
  const c = await signWebhookPayload("secret", "1700000001", `{"x":1}`);
  const d = await signWebhookPayload("secret", "1700000000", `{"x":2}`);
  assertEquals(a, b);
  assertEquals(a === c, false);
  assertEquals(a === d, false);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
});

Deno.test("buildWebhookHeaders sets the three headers", async () => {
  const h = await buildWebhookHeaders(
    "secret",
    "{}",
    new Date("2026-09-01T00:00:00Z"),
  );
  assertEquals(h["content-type"], "application/json");
  assertEquals(h["x-oneledger-timestamp"], "1788220800");
  assertEquals(
    h["x-oneledger-signature"],
    await signWebhookPayload("secret", "1788220800", "{}"),
  );
});

Deno.test("isSafeWebhookUrl accepts a public https URL", () => {
  assertEquals(isSafeWebhookUrl("https://hooks.example.com/oneledger").ok, true);
});

Deno.test("isSafeWebhookUrl rejects non-https, credentials, and private hosts", () => {
  for (
    const bad of [
      "http://hooks.example.com/x",
      "ftp://hooks.example.com/x",
      "https://user:pass@hooks.example.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://192.168.0.5/x",
      "https://169.254.169.254/latest/meta-data",
      "https://box.local/x",
      "https://[::1]/x",
      "not a url",
    ]
  ) {
    assertEquals(isSafeWebhookUrl(bad).ok, false, bad);
  }
});
