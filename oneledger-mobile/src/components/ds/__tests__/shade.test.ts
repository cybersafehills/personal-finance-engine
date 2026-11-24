import { shade } from "../BrandIcon";

it("darkens toward black and leaves non-hex values alone", () => {
  expect(shade("#ffffff", 0.5)).toBe("#808080");
  expect(shade("#000000", 0.5)).toBe("#000000");
  expect(shade("red", 0.5)).toBe("red");
});
