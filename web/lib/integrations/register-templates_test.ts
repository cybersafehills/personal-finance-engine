import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseCsv } from "../csv.ts";
import { isMappingComplete, normalizeImportRow } from "./mapping.ts";
import {
  buildRegisterTemplateCsv,
  getRegisterTemplate,
  isRegisterTemplateKey,
  matchRegisterTemplate,
  REGISTER_TEMPLATE_KEYS,
  REGISTER_TEMPLATES,
  registerTemplateHeaders,
  registerTemplateSampleRows,
} from "./register-templates.ts";

Deno.test("every template has a complete, importable mapping", () => {
  for (const t of REGISTER_TEMPLATES) {
    assert(
      isMappingComplete(t.mapping),
      `${t.key} mapping is missing a required field`,
    );
    // Every mapped column index is inside the header list.
    const width = t.columns.length;
    for (const idx of Object.values(t.mapping.columns)) {
      assert(
        typeof idx === "number" && idx >= 0 && idx < width,
        `${t.key} maps a column outside its headers`,
      );
    }
  }
});

Deno.test("generated CSV round-trips to the declared headers", () => {
  for (const key of REGISTER_TEMPLATE_KEYS) {
    const parsed = parseCsv(buildRegisterTemplateCsv(key));
    assertEquals(
      parsed.headers,
      registerTemplateHeaders(getRegisterTemplate(key)),
      `${key} headers changed after a CSV round-trip`,
    );
    assertEquals(
      parsed.rows.length,
      registerTemplateSampleRows(getRegisterTemplate(key)).length,
      `${key} sample row count changed`,
    );
  }
});

Deno.test("withSample:false emits a header-only CSV", () => {
  const parsed = parseCsv(buildRegisterTemplateCsv("expense", { withSample: false }));
  assertEquals(parsed.rows.length, 0);
  assert(parsed.headers.length > 0);
});

Deno.test("sample rows normalize with the template mapping", () => {
  const expectedDirection: Record<string, "in" | "out"> = {
    "daily-sales": "in",
    "expense": "out",
    "cashbook": "in", // first cashbook sample fills Money In
  };
  for (const t of REGISTER_TEMPLATES) {
    const [firstSample] = registerTemplateSampleRows(t);
    const result = normalizeImportRow(firstSample, t.mapping);
    assert(result.ok, `${t.key} sample row failed to normalize`);
    if (result.ok) {
      assertEquals(result.row.direction, expectedDirection[t.key]);
      assert(result.row.amount_minor > 0, `${t.key} sample amount not positive`);
    }
  }
});

Deno.test("matchRegisterTemplate recognises a template's own headers", () => {
  for (const t of REGISTER_TEMPLATES) {
    const m = matchRegisterTemplate(registerTemplateHeaders(t));
    assert(m, `${t.key} headers did not match any starter template`);
    assertEquals(m!.template.key, t.key);
    assertEquals(m!.score, 1);
  }
});

Deno.test("matchRegisterTemplate does not cross-match or false-positive", () => {
  // Daily Sales headers must not resolve to Expense (they share 5 columns).
  const sales = matchRegisterTemplate(registerTemplateHeaders(
    getRegisterTemplate("daily-sales"),
  ));
  assertEquals(sales!.template.key, "daily-sales");

  // An unrelated bank export stays unmatched -> caller falls back to suggestMapping.
  assertEquals(
    matchRegisterTemplate(["Posted", "Narrative", "Debit", "Credit", "Running Bal"]),
    null,
  );
  assertEquals(matchRegisterTemplate([]), null);
});

Deno.test("isRegisterTemplateKey guards the download route", () => {
  assert(isRegisterTemplateKey("cashbook"));
  assert(!isRegisterTemplateKey("invoice"));
  assert(!isRegisterTemplateKey("../secrets"));
});
