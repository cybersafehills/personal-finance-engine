import { assertEquals } from "jsr:@std/assert@1";
import {
  buildWebhookEnvelope,
  isKnownWebhookEvent,
  normalizeEventTypes,
  WEBHOOK_EVENTS,
} from "./events.ts";

Deno.test("event catalog is the documented set", () => {
  assertEquals(WEBHOOK_EVENTS, [
    "transaction.created",
    "import.committed",
    "export.completed",
    "accountant_package.completed",
    "ledger.synced",
    "reconciliation.flagged",
    "webhook.ping",
  ]);
});

Deno.test("isKnownWebhookEvent", () => {
  assertEquals(isKnownWebhookEvent("export.completed"), true);
  assertEquals(isKnownWebhookEvent("export.started"), false);
  assertEquals(isKnownWebhookEvent(""), false);
});

Deno.test("normalizeEventTypes drops unknowns, dedupes, canonical order", () => {
  assertEquals(
    normalizeEventTypes([
      "ledger.synced",
      "export.completed",
      "export.completed",
      "nope",
      99,
    ]),
    ["export.completed", "ledger.synced"],
  );
  assertEquals(normalizeEventTypes(null), []);
  assertEquals(normalizeEventTypes("export.completed"), []);
});

Deno.test("buildWebhookEnvelope frames without mutating data", () => {
  const data = { export_id: "e1", row_count: 5 };
  const env = buildWebhookEnvelope({
    deliveryId: "d1",
    type: "export.completed",
    workspaceId: "w1",
    data,
    now: new Date("2026-09-04T00:00:00.000Z"),
  });
  assertEquals(env, {
    id: "d1",
    type: "export.completed",
    created_at: "2026-09-04T00:00:00.000Z",
    workspace_id: "w1",
    data: { export_id: "e1", row_count: 5 },
  });
});
