const CONNECTOR_REFERENCE_HASH_DOMAIN = "oneledger:connector-reference:v1";

export function normalizeRwandaMtnMsisdn(value: string): string {
  const digits = value.trim().replace(/\D/g, "");
  const normalized = digits.startsWith("250")
    ? digits
    : digits.startsWith("0")
    ? `250${digits.slice(1)}`
    : `250${digits}`;

  if (!/^2507[2389][0-9]{7}$/.test(normalized)) {
    throw new Error("mtn_momo_msisdn_invalid");
  }
  return normalized;
}

async function hashConnectorReference(
  scope: string,
  reference: string,
): Promise<string> {
  const input = new TextEncoder().encode(
    `${CONNECTOR_REFERENCE_HASH_DOMAIN}\0${scope}\0${reference}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildMtnMomoPairingIdentity(msisdn: string): Promise<{
  sourceRefHash: string;
  accountRefHash: string;
  maskedIdentifier: string;
}> {
  const normalized = normalizeRwandaMtnMsisdn(msisdn);
  const sourceReference = `wallet:${normalized}`;

  return {
    sourceRefHash: await hashConnectorReference("source", sourceReference),
    accountRefHash: await hashConnectorReference(
      `account:${sourceReference}`,
      "primary_wallet",
    ),
    maskedIdentifier: `MTN MoMo •••• ${normalized.slice(-4)}`,
  };
}
