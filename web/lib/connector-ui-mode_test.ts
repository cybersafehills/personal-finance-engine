import { assertEquals } from "jsr:@std/assert@1";
import {
  canonicalConnectionsUiEnabled,
  safeConnectorErrorCode,
} from "./connector-ui-mode.ts";

Deno.test("canonical Connections preview is enabled only by the exact server value", () => {
  assertEquals(canonicalConnectionsUiEnabled("enabled"), true);
  assertEquals(canonicalConnectionsUiEnabled(undefined), false);
  assertEquals(canonicalConnectionsUiEnabled("true"), false);
  assertEquals(canonicalConnectionsUiEnabled("ENABLED"), false);
});

Deno.test("connector UI exposes only redacted machine-readable error codes", () => {
  assertEquals(
    safeConnectorErrorCode("oauth_refresh_failed"),
    "oauth_refresh_failed",
  );
  assertEquals(safeConnectorErrorCode(null), null);
  assertEquals(
    safeConnectorErrorCode("Provider said account 123456 failed"),
    null,
  );
  assertEquals(safeConnectorErrorCode("x".repeat(65)), null);
});
