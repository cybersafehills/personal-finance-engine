import { DEFAULT_PREFERENCE, loadPreference, normalizePreference, resolveScheme, savePreference } from "../preference";

const mockStore = new Map<string, string>();
jest.mock("@/lib/device-store", () => ({
  deviceStore: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: string) => void mockStore.set(k, v),
    remove: async (k: string) => void mockStore.delete(k),
  },
}));

beforeEach(() => mockStore.clear());

describe("resolveScheme", () => {
  it("follows the phone on Automatic", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
  });
  it("uses light when the phone cannot say", () => {
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", undefined)).toBe("light");
  });
  it("lets a forced choice win over the phone", () => {
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });
});

describe("normalizePreference", () => {
  it("keeps the three valid values and turns anything else into Automatic", () => {
    for (const v of ["system", "light", "dark"] as const) expect(normalizePreference(v)).toBe(v);
    for (const bad of [null, undefined, "", "blue", 3, {}, "DARK"]) expect(normalizePreference(bad)).toBe(DEFAULT_PREFERENCE);
  });
  it("defaults to Automatic", () => expect(DEFAULT_PREFERENCE).toBe("system"));
});

describe("saving", () => {
  it("round-trips the choice", async () => {
    await savePreference("dark");
    expect(await loadPreference()).toBe("dark");
  });
  it("is Automatic when nothing is saved or what is saved is corrupt", async () => {
    expect(await loadPreference()).toBe("system");
    mockStore.set("ol.theme.v1", "{not json");
    expect(await loadPreference()).toBe("system");
    mockStore.set("ol.theme.v1", JSON.stringify("purple"));
    expect(await loadPreference()).toBe("system");
  });
});
