import { assertEquals } from "jsr:@std/assert@1";
import { activityHref, buildIntegrationActivity } from "./activity-model.ts";
import {
  isImportBatchOpen,
  isImportRecordCommittable,
} from "./model.ts";
import type { IntegrationEvent } from "./model.ts";

function event(overrides: Partial<IntegrationEvent>): IntegrationEvent {
  return {
    id: crypto.randomUUID(),
    workspaceId: "ws-1",
    kind: "import.uploaded",
    severity: "info",
    refType: null,
    refId: null,
    summary: "something happened",
    context: {},
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

Deno.test("activityHref maps a ref type to its owning workflow", () => {
  assertEquals(activityHref("import_batch", "b1"), "/integrations/imports/b1");
  assertEquals(activityHref("import_batch", null), "/integrations/imports");
  assertEquals(activityHref("export_job", "j1"), "/integrations/exports");
  assertEquals(
    activityHref("connector_installation", "i1"),
    "/integrations/connections",
  );
  assertEquals(activityHref(null, null), null);
  assertEquals(activityHref("mystery", "x"), null);
});

Deno.test("buildIntegrationActivity counts severities and resolves links", () => {
  const view = buildIntegrationActivity([
    event({ severity: "error", refType: "import_batch", refId: "b1" }),
    event({ severity: "warning" }),
    event({ severity: "info" }),
  ]);
  assertEquals(view.total, 3);
  assertEquals(view.errorCount, 1);
  assertEquals(view.warningCount, 1);
  assertEquals(view.items[0].href, "/integrations/imports/b1");
  assertEquals(view.items[1].href, null);
});

Deno.test("import batch open / record committable predicates", () => {
  assertEquals(isImportBatchOpen("uploaded"), true);
  assertEquals(isImportBatchOpen("previewed"), true);
  assertEquals(isImportBatchOpen("imported"), false);
  assertEquals(isImportBatchOpen("rolled_back"), false);
  assertEquals(isImportBatchOpen("failed"), false);

  assertEquals(isImportRecordCommittable("ready"), true);
  assertEquals(isImportRecordCommittable("approved"), true);
  assertEquals(isImportRecordCommittable("possible_duplicate"), false);
  assertEquals(isImportRecordCommittable("invalid"), false);
});
