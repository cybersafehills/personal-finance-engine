import { MORE_GROUPS, parseMoreFlags, visibleGroups } from "../groups";

const labels = (flags: Parameters<typeof visibleGroups>[0]) =>
  visibleGroups(flags).flatMap((g) => g.links.map((l) => l.label));

describe("visibleGroups", () => {
  it("keeps the old statement fallback but hides opt-in features when unknown", () => {
    expect(labels(null)).toContain("Statements");
    expect(labels(null)).not.toContain("Insights");
    expect(labels(null)).not.toContain("Wallets");
    expect(labels(null)).not.toContain("Payment requests");
  });

  it("hides only features the server says are off", () => {
    expect(labels({ statements: false, insightsCenter: true })).not.toContain("Statements");
    expect(labels({ statements: false, insightsCenter: true })).toContain("Insights");
    expect(labels({})).toContain("Statements");
  });

  it("drops a group that ends up empty", () => {
    const titles = visibleGroups({ statements: false }).map((g) => g.title);
    expect(titles).toContain("Reports and statements");
    const all = visibleGroups({ statements: false, insights: false }).flatMap((g) => g.links);
    expect(all.every((l) => l.requires !== "statements")).toBe(true);
  });

  it("lists each destination once", () => {
    const routes = MORE_GROUPS.flatMap((g) => g.links.map((l) => l.route));
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe("Bills (dark by default)", () => {
  it("shows only on an explicit true", () => {
    expect(labels(null)).not.toContain("Bills");
    expect(labels({})).not.toContain("Bills");
    expect(labels({ bills: false })).not.toContain("Bills");
    expect(labels({ bills: true })).toContain("Bills");
  });
});

describe("parseMoreFlags", () => {
  it("keeps only boolean flags", () => {
    expect(parseMoreFlags(200, { ok: true, config: { statements: false, insights: "yes", spaces: true } })).toEqual({
      statements: false,
      spaces: true,
    });
  });

  it("returns null for anything unusable", () => {
    expect(parseMoreFlags(404, { ok: false })).toBeNull();
    expect(parseMoreFlags(200, null)).toBeNull();
    expect(parseMoreFlags(200, { ok: true })).toBeNull();
  });
});
