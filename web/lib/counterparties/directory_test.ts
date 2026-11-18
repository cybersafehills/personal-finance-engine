import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  confidenceLabel,
  confidenceNote,
  directoryHref,
  flowParts,
  flowText,
  formatMinor,
  friendlyPeopleError,
  isCounterpartiesEnabledFor,
  isUuid,
  PAGE_SIZE,
  pageWindow,
  parseDirectoryQuery,
} from "./directory.ts";

const WS = "11111111-1111-4111-8111-111111111111";

Deno.test("flag: off unless exactly 'true'; allowlist narrows, never enables", () => {
  assertEquals(isCounterpartiesEnabledFor({}, WS), false);
  assertEquals(
    isCounterpartiesEnabledFor({ COUNTERPARTIES_ENABLED: "1" }, WS),
    false,
  );
  assertEquals(
    isCounterpartiesEnabledFor({ COUNTERPARTIES_WORKSPACE_ALLOWLIST: WS }, WS),
    false,
  );
  assertEquals(
    isCounterpartiesEnabledFor({ COUNTERPARTIES_ENABLED: "true" }, WS),
    true,
  );
  const env = {
    COUNTERPARTIES_ENABLED: "true",
    COUNTERPARTIES_WORKSPACE_ALLOWLIST: ` ${WS} , other `,
  };
  assertEquals(isCounterpartiesEnabledFor(env, WS), true);
  assertEquals(
    isCounterpartiesEnabledFor(env, "22222222-2222-4222-8222-222222222222"),
    false,
  );
  assertEquals(isCounterpartiesEnabledFor(env, null), false);
});

Deno.test("formatMinor: scales by the currency, never guesses for unknown ones", () => {
  // RWF reads like Home and Insights ("5,000 RWF"), not Intl's "RF 5,000".
  assertEquals(formatMinor("10100", "RWF"), "10,100 RWF");
  assertEquals(formatMinor(-5000n, "RWF"), "\u22125,000 RWF");
  assertEquals(formatMinor(0n, "RWF"), "0 RWF");
  assertEquals(formatMinor(2500n, "USD").includes("25.00"), true);
  // An unsupported currency is shown raw with its code, not rescaled.
  assertEquals(formatMinor("2500", "KES"), "KES 2500");
});

Deno.test("flowText: sent, received, both, or nothing", () => {
  const base = { currency: "RWF", net_minor: "0", txn_count: 1 };
  assertEquals(
    flowText({ ...base, sent_minor: "0", received_minor: "0" }),
    "No money moved",
  );
  assert(
    flowText({ ...base, sent_minor: "10100", received_minor: "0" }).startsWith(
      "You sent ",
    ),
  );
  assert(
    flowText({ ...base, sent_minor: "0", received_minor: "5000" }).startsWith(
      "You received ",
    ),
  );
  assert(
    flowText({ ...base, sent_minor: "10", received_minor: "20" }).includes(
      " · ",
    ),
  );
});

Deno.test("confidence copy matches the app", () => {
  assertEquals(confidenceLabel("user_confirmed"), "You confirmed this");
  assertEquals(confidenceLabel("high"), "Matched by phone number or code");
  assertEquals(confidenceLabel("low"), "Matched by name only");
  assertEquals(confidenceNote("high"), null);
  assertEquals(confidenceNote("user_confirmed"), null);
  assert(confidenceNote("low")!.includes("same name"));
});

Deno.test("friendlyPeopleError: a safe sentence for each refusal, never raw text", () => {
  assert(
    friendlyPeopleError("counterparty_merged").includes("already combined"),
  );
  assert(
    friendlyPeopleError("merge_state_changed").includes(
      "Undo the later change",
    ),
  );
  assert(
    friendlyPeopleError("split_state_changed").includes(
      "Undo the later change",
    ),
  );
  assert(friendlyPeopleError("split_would_empty").includes("Rename"));
  assert(friendlyPeopleError("already_undone").includes("already undone"));
  assert(friendlyPeopleError("invalid_merge").includes("isn't allowed"));
  assert(
    friendlyPeopleError("counterparty_not_found").includes("couldn't be found"),
  );
  const raw = 'duplicate key value violates "secret_constraint" at row 42';
  assertEquals(friendlyPeopleError(raw).includes("secret_constraint"), false);
  assertEquals(friendlyPeopleError(null), friendlyPeopleError(""));
});

Deno.test("parseDirectoryQuery: lenient, strips ILIKE wildcards, bounds everything", () => {
  assertEquals(parseDirectoryQuery({}), { q: null, kind: null, page: 1 });
  assertEquals(
    parseDirectoryQuery({ q: " Jean ", kind: "person", page: "3" }),
    { q: "Jean", kind: "person", page: 3 },
  );
  assertEquals(parseDirectoryQuery({ q: "%_\\,()*" }).q, null);
  assertEquals(parseDirectoryQuery({ q: "a%b_c" }).q, "a b c");
  assertEquals(parseDirectoryQuery({ q: "x".repeat(200) }).q!.length, 80);
  assertEquals(parseDirectoryQuery({ kind: "admin" }).kind, null);
  for (const bad of ["0", "-1", "1.5", "abc", "99999999", ""]) {
    assertEquals(parseDirectoryQuery({ page: bad }).page, 1, bad);
  }
  // Repeated params take the first value.
  assertEquals(parseDirectoryQuery({ q: ["a", "b"], page: ["2", "9"] }), {
    q: "a",
    kind: null,
    page: 2,
  });
});

Deno.test("directoryHref: only non-default parts, and it round-trips", () => {
  assertEquals(directoryHref({ q: null, kind: null, page: 1 }), "/people");
  assertEquals(
    directoryHref({ q: "Jean", kind: "merchant", page: 2 }),
    "/people?q=Jean&kind=merchant&page=2",
  );
  const q = { q: "a&b=c", kind: "person" as const, page: 4 };
  const url = new URL(directoryHref(q), "http://x");
  const back = parseDirectoryQuery(Object.fromEntries(url.searchParams));
  assertEquals(back, q);
});

Deno.test("pageWindow and isUuid", () => {
  assertEquals(pageWindow(1), { limit: PAGE_SIZE, offset: 0 });
  assertEquals(pageWindow(3), { limit: PAGE_SIZE, offset: 2 * PAGE_SIZE });
  assert(isUuid(WS));
  assertEquals(isUuid("not-a-uuid"), false);
  assertEquals(isUuid(`${WS}; drop table`), false);
});

Deno.test("flowParts keeps amounts apart from labels so a page can mask them", () => {
  const base = { currency: "RWF", net_minor: "0", txn_count: 1 };
  assertEquals(
    flowParts({ ...base, sent_minor: "0", received_minor: "0" }),
    [],
  );
  const both = flowParts({
    ...base,
    sent_minor: "10100",
    received_minor: "5000",
  });
  assertEquals(both.map((p) => p.label), ["You sent", "You received"]);
  // The label never carries the figure; the amount is a separate field.
  assertEquals(both.every((p) => !/\d/.test(p.label)), true);
  assertEquals(both[0].amount.includes("10,100"), true);
  // flowText is exactly the parts joined, so the two cannot drift.
  assertEquals(
    flowText({ ...base, sent_minor: "10100", received_minor: "5000" }),
    `${both[0].label} ${both[0].amount} · ${both[1].label} ${both[1].amount}`,
  );
});

Deno.test("'self' is a kind, is labelled for people, and is reported to the mobile app as a person", async () => {
  const d = await import("./directory.ts");
  assertEquals(d.isPersonKind("self"), true);
  assertEquals(d.KIND_LABEL.self, "My account");
  assertEquals(d.kindForMobile("self"), "person");
  assertEquals(d.kindForMobile("merchant"), "merchant");
});
