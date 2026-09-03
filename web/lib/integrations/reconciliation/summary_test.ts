import { assertEquals } from "jsr:@std/assert@1";
import {
  buildReconciliationSummary,
  compareSections,
  RECON_SECTION_KEYS,
  type ReconSection,
  type ReconSectionInput,
} from "./summary.ts";

Deno.test("empty snapshot -> all four sections, all clear", () => {
  const summary = buildReconciliationSummary([]);
  assertEquals(summary.sections.length, 4);
  assertEquals(new Set(summary.sections.map((s) => s.key)), new Set(RECON_SECTION_KEYS));
  assertEquals(summary.totalOpen, 0);
  assertEquals(summary.totalCritical, 0);
  assertEquals(summary.worstSeverity, "clear");
  assertEquals(summary.allClear, true);
  for (const s of summary.sections) {
    assertEquals(s.severity, "clear");
    assertEquals(s.available, true);
  }
});

Deno.test("critical sorts ahead of attention ahead of clear", () => {
  const inputs: ReconSectionInput[] = [
    { key: "duplicates", openCount: 9, available: true },
    { key: "payments", openCount: 2, criticalCount: 1, available: true },
    { key: "sync_conflicts", openCount: 0, available: true },
    { key: "balance", openCount: 0, available: true },
  ];
  const summary = buildReconciliationSummary(inputs);
  assertEquals(summary.sections.map((s) => s.key), [
    "payments", // critical
    "duplicates", // attention, bigger backlog
    "balance", // clear, key tie-break
    "sync_conflicts", // clear
  ]);
  assertEquals(summary.worstSeverity, "critical");
  assertEquals(summary.totalOpen, 11);
  assertEquals(summary.totalCritical, 1);
  assertEquals(summary.allClear, false);
});

Deno.test("unavailable section contributes nothing and is forced clear", () => {
  const summary = buildReconciliationSummary([
    { key: "balance", openCount: 5, criticalCount: 3, available: false },
    { key: "duplicates", openCount: 1, available: true },
  ]);
  const balance = summary.sections.find((s) => s.key === "balance")!;
  assertEquals(balance.available, false);
  assertEquals(balance.openCount, 0);
  assertEquals(balance.criticalCount, 0);
  assertEquals(balance.severity, "clear");
  assertEquals(balance.oldestActionableAt, null);
  assertEquals(summary.totalOpen, 1);
  assertEquals(summary.worstSeverity, "attention");
});

Deno.test("criticalCount is clamped to openCount", () => {
  const summary = buildReconciliationSummary([
    { key: "sync_conflicts", openCount: 2, criticalCount: 9, available: true },
  ]);
  const section = summary.sections.find((s) => s.key === "sync_conflicts")!;
  assertEquals(section.criticalCount, 2);
  assertEquals(summary.totalCritical, 2);
});

Deno.test("within the same severity, older oldestActionableAt wins the tie after backlog", () => {
  const summary = buildReconciliationSummary([
    { key: "duplicates", openCount: 3, oldestActionableAt: "2026-05-01T00:00:00Z", available: true },
    { key: "payments", openCount: 3, oldestActionableAt: "2026-01-01T00:00:00Z", available: true },
  ]);
  assertEquals(summary.sections.slice(0, 2).map((s) => s.key), ["payments", "duplicates"]);
});

Deno.test("compareSections: null timestamp sorts after a real one", () => {
  const base = { title: "", description: "", href: "", criticalCount: 0, available: true } as const;
  const withTime: ReconSection = {
    ...base,
    key: "payments",
    openCount: 1,
    severity: "attention",
    oldestActionableAt: "2026-01-01T00:00:00Z",
  };
  const withoutTime: ReconSection = {
    ...base,
    key: "duplicates",
    openCount: 1,
    severity: "attention",
    oldestActionableAt: null,
  };
  assertEquals(compareSections(withTime, withoutTime) < 0, true);
  assertEquals(compareSections(withoutTime, withTime) > 0, true);
});

Deno.test("every section carries a link to an existing resolution surface", () => {
  const summary = buildReconciliationSummary([]);
  const hrefs = Object.fromEntries(summary.sections.map((s) => [s.key, s.href]));
  assertEquals(hrefs.balance, "/transactions/review");
  assertEquals(hrefs.payments, "/pay/reconciliation");
  assertEquals(hrefs.duplicates, "/transactions/review");
  assertEquals(hrefs.sync_conflicts, "/integrations/sync/conflicts");
});
