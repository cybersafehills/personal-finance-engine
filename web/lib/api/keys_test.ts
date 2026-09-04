import { assertEquals } from "jsr:@std/assert@1";
import {
  API_SCOPES,
  bearerFromHeader,
  hasScope,
  isKnownScope,
  looksLikeApiKey,
  normalizeScopes,
} from "./keys.ts";

Deno.test("scope set is the documented read-only six", () => {
  assertEquals(API_SCOPES, [
    "transactions:read",
    "accounts:read",
    "categories:read",
    "exports:read",
    "sync:read",
    "events:read",
  ]);
});

Deno.test("isKnownScope / hasScope", () => {
  assertEquals(isKnownScope("transactions:read"), true);
  assertEquals(isKnownScope("transactions:write"), false);
  assertEquals(isKnownScope(""), false);
  assertEquals(hasScope(["accounts:read", "events:read"], "events:read"), true);
  assertEquals(hasScope(["accounts:read"], "transactions:read"), false);
});

Deno.test("normalizeScopes drops unknowns, dedupes, canonical order", () => {
  assertEquals(
    normalizeScopes([
      "events:read",
      "transactions:read",
      "transactions:read",
      "bogus",
      42,
    ]),
    ["transactions:read", "events:read"],
  );
  assertEquals(normalizeScopes(null), []);
  assertEquals(normalizeScopes("transactions:read"), []);
});

Deno.test("looksLikeApiKey", () => {
  assertEquals(looksLikeApiKey("olk_" + "a".repeat(40)), true);
  assertEquals(looksLikeApiKey("olk_short"), false);
  assertEquals(looksLikeApiKey("pfe_" + "a".repeat(40)), false);
  assertEquals(looksLikeApiKey("olk_has space" + "a".repeat(30)), false);
});

Deno.test("bearerFromHeader accepts scheme or bare token, case-insensitive", () => {
  assertEquals(bearerFromHeader("Bearer olk_abc"), "olk_abc");
  assertEquals(bearerFromHeader("bearer   olk_abc  "), "olk_abc");
  assertEquals(bearerFromHeader("olk_abc"), "olk_abc");
  assertEquals(bearerFromHeader(""), null);
  assertEquals(bearerFromHeader(null), null);
  assertEquals(bearerFromHeader("Bearer   "), null);
});
