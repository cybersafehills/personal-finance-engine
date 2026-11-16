import { assertEquals } from "jsr:@std/assert@1";
import {
  groupCounterpartyRows,
  parseCounterpartyListParams,
  parsePageParams,
} from "./mobile.ts";

const q = (s: string) => new URLSearchParams(s);
const row = (o: Record<string, unknown>) =>
  ({
    counterparty_id: "c1",
    display_name: "Sam",
    kind: "person",
    confidence: "high",
    currency: "RWF",
    sent_minor: 100,
    received_minor: 500,
    txn_count: 3,
    first_at: "2026-08-01T00:00:00Z",
    last_at: "2026-08-09T00:00:00Z",
    ...o,
  }) as Parameters<typeof groupCounterpartyRows>[0][number];

Deno.test("groups per counterparty, net per currency, string amounts, never mixes currencies", () => {
  const out = groupCounterpartyRows([
    row({}),
    row({
      currency: "USD",
      sent_minor: "250",
      received_minor: "0",
      txn_count: "1",
      first_at: "2026-07-01T00:00:00Z",
      last_at: "2026-08-20T00:00:00Z",
    }),
    row({
      counterparty_id: "c2",
      display_name: "Shop",
      kind: "merchant",
      sent_minor: 9000,
      received_minor: 0,
      txn_count: 2,
    }),
  ]);
  assertEquals(out.map((c) => c.id), ["c2", "c1"]); // by volume
  const sam = out[1];
  assertEquals(sam.currencies, [
    {
      currency: "RWF",
      sent_minor: "100",
      received_minor: "500",
      net_minor: "400",
      txn_count: 3,
    },
    {
      currency: "USD",
      sent_minor: "250",
      received_minor: "0",
      net_minor: "-250",
      txn_count: 1,
    },
  ]);
  assertEquals([sam.txn_count, sam.first_at, sam.last_at], [
    4,
    "2026-07-01T00:00:00Z",
    "2026-08-20T00:00:00Z",
  ]);
});

Deno.test("list params: paging, kind, search sanitising, workspace id", () => {
  const e = (s: string) => {
    const r = parseCounterpartyListParams(q(s));
    return r.ok ? "ok" : r.error;
  };
  assertEquals(e(""), "ok");
  assertEquals(e("limit=0"), "invalid_page");
  assertEquals(e("limit=101"), "invalid_page");
  assertEquals(e("offset=-1"), "invalid_page");
  assertEquals(e("kind=robot"), "invalid_kind");
  assertEquals(e("workspace_id=zzz"), "invalid_workspace");
  assertEquals(e("q=" + "x".repeat(81)), "invalid_query");
  assertEquals(e("q=%25%25"), "invalid_query"); // only wildcards -> nothing left
  const r = parseCounterpartyListParams(q("q=%25Sa_m%2C(x)&kind=person"));
  assertEquals(r.ok && r.value.q, "Sa m  x"); // wildcard/or-syntax characters neutralised
  assertEquals(parsePageParams(q("limit=10&offset=20")).ok, true);
});
