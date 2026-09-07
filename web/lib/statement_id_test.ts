import {
  assert,
  assertEquals,
  assertMatch,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  formatStatementId,
  generateStatementId,
  generateStatementPackId,
  generateVerificationToken,
  isStatementId,
  isStatementPackId,
  isVerificationToken,
  randomStatementSuffix,
  STATEMENT_ID_PATTERN,
  statementIdDatePart,
} from "./statement-id.ts";

Deno.test("STATEMENT_ID_PATTERN accepts a well-formed id", () => {
  assert(STATEMENT_ID_PATTERN.test("OL-ST-20260907-AB3K9Z"));
  assert(isStatementId("OL-ST-20260907-AB3K9Z"));
});

Deno.test("STATEMENT_ID_PATTERN rejects the ambiguous letters I and O", () => {
  assert(!isStatementId("OL-ST-20260907-ABIK9Z"));
  assert(!isStatementId("OL-ST-20260907-ABOK9Z"));
});

Deno.test("STATEMENT_ID_PATTERN rejects a malformed date or suffix", () => {
  assert(!isStatementId("OL-ST-2026097-ABCDEF")); // 7 date digits
  assert(!isStatementId("OL-ST-20260907-ABCDE")); // 5 suffix chars
  assert(!isStatementId("OL-ST-20260907-abcdef")); // lowercase
  assert(!isStatementId("OL-XX-20260907-ABCDEF")); // wrong prefix
});

Deno.test("statementIdDatePart uses the UTC calendar date", () => {
  assertEquals(
    statementIdDatePart(new Date("2026-09-07T23:30:00Z")),
    "20260907",
  );
  assertEquals(
    statementIdDatePart(new Date("2026-01-05T00:15:00Z")),
    "20260105",
  );
});

Deno.test("randomStatementSuffix maps low bytes straight through the alphabet", () => {
  const suffix = randomStatementSuffix(() =>
    new Uint8Array([0, 1, 2, 3, 4, 5])
  );
  assertEquals(suffix, "012345");
});

Deno.test("randomStatementSuffix: multiples of the alphabet size land on '0'", () => {
  const suffix = randomStatementSuffix(
    () => new Uint8Array([34, 68, 102, 136, 170, 204]),
  );
  assertEquals(suffix, "000000");
});

Deno.test("randomStatementSuffix rejects biased high bytes and keeps drawing", () => {
  // First batch is all rejects (>= 238); second batch yields 6 usable bytes.
  const batches = [
    new Uint8Array([238, 240, 250, 255, 239, 245]),
    new Uint8Array([10, 11, 12, 13, 14, 15]),
  ];
  let i = 0;
  const suffix = randomStatementSuffix(() => batches[i++] ?? new Uint8Array(6));
  assertEquals(suffix, "ABCDEF");
});

Deno.test("randomStatementSuffix gives up on an RNG that only returns rejects", () => {
  assertThrows(() =>
    randomStatementSuffix(() => new Uint8Array([255, 255, 255, 255, 255, 255]))
  );
});

Deno.test("generateStatementId composes date + suffix", () => {
  const id = generateStatementId({
    now: new Date("2026-01-05T10:00:00Z"),
    randomBytes: () => new Uint8Array([10, 11, 12, 13, 14, 15]),
  });
  assertEquals(id, "OL-ST-20260105-ABCDEF");
  assert(isStatementId(id));
});

Deno.test("formatStatementId is a pure join", () => {
  assertEquals(
    formatStatementId("20260907", "AB3K9Z"),
    "OL-ST-20260907-AB3K9Z",
  );
});

Deno.test("generateStatementId with the real RNG always matches the pattern", () => {
  for (let i = 0; i < 200; i++) {
    const id = generateStatementId();
    assertMatch(id, STATEMENT_ID_PATTERN);
  }
});

Deno.test("generateVerificationToken: 32 chars from the id alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const t = generateVerificationToken();
    assertMatch(t, /^[0-9A-HJ-NP-Z]{32}$/);
  }
  assert(isVerificationToken(generateVerificationToken()));
  assert(!isVerificationToken("short"));
  assert(!isVerificationToken("ABCDEFGHIJKLMNOPQRSTUVWXYZ012345I")); // I not allowed
});

Deno.test("generateStatementPackId: OL-PK- prefix, valid suffix", () => {
  const id = generateStatementPackId({
    now: new Date("2026-05-01T00:00:00Z"),
    randomBytes: () => new Uint8Array([10, 11, 12, 13, 14, 15]),
  });
  assertEquals(id, "OL-PK-20260501-ABCDEF");
  assert(isStatementPackId(id));
  assert(!isStatementPackId("OL-ST-20260501-ABCDEF"));
});
