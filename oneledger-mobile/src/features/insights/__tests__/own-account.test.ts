import type { Person, PersonKind } from "@/features/people/types";

import { topIncomeSources } from "../own-account";

function person(id: string, name: string, kind: PersonKind, received: bigint, currency: "RWF" | "USD" = "RWF"): Person {
  return {
    id, displayName: name, kind, confidence: "high", txnCount: 3, firstAt: null, lastAt: null,
    currencies: [{ currency, sentMinor: 0n, receivedMinor: received, netMinor: received, txnCount: 3 }],
  };
}

describe("topIncomeSources", () => {
  it("ranks the biggest RWF senders first and skips merchants, marked accounts and non-senders", () => {
    const out = topIncomeSources([
      person("a", "Anna", "person", 5_000n),
      person("b", "Boris", "unknown", 90_000n),
      person("c", "Shop", "merchant", 999_999n),
      person("d", "Me", "self", 999_999n),
      person("e", "Nobody", "person", 0n),
      person("f", "Dollar Dan", "person", 777_777n, "USD"),
    ]);
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
  });
  it("breaks ties by name and caps the list", () => {
    const many = Array.from({ length: 8 }, (_, i) => person(String(i), `P${7 - i}`, "person", 100n));
    const out = topIncomeSources(many, 5);
    expect(out).toHaveLength(5);
    expect(out.map((s) => s.name)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });
  it("compares amounts as bigint, exactly", () => {
    const out = topIncomeSources([person("a", "A", "person", 9_007_199_254_740_993n), person("b", "B", "person", 9_007_199_254_740_992n)]);
    expect(out[0].id).toBe("a");
  });
});
