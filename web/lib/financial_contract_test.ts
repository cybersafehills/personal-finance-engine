import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  completePages,
  currencyFlows,
  formatAmount,
} from "../../shared/financial.ts";
import fixture from "../../shared/financial-fixtures.json" with {
  type: "json",
};
Deno.test("golden currency and transfer contract", () => {
  for (const f of fixture.format) {
    assertEquals(formatAmount(f.minor, f.currency, false), f.display);
  }
  assertEquals(currencyFlows(fixture.rows), fixture.expected);
  assertThrows(() => formatAmount(Number.MAX_SAFE_INTEGER + 1, "RWF"));
  assertThrows(() =>
    currencyFlows([{ ...fixture.rows[0], principal_effect_rwf: null }])
  );
});
for (const count of [999, 1000, 1001, 20001]) {
  Deno.test(`complete paging includes ${count} rows under a smaller API cap`, async () => {
    const source = Array.from({ length: count }, (_, id) => id);
    const rows = await completePages(async (offset, size) =>
      source.slice(offset, offset + Math.min(size, 137))
    );
    assertEquals(rows, source);
  });
}
Deno.test("read failure and coverage ceiling are never financial zero", async () => {
  await assertRejects(() =>
    completePages(() => Promise.reject(new Error("unavailable")))
  );
  await assertRejects(() => completePages(async () => [1, 2], 1));
});

Deno.test("disposable acceptance facts cover two Spaces and 20,001 household entries", async () => {
  const { goldenAcceptance } = await import(
    "../../shared/golden-acceptance.ts"
  );
  const fixture = goldenAcceptance();
  assertEquals(
    currencyFlows(
      fixture.rows.filter((r) => r.workspace_id === fixture.spaces[0].id),
    ),
    fixture.expectedPersonal,
  );
  assertEquals(
    currencyFlows(
      fixture.rows.filter((r) => r.workspace_id === fixture.spaces[1].id),
    ),
    fixture.expectedHousehold,
  );
  assertEquals(
    fixture.boundaryBefore.occurred_at < fixture.period.startUtc,
    true,
  );
  assertEquals(fixture.wallets.length, 5);
});
