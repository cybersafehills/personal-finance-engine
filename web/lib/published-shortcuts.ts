/** Apple iCloud installers open Add Shortcut directly, unlike file downloads. */
export const COMBINED_SHORTCUT_URL = "https://www.icloud.com/shortcuts/cd5a678737e14ba79eda55a98a26acd0";
export function publishedShortcut(kind: "connect" | "capture", override?: string): string {
  const value = override?.trim();
  const obsolete = ["9f6db8e8335949e5bf72411dc625bfcb", "49f9859716f740699b87e1bd2c97de92", "/shortcuts/v2/"];
  if (value && !obsolete.some(old => value.includes(old))) return value;
  return { connect: COMBINED_SHORTCUT_URL, capture: COMBINED_SHORTCUT_URL }[kind];
}
