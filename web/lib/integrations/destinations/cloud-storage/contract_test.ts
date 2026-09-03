import { assertEquals } from "jsr:@std/assert@1";
import {
  CLOUD_STORAGE_PROVIDER_META,
  isCloudStorageProviderKey,
  normalizeFolderPath,
} from "./contract.ts";

Deno.test("provider key guard", () => {
  assertEquals(isCloudStorageProviderKey("google_drive"), true);
  assertEquals(isCloudStorageProviderKey("dropbox"), true);
  assertEquals(isCloudStorageProviderKey("s3"), false);
});

Deno.test("every provider names its two env vars", () => {
  for (const meta of Object.values(CLOUD_STORAGE_PROVIDER_META)) {
    assertEquals(meta.clientIdEnv.length > 0, true);
    assertEquals(meta.clientSecretEnv.length > 0, true);
    assertEquals(meta.authUrl.startsWith("https://"), true);
  }
});

Deno.test("normalizeFolderPath", () => {
  assertEquals(normalizeFolderPath(""), "/");
  assertEquals(normalizeFolderPath("Accounting/2026"), "/Accounting/2026");
  assertEquals(normalizeFolderPath("/Accounting//2026/"), "/Accounting/2026");
  assertEquals(normalizeFolderPath("  a / b "), "/a/b");
  assertEquals(normalizeFolderPath("../etc"), null);
  assertEquals(normalizeFolderPath("bad:name"), null);
  assertEquals(normalizeFolderPath("x".repeat(500)), null);
});
