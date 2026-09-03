import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  generateStorageKey,
  inspectPdf,
  sanitizeFilename,
  sha256Hex,
  sniffMimeType,
  validateUpload,
} from "./intake.ts";

const enc = new TextEncoder();

function bytes(...parts: Array<number[] | Uint8Array | string>): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === "string" ? enc.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

function pdf(pageCount: number, opts: { eof?: boolean; encrypt?: boolean } = {}): Uint8Array {
  const { eof = true, encrypt = false } = opts;
  let body = "%PDF-1.4\n";
  body += "1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n";
  body += `2 0 obj<</Type /Pages /Kids [] /Count ${pageCount}>>endobj\n`;
  for (let i = 0; i < pageCount; i++) {
    body += `${i + 3} 0 obj<</Type /Page>>endobj\n`;
  }
  if (encrypt) body += "trailer<</Encrypt 9 0 R>>\n";
  if (eof) body += "%%EOF\n";
  return enc.encode(body);
}

Deno.test("sniffMimeType: identifies each supported format from magic bytes", () => {
  assertEquals(sniffMimeType(pdf(1)), "application/pdf");
  assertEquals(sniffMimeType(Uint8Array.from(PNG_MAGIC)), "image/png");
  assertEquals(sniffMimeType(Uint8Array.from(JPEG_MAGIC)), "image/jpeg");
  assertEquals(sniffMimeType(bytes([0, 0, 0, 0], "ftypheic", [0, 0])), "image/heic");
  assertEquals(sniffMimeType(bytes([0, 0, 0, 0], "ftypmif1", [0, 0])), "image/heif");
});

Deno.test("sniffMimeType: an .exe renamed .pdf is not accepted (content wins over extension)", () => {
  const fakePdf = bytes([0x4d, 0x5a, 0x90, 0x00], "this is really a PE binary");
  assertEquals(sniffMimeType(fakePdf), null);
});

Deno.test("sniffMimeType: a plain text file is rejected", () => {
  assertEquals(sniffMimeType(enc.encode("Dear supplier, please pay...")), null);
});

Deno.test("sanitizeFilename: strips path segments, control chars and leading dots", () => {
  assertEquals(sanitizeFilename("../../etc/passwd"), "passwd");
  assertEquals(sanitizeFilename("C:\\Users\\me\\Invoice 42.pdf"), "Invoice 42.pdf");
  assertEquals(sanitizeFilename("  ...hidden.pdf"), "hidden.pdf");
  assertEquals(sanitizeFilename("in\u0000voice\u001f.pdf"), "invoice.pdf");
  assertEquals(sanitizeFilename(""), "document");
  assertEquals(sanitizeFilename("   "), "document");
});

Deno.test("sanitizeFilename: caps very long names", () => {
  const long = "a".repeat(500) + ".pdf";
  assert(sanitizeFilename(long).length <= 180);
});

Deno.test("generateStorageKey: opaque, tenant-prefixed, no user string", () => {
  const key = generateStorageKey(
    "11111111-1111-1111-1111-111111111111",
    "a".repeat(64),
    "application/pdf",
  );
  assertEquals(key, `11111111-1111-1111-1111-111111111111/${"a".repeat(64)}.pdf`);
  assert(!key.includes(".."));
});

Deno.test("sha256Hex: stable, lowercase, 64 hex chars", async () => {
  const h = await sha256Hex(enc.encode("hello"));
  assertEquals(
    h,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  assert(/^[0-9a-f]{64}$/.test(h));
  // deterministic, and sensitive to a one-byte change
  assertEquals(await sha256Hex(enc.encode("hello")), h);
  assert((await sha256Hex(enc.encode("hellp"))) !== h);
});

Deno.test("inspectPdf: counts pages via /Count", () => {
  const r = inspectPdf(pdf(3));
  assert(r.ok);
  if (r.ok) assertEquals(r.pageCount, 3);
});

Deno.test("inspectPdf: rejects an encrypted PDF", () => {
  const r = inspectPdf(pdf(1, { encrypt: true }));
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "pdf_password_protected");
});

Deno.test("inspectPdf: rejects a truncated PDF (no %%EOF)", () => {
  const r = inspectPdf(pdf(1, { eof: false }));
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "pdf_corrupt");
});

Deno.test("validateUpload: accepts a small valid PDF and reports its page count", async () => {
  const r = await validateUpload({
    bytes: pdf(2),
    declaredName: "receipt.pdf",
    maxBytes: 1_000_000,
    maxPages: 25,
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.mimeType, "application/pdf");
    assertEquals(r.pageCount, 2);
    assertEquals(r.sanitizedFilename, "receipt.pdf");
  }
});

Deno.test("validateUpload: rejects empty, oversized, unsupported, and over-long-page files", async () => {
  assertEquals(
    (await validateUpload({ bytes: new Uint8Array(), declaredName: "x", maxBytes: 10, maxPages: 5 })),
    { ok: false, reason: "empty_file" },
  );
  assertEquals(
    (await validateUpload({ bytes: pdf(1), declaredName: "x", maxBytes: 5, maxPages: 5 })),
    { ok: false, reason: "too_large" },
  );
  assertEquals(
    (await validateUpload({
      bytes: enc.encode("not a document"),
      declaredName: "x.pdf",
      maxBytes: 1000,
      maxPages: 5,
    })),
    { ok: false, reason: "unsupported_type" },
  );
  assertEquals(
    (await validateUpload({ bytes: pdf(30), declaredName: "x.pdf", maxBytes: 1_000_000, maxPages: 25 })),
    { ok: false, reason: "too_many_pages" },
  );
});

Deno.test("validateUpload: an image needs no page count", async () => {
  const r = await validateUpload({
    bytes: Uint8Array.from(JPEG_MAGIC),
    declaredName: "photo.jpg",
    maxBytes: 1000,
    maxPages: 25,
  });
  assert(r.ok);
  if (r.ok) assertEquals(r.pageCount, null);
});
