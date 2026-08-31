import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { buildConnectorEventRouteDiscriminators } from "../../_shared/connector-adapter.ts";
import {
  buildMtnMomoDiscoveryPayload,
  buildMtnMomoEventEnvelope,
  MTN_MOMO_SMS_CONNECTOR_KEY,
  mtnMomoSmsAdapter,
} from "../adapter.ts";
import { moneyReceivedMessage } from "./fixtures.ts";

const INSTALLATION = {
  installationId: "00000000-0000-4000-8000-000000000001",
  connectorKey: MTN_MOMO_SMS_CONNECTOR_KEY,
};

Deno.test("MTN adapter validates a pairing snapshot and removes the raw MSISDN from discovery", async () => {
  const payload = await buildMtnMomoDiscoveryPayload(INSTALLATION, {
    msisdn: "0788 000 001",
    sourceDisplayName: "My MTN MoMo",
    accountDisplayName: "Primary wallet",
    maskedIdentifier: "•••• 0001",
  });

  assertEquals(payload.length, 1);
  assertEquals(payload[0].provider_key, MTN_MOMO_SMS_CONNECTOR_KEY);
  assertEquals(payload[0].provider, "mtn_momo");
  assertEquals(payload[0].accounts.length, 1);
  assertEquals(JSON.stringify(payload).includes("250788000001"), false);
});

Deno.test("MTN discovery and event envelope resolve through identical discriminators", async () => {
  const payload = await buildMtnMomoDiscoveryPayload(INSTALLATION, {
    msisdn: "+250 788 000 001",
    sourceDisplayName: "My MTN MoMo",
    accountDisplayName: "Primary wallet",
    maskedIdentifier: "•••• 0001",
  });
  const envelope = buildMtnMomoEventEnvelope({
    message: moneyReceivedMessage.raw,
    receivedAt: "2026-08-18T08:37:10Z",
    sourceExternalRef: "wallet:250788000001",
    accountExternalRef: "primary_wallet",
    providerEventReference: "29945559123",
  });
  const route = await buildConnectorEventRouteDiscriminators(envelope);

  assertEquals(route.source_ref_hash, payload[0].source_ref_hash);
  assertEquals(route.account_ref_hash, payload[0].accounts[0].account_ref_hash);
});

Deno.test("MTN adapter normalizes through the production parser", () => {
  const parsed = mtnMomoSmsAdapter.normalize({
    message: moneyReceivedMessage.raw,
    receivedAt: null,
    sourceExternalRef: null,
    accountExternalRef: null,
    providerEventReference: "29945559123",
  });
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].external_transaction_id, "29945559123");
  assertEquals(parsed[0].amount_rwf, 7500);
});

Deno.test("MTN adapter rejects secret-shaped configuration fields and unsafe masks", async () => {
  await assertRejects(
    () =>
      buildMtnMomoDiscoveryPayload(INSTALLATION, {
        msisdn: "0788000001",
        sourceDisplayName: "My MTN MoMo",
        accountDisplayName: "Primary wallet",
        maskedIdentifier: "•••• 0001",
        pin: "1234",
      }),
    Error,
    "mtn_momo_configuration_invalid",
  );
  await assertRejects(
    () =>
      buildMtnMomoDiscoveryPayload(INSTALLATION, {
        msisdn: "0788000001",
        sourceDisplayName: "My MTN MoMo",
        accountDisplayName: "Primary wallet",
        maskedIdentifier: "250788000001",
      }),
    Error,
    "masked_identifier_invalid",
  );
  await assertRejects(
    () =>
      buildMtnMomoDiscoveryPayload(INSTALLATION, {
        msisdn: "0788000001",
        sourceDisplayName: "Wallet 250788000001",
        accountDisplayName: "Primary wallet",
        maskedIdentifier: "•••• 0001",
      }),
    Error,
    "display_name_contains_raw_msisdn",
  );
});
