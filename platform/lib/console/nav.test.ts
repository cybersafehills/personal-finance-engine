import assert from "node:assert/strict";
import test from "node:test";
import { activeHref, breadcrumbFor, resolveNav } from "./nav.ts";

const owner = {
  role: "platform_owner" as const,
  permissions: ["view_aggregate_metrics", "view_audit_logs", "view_staff", "view_customer_metadata", "view_system_health"],
};
const flat = (a: Parameters<typeof resolveNav>[0]) => resolveNav(a).flatMap((g) => g.items);

test("built modules the role cannot use are omitted, never shown as links", () => {
  const items = flat({ role: "support_agent", permissions: ["view_aggregate_metrics"] });
  assert.equal(items.find((i) => i.label === "Executive Dashboard")?.state, "link");
  assert.equal(items.find((i) => i.label === "Audit Logs"), undefined);
  assert.equal(items.find((i) => i.label === "System Health"), undefined);
  assert.equal(items.find((i) => i.label === "Security Center"), undefined);
});

test("unbuilt modules are non-interactive 'soon' entries without an href", () => {
  const soon = flat(owner).filter((i) => i.state === "soon");
  assert.ok(soon.length > 0);
  assert.ok(soon.every((i) => i.href === undefined));
});

test("longest prefix wins so /security/audit-logs does not highlight Security Center", () => {
  const groups = resolveNav(owner);
  assert.equal(activeHref("/security/audit-logs", groups), "/security/audit-logs");
  assert.equal(activeHref("/security", groups), "/security");
  assert.equal(activeHref("/customers/users/abc", groups), "/customers/users");
  assert.equal(activeHref("/nope", groups), null);
});

test("breadcrumb resolves group and label", () => {
  assert.deepEqual(breadcrumbFor("/customers/organizations", resolveNav(owner)), {
    group: "Customers",
    label: "Organizations",
  });
});

test("every nav label is unique", () => {
  const labels = flat(owner).map((i) => i.label);
  assert.equal(new Set(labels).size, labels.length);
});

test("Partners & Placements is a link only for roles holding view_partners", () => {
  const withIt = flat({ role: "platform_admin", permissions: ["view_partners"] });
  assert.equal(withIt.find((i) => i.label === "Partners & Placements")?.href, "/platform/partners");
  const without = flat({ role: "support_agent", permissions: ["view_aggregate_metrics"] });
  assert.equal(without.find((i) => i.label === "Partners & Placements"), undefined);
});
