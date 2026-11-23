import { parsePartnerFeed } from "../model";

const offer = { id: "o1", brandId: "b", brand: "B", category: "Connectivity", title: "T", benefit: "x", eligibility: "e", terms: "t", destination: "https://example.com", endsOn: "2030-01-01" };
const feed = (placement: Record<string, unknown>) => parsePartnerFeed({ enabled: true, offers: [offer], placements: [{ id: "pay-person", ...placement }] });

it("accepts a single half-width square and a top position from the platform", () => {
  const config = feed({ format: "half", position: "top" }).placements["pay-person"];
  expect(config.format).toBe("half");
  expect(config.position).toBe("top");
});
it("accepts the slim bar for the pay screens", () => {
  expect(feed({ format: "bar" }).placements["pay-person"].format).toBe("bar");
});
it("falls back to the bottom and the default format for anything unknown", () => {
  const config = feed({ format: "huge", position: "sideways" }).placements["pay-person"];
  expect(config.position).toBe("bottom");
  expect(config.format).toBe("square");
});
