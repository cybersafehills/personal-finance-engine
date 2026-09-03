import { assertEquals } from "jsr:@std/assert@1";
import {
  ACCOUNTING_PROVIDER_META,
  ACCOUNTING_PROVIDERS,
  AccountingProviderNotConfiguredError,
  isAccountingProviderKey,
  isRealAccountingProvider,
  ledgerMapKeyForCategory,
  normalizeAccountMap,
} from "./contract.ts";

Deno.test("provider list + metadata are consistent", () => {
  assertEquals(ACCOUNTING_PROVIDERS, ["quickbooks", "xero", "zoho_books", "odoo"]);
  for (const key of ACCOUNTING_PROVIDERS) {
    const meta = ACCOUNTING_PROVIDER_META[key];
    assertEquals(meta.key, key);
    assertEquals(meta.clientIdEnv.length > 0, true);
    assertEquals(meta.clientSecretEnv.length > 0, true);
    assertEquals(meta.authUrl.startsWith("https://"), true);
    assertEquals(meta.tokenUrl.startsWith("https://"), true);
  }
});

Deno.test("provider-key guards", () => {
  assertEquals(isAccountingProviderKey("xero"), true);
  assertEquals(isAccountingProviderKey("google_drive"), false);
  assertEquals(isAccountingProviderKey(""), false);
  assertEquals(isRealAccountingProvider("odoo"), true);
  assertEquals(isRealAccountingProvider("sage"), false);
});

Deno.test("normalizeAccountMap keeps only string->string, trimmed and bounded", () => {
  assertEquals(
    normalizeAccountMap({
      "category:Meals": " 77 ",
      "account:x": "1200",
      "bad:number": 5,
      "  ": "y",
      "k": "  ",
    }),
    { "category:Meals": "77", "account:x": "1200" },
  );
  assertEquals(normalizeAccountMap(null), {});
  assertEquals(normalizeAccountMap([1, 2]), {});
  assertEquals(normalizeAccountMap("nope"), {});
});

Deno.test("normalizeAccountMap caps the number of entries", () => {
  const raw: Record<string, string> = {};
  for (let i = 0; i < 600; i++) raw[`k${i}`] = `v${i}`;
  assertEquals(Object.keys(normalizeAccountMap(raw)).length, 500);
});

Deno.test("normalizeAccountMap drops over-long keys/values", () => {
  const longKey = "k".repeat(201);
  const longVal = "v".repeat(201);
  assertEquals(
    normalizeAccountMap({ [longKey]: "1", ok: longVal, good: "2" }),
    { good: "2" },
  );
});

Deno.test("ledgerMapKeyForCategory namespaces and falls back", () => {
  assertEquals(ledgerMapKeyForCategory("Meals"), "category:Meals");
  assertEquals(ledgerMapKeyForCategory("  Travel  "), "category:Travel");
  assertEquals(ledgerMapKeyForCategory(null), "category:uncategorised");
  assertEquals(ledgerMapKeyForCategory(""), "category:uncategorised");
});

Deno.test("AccountingProviderNotConfiguredError carries the shared code", () => {
  const err = new AccountingProviderNotConfiguredError("quickbooks");
  assertEquals(err.code, "provider_not_configured");
  assertEquals(err.providerKey, "quickbooks");
  assertEquals(err instanceof Error, true);
});
