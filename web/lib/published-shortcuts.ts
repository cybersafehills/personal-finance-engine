// Versioned, Apple-signed files. Replace the obsolete clipboard-based release.
export function publishedShortcut(kind: "connect" | "capture", override?: string): string {
  const old = kind === "connect" ? "9f6db8e8335949e5bf72411dc625bfcb" : "49f9859716f740699b87e1bd2c97de92";
  const value = override?.trim();
  if (value && !value.includes(old)) return value;
  const name = kind === "connect" ? "Connect to OneLedger" : "OneLedger Capture";
  return `https://www.oneledger.me/shortcuts/v2/${encodeURIComponent(name)}.shortcut`;
}
