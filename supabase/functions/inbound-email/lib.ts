// inbound-email: pure logic (ADR 0018 Slice B). Everything here is
// side-effect-free and unit-tested (tests/lib_test.ts). index.ts wires it
// to Deno.serve + Supabase.
//
// Flow: Resend Inbound POSTs an `email.received` webhook, signed with Svix.
// We verify the signature, pull the opaque token out of the recipient
// address (`u+<token>@<domain>`), resolve it to a financial_source, turn
// CSV attachments and/or the plain-text body into normalized statement
// rows, and import them via import_statement_rows_for_source.

import {
  type ColumnMapping,
  EMAIL_BODY_MAPPING,
  guessMapping,
  linesToRows,
  type NormalizedStatementRow,
  normalizeStatementRows,
  parseCsv,
} from "../_shared/statement-parse.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type IngestConfig =
  | { enabled: true; secret: string; domain: string }
  | { enabled: false; reason: string };

export function readConfig(
  getEnv: (k: string) => string | undefined,
): IngestConfig {
  if (getEnv("EMAIL_STATEMENT_INGEST_ENABLED") !== "true") {
    return { enabled: false, reason: "flag_off" };
  }
  const secret = getEnv("INBOUND_EMAIL_WEBHOOK_SECRET")?.trim();
  if (!secret) {
    return { enabled: false, reason: "secret_not_configured" };
  }
  const domain = getEnv("INBOUND_EMAIL_DOMAIN")?.trim() || "in.oneledger.me";
  return { enabled: true, secret, domain };
}

// ---------------------------------------------------------------------------
// Svix signature verification
// (Resend signs inbound webhooks with Svix; same scheme as the dashboard's
//  "Signing Secret" -> `whsec_<base64>`.)
// ---------------------------------------------------------------------------

export type SvixHeaders = { id: string; timestamp: string; signature: string };

export function readSvixHeaders(h: Headers): SvixHeaders | null {
  const id = h.get("svix-id") ?? h.get("webhook-id");
  const timestamp = h.get("svix-timestamp") ?? h.get("webhook-timestamp");
  const signature = h.get("svix-signature") ?? h.get("webhook-signature");
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

export function timestampWithinTolerance(
  timestamp: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSeconds - ts) <= toleranceSeconds;
}

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Svix-signed webhook. `secret` is the raw value from the
 * provider dashboard, with or without the `whsec_` prefix. Returns true
 * iff one of the `v1,<sig>` entries in the svix-signature header matches
 * HMAC-SHA256(`${id}.${timestamp}.${body}`).
 */
export async function verifySvixSignature(args: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
}): Promise<boolean> {
  const rawSecret = args.secret.startsWith("whsec_")
    ? args.secret.slice("whsec_".length)
    : args.secret;

  let keyBytes;
  try {
    keyBytes = base64ToBytes(rawSecret);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const toSign = new TextEncoder().encode(
    `${args.id}.${args.timestamp}.${args.body}`,
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, toSign));
  const expected = bytesToBase64(mac);

  // Header is space-separated `v1,<b64sig>` (also tolerate `v1a`, etc.).
  for (const part of args.signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0) continue;
    const provided = part.slice(comma + 1);
    if (timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recipient token
// ---------------------------------------------------------------------------

/**
 * Pull the opaque ingest token from the first recipient that matches
 * `<anything>+<token>@<domain>` (case-insensitive domain). Returns null if
 * no recipient is for our inbound domain.
 */
export function extractInboundToken(
  recipients: string[],
  domain: string,
): string | null {
  const dom = domain.toLowerCase();
  for (const raw of recipients) {
    const addr = extractAddr(raw).toLowerCase();
    const at = addr.lastIndexOf("@");
    if (at < 0) continue;
    if (addr.slice(at + 1) !== dom) continue;
    const local = addr.slice(0, at);
    const plus = local.indexOf("+");
    const token = plus >= 0 ? local.slice(plus + 1) : local;
    if (/^[a-z0-9]{16,64}$/.test(token)) return token;
  }
  return null;
}

function extractAddr(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

// ---------------------------------------------------------------------------
// Resend Inbound payload -> normalized email
// ---------------------------------------------------------------------------

export type InboundAttachment = {
  filename: string;
  contentType: string;
  content: string; // base64
};

export type InboundEmail = {
  recipients: string[];
  subject: string;
  text: string;
  attachments: InboundAttachment[];
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asRecipients(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter(Boolean);
  if (typeof v === "string") {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Normalize the `email.received` webhook body. Defensive about field
 * names because the exact Resend Inbound shape may evolve: accepts `to`
 * as string or array, `text`/`plain`, and attachments with
 * `content`/`data` (base64) + `filename` + `content_type`/`contentType`.
 * Returns null if the event isn't an inbound email.
 */
export function parseInboundPayload(json: unknown): InboundEmail | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;

  const type = asString(root.type);
  if (type && !type.startsWith("email.") && type !== "inbound") return null;

  const data =
    (root.data && typeof root.data === "object" ? root.data : root) as Record<
      string,
      unknown
    >;

  const recipients = [
    ...asRecipients(data.to),
    ...asRecipients(data.recipient),
    ...asRecipients(data.envelope_to),
  ];
  if (recipients.length === 0) return null;

  const text = asString(data.text) || asString(data.plain) ||
    asString(data.body);

  const rawAttachments = Array.isArray(data.attachments)
    ? data.attachments
    : [];
  const attachments: InboundAttachment[] = [];
  for (const a of rawAttachments) {
    if (!a || typeof a !== "object") continue;
    const rec = a as Record<string, unknown>;
    const content = asString(rec.content) || asString(rec.data);
    if (!content) continue;
    attachments.push({
      filename: asString(rec.filename) || asString(rec.name) || "attachment",
      contentType: asString(rec.content_type) || asString(rec.contentType) ||
        "application/octet-stream",
      content,
    });
  }

  return { recipients, subject: asString(data.subject), text, attachments };
}

// ---------------------------------------------------------------------------
// Email -> rows
// ---------------------------------------------------------------------------

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB decoded, per attachment
const MAX_ROWS = 5000;

export type ExtractOutcome = {
  rows: NormalizedStatementRow[];
  skipped: number;
  sources: string[]; // human-readable: which parts produced rows
};

function isCsvAttachment(a: InboundAttachment): boolean {
  const name = a.filename.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return true;
  if (a.contentType.includes("csv")) return true;
  return a.contentType === "text/plain" && name.endsWith(".txt");
}

function decodeAttachment(content: string): string | null {
  try {
    const bin = atob(content.replace(/\s+/g, ""));
    if (bin.length > MAX_ATTACHMENT_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Turn one inbound email into normalized statement rows. CSV attachments
 * are parsed with the same column-guessing the manual flow uses; the
 * plain-text body is scanned line-by-line for `<date> ... <amount>`
 * patterns. PDF attachments are NOT parsed here (pdf.js is unreliable
 * outside a browser) - the sender is told to use the web PDF import.
 */
export function extractRows(email: InboundEmail): ExtractOutcome {
  const rows: NormalizedStatementRow[] = [];
  let skipped = 0;
  const sources: string[] = [];

  for (const att of email.attachments) {
    if (!isCsvAttachment(att)) continue;
    const text = decodeAttachment(att.content);
    if (text === null) {
      skipped += 1;
      continue;
    }
    const { headers, rows: cells } = parseCsv(text);
    if (cells.length === 0) continue;
    const mapping: ColumnMapping = {
      date: 0,
      amount: 0,
      counterparty: null,
      externalRef: null,
      directionStrategy: "sign",
      directionColumn: null,
      dateOrder: "dmy",
      ...guessMapping(headers),
    };
    const res = normalizeStatementRows(cells, mapping);
    if (res.rows.length > 0) sources.push(att.filename);
    rows.push(...res.rows);
    skipped += res.skipped;
  }

  if (email.text.trim()) {
    const { rows: cells } = linesToRows(email.text);
    if (cells.length > 0) {
      const res = normalizeStatementRows(cells, EMAIL_BODY_MAPPING);
      if (res.rows.length > 0) sources.push("email body");
      rows.push(...res.rows);
      skipped += res.skipped;
    }
  }

  return { rows: rows.slice(0, MAX_ROWS), skipped, sources };
}

// ---------------------------------------------------------------------------
// Response summary
// ---------------------------------------------------------------------------

export function summarize(
  outcome:
    | { status: "skipped"; reason: string }
    | { status: "no_source" }
    | { status: "no_rows" }
    | {
      status: "imported";
      created: number;
      flaggedPossibleDuplicate: number;
      skipped: number;
      sources: string[];
    },
): Record<string, unknown> {
  return { ok: true, ...outcome };
}
