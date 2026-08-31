/** Fail-closed server flag: common truthy spellings do not enable a cutover. */
export function canonicalConnectionsUiEnabled(
  value: string | undefined,
): boolean {
  return value === "enabled";
}

/** Only redacted machine codes are safe to expose as a connector reference. */
export function safeConnectorErrorCode(value: string | null): string | null {
  return value && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}
