import assert from "node:assert/strict";
import test from "node:test";
import { resolveNav } from "./nav.ts";

const flat = (access: Parameters<typeof resolveNav>[0]) =>
  resolveNav(access).flatMap((g) => g.items);

test("built modules the role cannot use are omitted, never shown as links", () => {
  const items = flat({ role: "support_agent", permissions: ["view_aggregate_metrics"] });
  assert.ok(items.find((i) => i.label === "Executive Dashboard")?.state === "link");
  assert.equal(items.find((i) => i.label === "Audit Logs"), undefined);
  assert.equal(items.find((i) => i.label === "System Health"), undefined);
});

test("unbuilt modules are non-interactive 'soon' entries without an href", () => {
  const items = flat({ role: "platform_owner", permissions: ["view_audit_logs"] });
  const soon = items.filter((i) => i.state === "soon");
  assert.ok(soon.length > 0);
  assert.ok(soon.every((i) => i.href === undefined));
});
