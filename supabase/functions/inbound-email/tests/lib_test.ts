import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  extractInboundToken,
  extractRows,
  type InboundEmail,
  parseInboundPayload,
  readConfig,
  readSvixHeaders,
  timestampWithinTolerance,
  verifySvixSignature,
} from "../lib.ts";

function env(map: Record<string, string>) {
  return (k: string) => map[k];
}

const DOMAIN = "in.oneledger.me";
const TOKEN = "ab12cd34ef56ab78cd90ef12ab34cd56"; // 32 hex, matches gen

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

Deno.test("readConfig: dark unless flag + secret both present", () => {
  assertEquals(readConfig(env({})).enabled, false);
  assertEquals(
    readConfig(env({ EMAIL_STATEMENT_INGEST_ENABLED: "true" })).enabled,
    false,
  );
  assertEquals(
    readConfig(env({ INBOUND_EMAIL_WEBHOOK_SECRET: "whsec_x" })).enabled,
    false,
  );
  const on = readConfig(env({
    EMAIL_STATEMENT_INGEST_ENABLED: "true",
    INBOUND_EMAIL_WEBHOOK_SECRET: "  whsec_abc  ",
  }));
  assertEquals(on.enabled, true);
  if (on.enabled) {
    assertEquals(on.secret, "whsec_abc");
    assertEquals(on.domain, DOMAIN);
  }
});

Deno.test("readConfig: INBOUND_EMAIL_DOMAIN overrides the domain", () => {
  const c = readConfig(env({
    EMAIL_STATEMENT_INGEST_ENABLED: "true",
    INBOUND_EMAIL_WEBHOOK_SECRET: "whsec_x",
    INBOUND_EMAIL_DOMAIN: "in.example.test",
  }));
  assertEquals(c.enabled && c.domain, "in.example.test");
});

// ---------------------------------------------------------------------------
// Svix headers + timestamp
// ---------------------------------------------------------------------------

Deno.test("readSvixHeaders: needs all three (svix-* or webhook-*)", () => {
  assertEquals(readSvixHeaders(new Headers()), null);
  assertEquals(
    readSvixHeaders(new Headers({ "svix-id": "a", "svix-timestamp": "1" })),
    null,
  );
  const ok = readSvixHeaders(
    new Headers({
      "svix-id": "msg_1",
      "svix-timestamp": "1725600000",
      "svix-signature": "v1,abc",
    }),
  );
  assertEquals(ok, {
    id: "msg_1",
    timestamp: "1725600000",
    signature: "v1,abc",
  });
});

Deno.test("timestampWithinTolerance: 5-minute window, rejects junk", () => {
  const now = 1_725_600_000;
  assert(timestampWithinTolerance(String(now), now));
  assert(timestampWithinTolerance(String(now - 299), now));
  assert(!timestampWithinTolerance(String(now - 301), now));
  assert(!timestampWithinTolerance(String(now + 600), now));
  assert(!timestampWithinTolerance("not-a-number", now));
});

// ---------------------------------------------------------------------------
// Signature verification (round-trip against a known secret)
// ---------------------------------------------------------------------------

async function sign(secretB64: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin);
}

Deno.test("verifySvixSignature: accepts a correct v1 signature, rejects a bad one", async () => {
  const secretB64 = btoa("a-32-byte-shared-secret-value!!!"); // arbitrary
  const id = "msg_2";
  const timestamp = "1725600000";
  const body = JSON.stringify({ type: "email.received", data: {} });
  const good = await sign(secretB64, `${id}.${timestamp}.${body}`);

  assert(
    await verifySvixSignature({
      secret: "whsec_" + secretB64,
      id,
      timestamp,
      signature: `v1,${good}`,
      body,
    }),
  );

  // multiple entries, one valid
  assert(
    await verifySvixSignature({
      secret: secretB64, // prefix optional
      id,
      timestamp,
      signature: `v1,AAAA v1,${good}`,
      body,
    }),
  );

  // tampered body
  assert(
    !(await verifySvixSignature({
      secret: "whsec_" + secretB64,
      id,
      timestamp,
      signature: `v1,${good}`,
      body: body + "x",
    })),
  );
});

// ---------------------------------------------------------------------------
// Recipient token extraction
// ---------------------------------------------------------------------------

Deno.test("extractInboundToken: pulls the token from u+<token>@domain", () => {
  assertEquals(
    extractInboundToken([`u+${TOKEN}@${DOMAIN}`], DOMAIN),
    TOKEN,
  );
  assertEquals(
    extractInboundToken(
      [`"Bank" <U+${TOKEN}@${DOMAIN.toUpperCase()}>`],
      DOMAIN,
    ),
    TOKEN,
  );
  // token without a plus tag
  assertEquals(extractInboundToken([`${TOKEN}@${DOMAIN}`], DOMAIN), TOKEN);
});

Deno.test("extractInboundToken: ignores other domains and malformed tokens", () => {
  assertEquals(extractInboundToken([`u+${TOKEN}@evil.test`], DOMAIN), null);
  assertEquals(extractInboundToken(["u+short@" + DOMAIN], DOMAIN), null);
  assertEquals(extractInboundToken(["not-an-address"], DOMAIN), null);
  assertEquals(extractInboundToken([], DOMAIN), null);
  // first matching recipient wins; a cc to another domain is skipped
  assertEquals(
    extractInboundToken([`cc@other.test`, `u+${TOKEN}@${DOMAIN}`], DOMAIN),
    TOKEN,
  );
});

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

Deno.test("parseInboundPayload: normalizes the Resend inbound shape", () => {
  const email = parseInboundPayload({
    type: "email.received",
    data: {
      to: [`u+${TOKEN}@${DOMAIN}`],
      subject: "Your statement",
      text: "hello",
      attachments: [
        {
          filename: "jan.csv",
          content_type: "text/csv",
          content: btoa("Date,Amount\n2026-01-02,-10.00\n"),
        },
        { filename: "empty" }, // no content -> dropped
      ],
    },
  });
  assert(email);
  assertEquals(email?.recipients, [`u+${TOKEN}@${DOMAIN}`]);
  assertEquals(email?.subject, "Your statement");
  assertEquals(email?.attachments.length, 1);
  assertEquals(email?.attachments[0].filename, "jan.csv");
});

Deno.test("parseInboundPayload: accepts a flat body and string `to`", () => {
  const email = parseInboundPayload({
    to: `u+${TOKEN}@${DOMAIN}, cc@x.test`,
    plain: "body text",
  });
  assert(email);
  assertEquals(email?.recipients.length, 2);
  assertEquals(email?.text, "body text");
});

Deno.test("parseInboundPayload: rejects non-email events and junk", () => {
  assertEquals(
    parseInboundPayload({ type: "contact.created", data: {} }),
    null,
  );
  assertEquals(parseInboundPayload({ data: {} }), null); // no recipients
  assertEquals(parseInboundPayload(null), null);
  assertEquals(parseInboundPayload("nope"), null);
});

// ---------------------------------------------------------------------------
// Row extraction
// ---------------------------------------------------------------------------

function emailWith(partial: Partial<InboundEmail>): InboundEmail {
  return {
    recipients: [`u+${TOKEN}@${DOMAIN}`],
    subject: "",
    text: "",
    attachments: [],
    ...partial,
  };
}

Deno.test("extractRows: parses a CSV attachment via column-guessing", () => {
  const csv = [
    "Date,Description,Amount",
    "02/01/2026,Coffee shop,-4500",
    "03/01/2026,Salary,1200000",
    "garbage line",
  ].join("\n");
  const out = extractRows(emailWith({
    attachments: [{
      filename: "statement.csv",
      contentType: "text/csv",
      content: btoa(csv),
    }],
  }));
  assertEquals(out.rows.length, 2);
  assertEquals(out.rows[0].direction, "out");
  assertEquals(out.rows[0].amount_minor, 4500);
  assertEquals(out.rows[1].direction, "in");
  assertEquals(out.rows[1].amount_minor, 1_200_000);
  assertEquals(out.skipped, 1);
  assertEquals(out.sources, ["statement.csv"]);
});

Deno.test("extractRows: scans a plain-text body for date+amount lines", () => {
  const body = [
    "Dear customer, here is your activity:",
    "2026-01-04  POS PURCHASE NAIROBI   -1,250.00",
    "2026-01-05  INWARD TRANSFER         3,000.00",
    "Thank you for banking with us.",
  ].join("\n");
  const out = extractRows(emailWith({ text: body }));
  assertEquals(out.rows.length, 2);
  assertEquals(out.rows[0].amount_minor, 1250);
  assertEquals(out.rows[0].direction, "out");
  assertEquals(out.rows[1].direction, "in");
  assertEquals(out.sources, ["email body"]);
});

Deno.test("extractRows: ignores non-CSV attachments (PDF handled on the web only)", () => {
  const out = extractRows(emailWith({
    attachments: [{
      filename: "statement.pdf",
      contentType: "application/pdf",
      content: btoa("%PDF-1.7 ..."),
    }],
  }));
  assertEquals(out.rows.length, 0);
  assertEquals(out.sources, []);
});

Deno.test("extractRows: oversized attachment is skipped, not thrown", () => {
  const huge = "x".repeat(6 * 1024 * 1024);
  const out = extractRows(emailWith({
    attachments: [{
      filename: "big.csv",
      contentType: "text/csv",
      content: btoa(huge),
    }],
  }));
  assertEquals(out.rows.length, 0);
  assertEquals(out.skipped, 1);
});
