import { FEATURED_SLUGS, pinFeatured } from "../featured";

describe("pinFeatured", () => {
  const list = [{ slug: "a" }, { slug: "b" }, { slug: "ekash-mtn-send" }, { slug: "c" }];

  it("puts the eKash code first and leaves everything else in its order", () => {
    expect(pinFeatured(list).map((c) => c.slug)).toEqual(["ekash-mtn-send", "a", "b", "c"]);
  });
  it("changes nothing when no featured code is in the list (a search, say)", () => {
    const other = [{ slug: "x" }, { slug: "y" }];
    expect(pinFeatured(other)).toEqual(other);
  });
  it("does not modify the list it is given", () => {
    const before = list.map((c) => c.slug);
    pinFeatured(list);
    expect(list.map((c) => c.slug)).toEqual(before);
  });
  it("pins the MTN eKash code that carries the receiver's ID, *182*1*2*{receiver}#", () => {
    expect(FEATURED_SLUGS[0]).toBe("ekash-mtn-send");
  });
});
