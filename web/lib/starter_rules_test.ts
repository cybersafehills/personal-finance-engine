import { assertEquals } from "jsr:@std/assert@1";
import {
  newRuleHref,
  proposeStarterRules,
  type StarterTxn,
} from "./starter-rules.ts";

const u = (
  name: string | null,
  amountRwf = 1000,
  direction = "out",
): StarterTxn => ({
  counterpartyName: name,
  direction,
  amountRwf,
  category: null,
});
const c = (name: string, category: string): StarterTxn => ({
  counterpartyName: name,
  direction: "out",
  amountRwf: 1000,
  category,
});

Deno.test("groups by counterparty, biggest first, one-offs are not proposed", () => {
  const r = proposeStarterRules(
    [
      u("Shop A"),
      u("shop a "),
      u("Shop A"),
      u("Cafe B"),
      u("Cafe B"),
      u("One Off"),
    ],
    [],
  );
  assertEquals(r.proposals.map((p) => [p.key, p.txnCount]), [["shop a", 3], [
    "cafe b",
    2,
  ]]);
  assertEquals(r.coveredCount, 5);
  assertEquals(r.totalUncategorized, 6);
});

Deno.test("nameless transactions are counted, never grouped", () => {
  const r = proposeStarterRules([
    u(null),
    u(""),
    u("  "),
    u("Shop A"),
    u("Shop A"),
  ], []);
  assertEquals(r.nameless, 3);
  assertEquals(r.proposals.length, 1);
});

Deno.test("suggests a category only with a clear majority of at least two examples", () => {
  const unc = [u("Taxi Co"), u("Taxi Co")];
  const strong = proposeStarterRules(unc, [
    c("Taxi Co", "Transport"),
    c("taxi co", "Transport"),
    c("Taxi Co", "Transport"),
    c("Taxi Co", "Fun"),
  ]);
  assertEquals(strong.proposals[0].suggestedCategory, "Transport");
  assertEquals(
    strong.proposals[0].suggestionBasis,
    "3 of your 4 other transactions with this name are in Transport.",
  );

  const split = proposeStarterRules(unc, [
    c("Taxi Co", "Transport"),
    c("Taxi Co", "Fun"),
  ]);
  assertEquals(split.proposals[0].suggestedCategory, null);

  const single = proposeStarterRules(unc, [c("Taxi Co", "Transport")]);
  assertEquals(single.proposals[0].suggestedCategory, null);
});

Deno.test("direction is in, out or mixed", () => {
  const r = proposeStarterRules([
    u("A", 1, "in"),
    u("A", 1, "in"),
    u("B", 1, "in"),
    u("B", 1, "out"),
  ], []);
  const by = Object.fromEntries(r.proposals.map((p) => [p.key, p.direction]));
  assertEquals(by, { a: "in", b: "mixed" });
});

Deno.test("max caps the list; the link prefills the New rule form and leaves category blank when unknown", () => {
  const many = Array.from({ length: 10 }, (_, i) => [u(`P${i}`), u(`P${i}`)])
    .flat();
  assertEquals(proposeStarterRules(many, [], { max: 3 }).proposals.length, 3);
  const [p] = proposeStarterRules([u("Shop A"), u("Shop A")], []).proposals;
  const href = newRuleHref(p);
  assertEquals(href.startsWith("/categories/rules/new?template=learned"), true);
  assertEquals(href.includes("category="), false);
  assertEquals(href.includes("pattern=Shop+A"), true);
});

Deno.test("totalProposals counts every qualifying name even when the list is capped", () => {
  const many = Array.from({ length: 10 }, (_, i) => [u(`P${i}`), u(`P${i}`)])
    .flat();
  const r = proposeStarterRules(many, [], { max: 3 });
  assertEquals(r.proposals.length, 3);
  assertEquals(r.totalProposals, 10);
});
