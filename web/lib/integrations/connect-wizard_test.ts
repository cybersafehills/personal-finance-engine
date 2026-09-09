import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  CONNECT_STEPS,
  connectStepIndex,
  DIRECTION_OPTIONS,
  IMPORT_DATA_TYPE_OPTIONS,
  isConnectSource,
  isConnectStep,
  resolveConnectHandoff,
  SOURCE_OPTIONS,
} from "./connect-wizard.ts";

Deno.test("step ordering is stable", () => {
  assertEquals([...CONNECT_STEPS], ["source", "direction", "data-type"]);
  assertEquals(connectStepIndex("source"), 0);
  assertEquals(connectStepIndex("data-type"), 2);
  assert(isConnectStep("direction"));
  assert(!isConnectStep("preview"));
});

Deno.test("catalogs: exactly one live source, and it is 'file'", () => {
  const live = SOURCE_OPTIONS.filter((s) => s.status === "available");
  assertEquals(live.map((s) => s.key), ["file"]);
  // every coming_soon source points somewhere the user can read more.
  for (const s of SOURCE_OPTIONS) {
    if (s.status === "coming_soon") assert(s.comingSoonHref);
  }
  assert(isConnectSource("file"));
});

Deno.test("import data types: transactions/expenses/income live, invoices coming soon", () => {
  const live = IMPORT_DATA_TYPE_OPTIONS.filter((d) => d.status === "available");
  assertEquals(live.map((d) => d.key).sort(), ["expenses", "income", "transactions"]);
  const soon = IMPORT_DATA_TYPE_OPTIONS.filter((d) => d.status === "coming_soon");
  assertEquals(soon.map((d) => d.key), ["invoices"]);
});

Deno.test("resolve: expense/income import route with a target query param", () => {
  const exp = resolveConnectHandoff({
    source: "file",
    direction: "import",
    dataType: "expenses",
  });
  assert(exp.ok);
  if (exp.ok) assertEquals(exp.href, "/integrations/imports/new?target=expense");

  const inc = resolveConnectHandoff({
    source: "file",
    direction: "import",
    dataType: "income",
  });
  assert(inc.ok);
  if (inc.ok) assertEquals(inc.href, "/integrations/imports/new?target=income");
});

Deno.test("resolve: invoice import is still refused with a reason", () => {
  const r = resolveConnectHandoff({
    source: "file",
    direction: "import",
    dataType: "invoices",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(/invoice/i.test(r.reason));
});

Deno.test("every direction option names a gate flag", () => {
  for (const d of DIRECTION_OPTIONS) {
    assert(["import", "export", "workbooks"].includes(d.gate));
  }
});

Deno.test("resolve: file + import + transactions -> Import Studio", () => {
  const r = resolveConnectHandoff({
    source: "file",
    direction: "import",
    dataType: "transactions",
  });
  assert(r.ok);
  if (r.ok) assertEquals(r.href, "/integrations/imports/new");
});

Deno.test("resolve: file + export -> Export Center (no data type needed)", () => {
  const r = resolveConnectHandoff({ source: "file", direction: "export" });
  assert(r.ok);
  if (r.ok) assertEquals(r.href, "/integrations/exports");
});

Deno.test("resolve: two-way -> connected workbooks", () => {
  const r = resolveConnectHandoff({ source: "file", direction: "two_way" });
  assert(r.ok);
  if (r.ok) assertEquals(r.href, "/integrations/sync");
});

Deno.test("resolve: import of a not-yet-supported type is refused with a reason", () => {
  const r = resolveConnectHandoff({
    source: "file",
    direction: "import",
    dataType: "invoices",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.reason.length > 0);
});

Deno.test("resolve: a non-file source is refused", () => {
  const r = resolveConnectHandoff({ source: "api", direction: "import" });
  assertEquals(r.ok, false);
});

Deno.test("resolve: incomplete selection is refused, not thrown", () => {
  assertEquals(resolveConnectHandoff({}).ok, false);
  assertEquals(resolveConnectHandoff({ source: "file" }).ok, false);
  assertEquals(
    resolveConnectHandoff({ source: "file", direction: "import" }).ok,
    false,
  );
});
