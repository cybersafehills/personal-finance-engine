import {
  filterCategoryOptions,
  mergeCategoryOptions,
  newCategoryCandidate,
  normalizeCategoryName,
} from "../options";

describe("normalizeCategoryName", () => {
  it("trims, collapses whitespace and caps the length", () => {
    expect(normalizeCategoryName("  Eating   out ")).toBe("Eating out");
    expect(normalizeCategoryName("   ")).toBe("");
    expect(normalizeCategoryName("x".repeat(100))).toHaveLength(60);
  });
});

describe("mergeCategoryOptions", () => {
  it("lists the workspace vocabulary first, then used names by frequency", () => {
    const out = mergeCategoryOptions(
      ["Rent", "Airtime"],
      ["Food", "Food", "Transport", "Food", "Transport", "Fun"],
    );
    expect(out).toEqual(["Airtime", "Rent", "Food", "Transport", "Fun"]);
  });

  it("de-duplicates case-insensitively keeping the first spelling", () => {
    expect(mergeCategoryOptions(["Food"], ["food", "FOOD", "Transport"])).toEqual(["Food", "Transport"]);
  });

  it("never offers Uncategorized, blanks or nulls", () => {
    expect(mergeCategoryOptions(["Uncategorized", " "], [null, "uncategorized", "Bills"])).toEqual(["Bills"]);
  });
});

describe("filterCategoryOptions", () => {
  it("matches any part of a name, ignoring case", () => {
    expect(filterCategoryOptions(["Food", "Fast food", "Rent"], "FOO")).toEqual(["Food", "Fast food"]);
    expect(filterCategoryOptions(["Food", "Rent"], "  ")).toEqual(["Food", "Rent"]);
  });
});

describe("newCategoryCandidate", () => {
  it("offers a name that does not exist yet", () => {
    expect(newCategoryCandidate(["Food"], "  School  fees ")).toBe("School fees");
  });
  it("offers nothing for an existing, empty or reserved name", () => {
    expect(newCategoryCandidate(["Food"], "food")).toBeNull();
    expect(newCategoryCandidate(["Food"], "  ")).toBeNull();
    expect(newCategoryCandidate(["Food"], "Uncategorized")).toBeNull();
  });
});
