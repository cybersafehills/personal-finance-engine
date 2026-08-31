import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { buildConnectorDiscoveryPayload } from "../connector-adapter.ts";

const digests = new Map<string, string>([
  ["source|bank-customer-1", "a".repeat(64)],
  ["source|bank-customer-2", "b".repeat(64)],
  ["account:bank-customer-1|current", "c".repeat(64)],
  ["account:bank-customer-1|savings", "d".repeat(64)],
  ["account:bank-customer-2|current", "e".repeat(64)],
]);

const hashReference = (scope: string, reference: string) =>
  Promise.resolve(digests.get(`${scope}|${reference}`) ?? "f".repeat(64));

const discovery = [
  {
    externalRef: "bank-customer-2",
    providerKey: "example_bank_rw",
    provider: "bank",
    sourceType: "bank_account",
    displayName: "Business banking",
    maskedIdentifier: "•••• 2002",
    currency: "rwf",
    accounts: [{
      externalRef: "current",
      displayName: "Business current",
      provider: "bank",
      currency: "RWF",
    }],
  },
  {
    externalRef: "bank-customer-1",
    providerKey: "example_bank_rw",
    provider: "bank",
    sourceType: "bank_account",
    displayName: "Personal banking",
    maskedIdentifier: "•••• 1001",
    currency: "RWF",
    accounts: [
      {
        externalRef: "savings",
        displayName: "Savings",
        provider: "bank",
        currency: "RWF",
      },
      {
        externalRef: "current",
        displayName: "Current",
        provider: "bank",
        currency: "RWF",
      },
    ],
  },
];

Deno.test("discovery contract hashes raw references and sorts stable discriminators", async () => {
  const payload = await buildConnectorDiscoveryPayload(
    discovery,
    hashReference,
  );

  assertEquals(payload.map((source) => source.source_ref_hash), [
    "a".repeat(64),
    "b".repeat(64),
  ]);
  assertEquals(payload[0].accounts.map((account) => account.account_ref_hash), [
    "c".repeat(64),
    "d".repeat(64),
  ]);
  assertEquals(payload[0].currency, "RWF");
  assertEquals(JSON.stringify(payload).includes("bank-customer"), false);
});

Deno.test("masked display identifiers never participate in routing identity", async () => {
  const changedMask = structuredClone(discovery);
  changedMask[0].maskedIdentifier = "•••• 9999";
  const original = await buildConnectorDiscoveryPayload(
    discovery,
    hashReference,
  );
  const changed = await buildConnectorDiscoveryPayload(
    changedMask,
    hashReference,
  );
  assertEquals(changed[1].source_ref_hash, original[1].source_ref_hash);
  assertEquals(changed[1].accounts, original[1].accounts);
});

Deno.test("discovery rejects unknown fields that could leak provider secrets", async () => {
  await assertRejects(
    () =>
      buildConnectorDiscoveryPayload(
        [{ ...discovery[0], accessToken: "must-not-pass" }],
        hashReference,
      ),
    Error,
    "discovery_source_shape_invalid",
  );
});

Deno.test("discovery rejects duplicate source and account discriminators", async () => {
  await assertRejects(
    () =>
      buildConnectorDiscoveryPayload(
        [discovery[0], structuredClone(discovery[0])],
        hashReference,
      ),
    Error,
    "duplicate_source_discriminator",
  );

  const duplicateAccount = structuredClone(discovery[0]);
  duplicateAccount.accounts.push(structuredClone(duplicateAccount.accounts[0]));
  await assertRejects(
    () => buildConnectorDiscoveryPayload([duplicateAccount], hashReference),
    Error,
    "duplicate_account_discriminator",
  );
});

Deno.test("discovery rejects an identifier masquerading as a masked suffix", async () => {
  const unsafe = structuredClone(discovery[0]);
  unsafe.maskedIdentifier = "250788123456";
  await assertRejects(
    () => buildConnectorDiscoveryPayload([unsafe], hashReference),
    Error,
    "masked_identifier_invalid",
  );
});
