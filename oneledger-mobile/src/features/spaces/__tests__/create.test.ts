import { parseSpacesEnabled } from "../config";
import { creatableKinds, KIND_COPY, MAX_SPACE_NAME_LENGTH, validateSpaceName } from "../create";

describe("validateSpaceName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateSpaceName("  Dolton   Household ")).toEqual({ ok: true, name: "Dolton Household" });
  });

  it("refuses an empty name", () => {
    expect(validateSpaceName("   ")).toEqual({ ok: false, message: "Enter a name." });
  });

  it("refuses an absurdly long name but allows the limit", () => {
    expect(validateSpaceName("a".repeat(MAX_SPACE_NAME_LENGTH)).ok).toBe(true);
    expect(validateSpaceName("a".repeat(MAX_SPACE_NAME_LENGTH + 1)).ok).toBe(false);
  });
});

describe("creatableKinds", () => {
  it("offers households only where Spaces is on, as the web does", () => {
    expect(creatableKinds(true)).toEqual(["household", "organization"]);
    expect(creatableKinds(false)).toEqual(["organization"]);
  });

  it("has the web's wording for each kind", () => {
    expect(KIND_COPY.household.nameLabel).toBe("Household name");
    expect(KIND_COPY.organization.action).toBe("Create organization");
  });
});

describe("parseSpacesEnabled", () => {
  it("is true only for an ok response with spaces: true", () => {
    expect(parseSpacesEnabled(200, { ok: true, config: { spaces: true } })).toBe(true);
    expect(parseSpacesEnabled(200, { ok: true, config: { spaces: false } })).toBe(false);
    expect(parseSpacesEnabled(200, { ok: true, config: {} })).toBe(false);
  });

  it("is false on any failure", () => {
    expect(parseSpacesEnabled(404, { ok: false })).toBe(false);
    expect(parseSpacesEnabled(200, null)).toBe(false);
    expect(parseSpacesEnabled(500, { ok: true, config: { spaces: true } })).toBe(false);
  });
});
