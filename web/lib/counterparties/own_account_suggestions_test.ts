import { assertEquals } from "jsr:@std/assert@1";
import {
  type OwnAccountCandidate,
  suggestByName,
  topSourcesOfMoneyIn,
} from "./own-account-suggestions.ts";

const c = (
  id: string,
  name: string,
  over: Partial<OwnAccountCandidate> = {},
): OwnAccountCandidate => ({
  id,
  name,
  kind: "unknown",
  receivedRwf: 0,
  sentRwf: 0,
  txnCount: 1,
  ...over,
});

Deno.test("name match: the plain name and the doubled bank form both match, others do not", () => {
  const out = suggestByName(
    [
      c("a", "ANNA KAMANZI", { txnCount: 20 }),
      c("b", "ANNA KAMANZI ANNA KAMANZI", { txnCount: 8 }),
      c("c", "Anna Mukamana", { txnCount: 30 }),
      c("d", "KAMANZI", { txnCount: 5 }),
    ],
    "Anna Kamanzi",
  );
  assertEquals(out.map((s) => s.id), ["a", "b"]);
});

Deno.test("name match needs two words of your name; one shared word is not enough", () => {
  assertEquals(suggestByName([c("a", "Anna")], "Anna Kamanzi"), []);
  assertEquals(suggestByName([c("a", "ANNA KAMANZI")], "Anna"), []);
  assertEquals(suggestByName([c("a", "ANNA KAMANZI")], null), []);
});

Deno.test("accents and case are ignored; extra words in their name rule it out", () => {
  assertEquals(suggestByName([c("a", "ANNA KAMÁNZI")], "anna kamanzi").length, 1);
  assertEquals(suggestByName([c("a", "ANNA KAMANZI LTD")], "Anna Kamanzi"), []);
});

Deno.test("already-marked and merchants are never suggested", () => {
  const out = suggestByName(
    [
      c("a", "ANNA KAMANZI", { kind: "self" }),
      c("b", "ANNA KAMANZI", { kind: "merchant" }),
    ],
    "Anna Kamanzi",
  );
  assertEquals(out, []);
  assertEquals(
    topSourcesOfMoneyIn([
      c("a", "X", { kind: "self", receivedRwf: 9 }),
      c("b", "Y", { kind: "merchant", receivedRwf: 9 }),
    ]),
    [],
  );
});

Deno.test("top sources of money in: biggest first, capped, zero senders left out", () => {
  const out = topSourcesOfMoneyIn(
    [
      c("a", "A", { receivedRwf: 100 }),
      c("b", "B", { receivedRwf: 5000 }),
      c("z", "Z", { receivedRwf: 0 }),
      c("d", "D", { receivedRwf: 900 }),
    ],
    2,
  );
  assertEquals(out.map((s) => s.id), ["b", "d"]);
});
