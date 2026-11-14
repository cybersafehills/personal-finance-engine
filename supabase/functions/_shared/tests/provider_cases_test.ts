import { assertEquals } from "jsr:@std/assert@1";
import { detectProvider } from "../providers.ts";
import fixture from "./provider-cases.json" with { type: "json" };

// Cross-language guard (ADR 0019 §3). The SAME provider-cases.json is run
// against the Kotlin port inside the mobile app
// (oneledger-mobile/modules/oneledger-capture, ProviderCasesTest). If a
// matcher changes, both suites must stay green against this one file, so
// the phone and the server can never disagree about what counts as a
// provider message.

const cases = fixture.cases as { message: string; provider: string | null }[];

Deno.test("provider-cases.json has both accept and reject cases", () => {
  assertEquals(cases.some((c) => c.provider !== null), true);
  assertEquals(cases.some((c) => c.provider === null), true);
});

for (const [index, c] of cases.entries()) {
  Deno.test(
    `provider case ${index}: ${c.provider ?? "rejected"} <- ${
      JSON.stringify(c.message.slice(0, 40))
    }`,
    () => {
      assertEquals(detectProvider(c.message)?.providerKey ?? null, c.provider);
    },
  );
}
