import { assertEquals } from "jsr:@std/assert@1";
import { buildPanelData, type PlanLike } from "./plan-state.ts";

const cap: PlanLike = {
  kind: "capacity",
  planned_parts: ["10000000", "10000000", "5000000"],
  total_amount_minor: "25000000",
  stopped_at: null,
};
const saving: PlanLike = {
  kind: "fee_saving",
  planned_parts: ["150000", "1000"],
  total_amount_minor: "151000",
  stopped_at: null,
};
const part = (i: number, amount: string, state: string) => ({
  split_index: i,
  amount_minor: amount,
  state,
});

Deno.test("plan state: the first part exists, the second waits for it", () => {
  let d = buildPanelData(cap, [part(1, "10000000", "awaiting_verification")]);
  assertEquals(d.next, { status: "waiting", index: 2, amountMinor: "10000000" });
  assertEquals(d.remainingMinor, "15000000");
  d = buildPanelData(cap, [part(1, "10000000", "successful")]);
  assertEquals(d.next, { status: "ready", index: 2, amountMinor: "10000000" });
});

Deno.test("plan state: complete once every part is prepared", () => {
  const parts = [
    part(1, "10000000", "successful"),
    part(2, "10000000", "successful"),
    part(3, "5000000", "draft"),
  ];
  const d = buildPanelData(cap, parts);
  assertEquals(d.next, { status: "complete" });
  assertEquals(d.remainingMinor, "0");
});

Deno.test("plan state: a failed or expired part blocks, never silently continues", () => {
  for (const state of ["failed", "expired", "reversed"]) {
    const d = buildPanelData(cap, [part(1, "10000000", state)]);
    assertEquals(d.next.status, "blocked");
  }
});

Deno.test("plan state: a stopped plan offers nothing", () => {
  const d = buildPanelData({ ...cap, stopped_at: "2026-12-01T00:00:00Z" }, [part(1, "10000000", "successful")]);
  assertEquals(d.next, { status: "stopped" });
  assertEquals(d.canSendRemaining, false);
});

Deno.test("plan state: send-the-rest-as-one only for fee-saving, after every part settled", () => {
  assertEquals(buildPanelData(cap, [part(1, "10000000", "successful")]).canSendRemaining, false);
  assertEquals(buildPanelData(saving, [part(1, "150000", "awaiting_verification")]).canSendRemaining, false);
  const ok = buildPanelData(saving, [part(1, "150000", "successful")]);
  assertEquals(ok.canSendRemaining, true);
  assertEquals(ok.remainingMinor, "1000");
});

Deno.test("plan state: cancelled parts do not count as prepared", () => {
  const d = buildPanelData(saving, [part(1, "150000", "successful"), part(2, "1000", "cancelled")]);
  assertEquals(d.remainingMinor, "1000");
  assertEquals(d.next.status, "ready");
});
