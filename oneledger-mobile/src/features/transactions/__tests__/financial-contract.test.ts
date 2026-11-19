import { goldenAcceptance } from "../../../../../shared/golden-acceptance";
import { currencyFlows, completePages, formatAmount } from "../../../../../shared/financial";
import fixture from "../../../../../shared/financial-fixtures.json";
it("uses the same financial golden vectors as the web", () => {
  for (const f of fixture.format) expect(formatAmount(f.minor, f.currency, false)).toBe(f.display);
  expect(currencyFlows(fixture.rows)).toEqual(fixture.expected);
});
it.each([999, 1000, 1001, 20001])("reads all %i rows despite a smaller page cap", async (count) => {
  const rows = Array.from({ length: count }, (_, id) => id);
  expect(await completePages(async (offset, size) => rows.slice(offset, offset + Math.min(size, 137)))).toEqual(rows);
});

it("projects the shared large acceptance facts separately per Space", async () => {
  const fixture = goldenAcceptance();
  expect(currencyFlows(fixture.rows.filter((r) => r.workspace_id === fixture.spaces[0].id))).toEqual(fixture.expectedPersonal);
  expect(currencyFlows(fixture.rows.filter((r) => r.workspace_id === fixture.spaces[1].id))).toEqual(fixture.expectedHousehold);
});
