import {
  createChunkedStorage,
  safeKey,
  type KeyValueStore,
} from "../chunked-storage";

function memoryStore() {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
  return { map, store };
}

describe("createChunkedStorage", () => {
  it("round-trips a value larger than one chunk", async () => {
    const { map, store } = memoryStore();
    const storage = createChunkedStorage(store, 10);
    const value = "abcdefghijklmnopqrstuvwxyz";
    await storage.setItem("sb-session", value);
    expect(await storage.getItem("sb-session")).toBe(value);
    expect(map.get("sb-session.n")).toBe("3");
    for (const part of map.values()) expect(part.length).toBeLessThanOrEqual(10);
  });

  it("returns null for a key that was never set", async () => {
    const storage = createChunkedStorage(memoryStore().store);
    expect(await storage.getItem("missing")).toBeNull();
  });

  it("drops stale chunks when a shorter value replaces a longer one", async () => {
    const { map, store } = memoryStore();
    const storage = createChunkedStorage(store, 4);
    await storage.setItem("k", "0123456789ab");
    await storage.setItem("k", "xy");
    expect(await storage.getItem("k")).toBe("xy");
    expect([...map.keys()].sort()).toEqual(["k.0", "k.n"]);
  });

  it("removes every chunk", async () => {
    const { map, store } = memoryStore();
    const storage = createChunkedStorage(store, 4);
    await storage.setItem("k", "0123456789");
    await storage.removeItem("k");
    expect(map.size).toBe(0);
    expect(await storage.getItem("k")).toBeNull();
  });

  it("treats a torn write (missing chunk) as absent", async () => {
    const { map, store } = memoryStore();
    const storage = createChunkedStorage(store, 4);
    await storage.setItem("k", "0123456789");
    map.delete("k.1");
    expect(await storage.getItem("k")).toBeNull();
  });

  it("stores an empty string", async () => {
    const storage = createChunkedStorage(memoryStore().store);
    await storage.setItem("k", "");
    expect(await storage.getItem("k")).toBe("");
  });

  it("sanitises keys to what the keychain accepts", () => {
    expect(safeKey("sb-abc:auth/token")).toBe("sb-abc_auth_token");
  });
});
