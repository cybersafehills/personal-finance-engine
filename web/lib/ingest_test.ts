import { assertEquals } from "jsr:@std/assert@1";
import {
  buildIngestEndpointUrl,
  INGEST_BODY_EXAMPLE,
  INGEST_FUNCTION_SLUG,
  INGEST_REQUEST,
  INGEST_RESPONSE_HELP,
} from "./ingest.ts";

Deno.test("buildIngestEndpointUrl: appends the functions path to a plain base", () => {
  assertEquals(
    buildIngestEndpointUrl("https://abc123.supabase.co"),
    "https://abc123.supabase.co/functions/v1/ingest-momo",
  );
});

Deno.test("buildIngestEndpointUrl: tolerates one or more trailing slashes", () => {
  assertEquals(
    buildIngestEndpointUrl("https://abc123.supabase.co/"),
    "https://abc123.supabase.co/functions/v1/ingest-momo",
  );
  assertEquals(
    buildIngestEndpointUrl("https://abc123.supabase.co///"),
    "https://abc123.supabase.co/functions/v1/ingest-momo",
  );
});

Deno.test("buildIngestEndpointUrl: trims surrounding whitespace", () => {
  assertEquals(
    buildIngestEndpointUrl("  https://abc123.supabase.co  "),
    "https://abc123.supabase.co/functions/v1/ingest-momo",
  );
});

Deno.test("buildIngestEndpointUrl: returns null for missing/blank input", () => {
  assertEquals(buildIngestEndpointUrl(null), null);
  assertEquals(buildIngestEndpointUrl(undefined), null);
  assertEquals(buildIngestEndpointUrl(""), null);
  assertEquals(buildIngestEndpointUrl("   "), null);
});

Deno.test("buildIngestEndpointUrl: works for a local Supabase stack", () => {
  assertEquals(
    buildIngestEndpointUrl("http://127.0.0.1:54321"),
    "http://127.0.0.1:54321/functions/v1/ingest-momo",
  );
});

Deno.test("INGEST_REQUEST: contract constants match the Edge Function", () => {
  assertEquals(INGEST_REQUEST.method, "POST");
  assertEquals(INGEST_REQUEST.authHeader, "x-ingest-key");
  assertEquals(INGEST_REQUEST.contentType, "application/json");
  assertEquals(INGEST_REQUEST.maxMessageChars, 5000);
  assertEquals([...INGEST_REQUEST.bodyFields], ["message", "received_at"]);
  assertEquals(INGEST_FUNCTION_SLUG, "ingest-momo");
});

Deno.test("INGEST_BODY_EXAMPLE: is valid JSON carrying both body fields", () => {
  const parsed = JSON.parse(INGEST_BODY_EXAMPLE) as Record<string, unknown>;
  assertEquals(Object.keys(parsed).sort(), ["message", "received_at"]);
});

Deno.test("INGEST_RESPONSE_HELP: covers every documented status/error string", () => {
  for (
    const key of [
      "processed",
      "needs_review",
      "duplicate",
      "unauthorized",
      "invalid_json",
      "invalid_request_body",
      "missing_message",
      "message_too_large",
      "not_rwf_message",
      "method_not_allowed",
      "database_error",
    ]
  ) {
    assertEquals(typeof INGEST_RESPONSE_HELP[key], "string");
  }
});
