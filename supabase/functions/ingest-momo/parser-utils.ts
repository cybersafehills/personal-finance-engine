export function normalizeMessage(input: string): string {
  return input
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseNumber(value?: string | null): number | null {
  if (!value) return null;

  const cleaned = value
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function parseOccurredAt(date: string, time: string): string {
  // MTN Rwanda SMS timestamps are expressed in Rwanda local time.
  // Rwanda uses UTC+02:00.
  return `${date}T${time}+02:00`;
}

export function extractFee(message: string): number {
  const match = message.match(/Fee[:.\s]*([\d,]+)\s*RWF/i) ??
    message.match(/Fee\s+([\d,]+)\s*RWF/i);

  return parseNumber(match?.[1]) ?? 0;
}

export function extractBalance(message: string): number | null {
  const match = message.match(/Balance[:.\s]*([\d,]+)\s*RWF/i) ??
    message.match(/Balance:\s*([\d,]+)/i);

  return parseNumber(match?.[1]);
}

export function extractTransactionId(message: string): string | null {
  const patterns = [
    /TxId[:.\s]*([0-9]+)/i,
    /FT\s*Id[:.\s]*([0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}
