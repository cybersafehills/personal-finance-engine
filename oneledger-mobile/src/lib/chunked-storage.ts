// Supabase session storage on top of a small key/value store.
//
// A Supabase session (two JWTs + user object) can exceed what a single
// keychain entry reliably holds on some iOS versions (~2 KB), so values are
// split into chunks: `<key>.n` holds the chunk count, `<key>.0..n-1` the
// parts. Pure and store-agnostic so it is unit-testable.

export type KeyValueStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/** The storage interface supabase-js expects. */
export type AsyncStringStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const DEFAULT_CHUNK_SIZE = 1800;

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function createChunkedStorage(
  store: KeyValueStore,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): AsyncStringStorage {
  const countKey = (key: string) => `${safeKey(key)}.n`;
  const partKey = (key: string, index: number) => `${safeKey(key)}.${index}`;

  async function readCount(key: string): Promise<number> {
    const raw = await store.get(countKey(key));
    const count = raw === null ? 0 : Number(raw);
    return Number.isInteger(count) && count > 0 ? count : 0;
  }

  async function removeItem(key: string): Promise<void> {
    const count = await readCount(key);
    for (let i = 0; i < count; i++) await store.remove(partKey(key, i));
    await store.remove(countKey(key));
  }

  return {
    async getItem(key) {
      const count = await readCount(key);
      if (count === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await store.get(partKey(key, i));
        // A missing chunk means a torn write; treat the value as absent
        // rather than hand back a corrupt session.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    },

    async setItem(key, value) {
      const previous = await readCount(key);
      const count = Math.max(1, Math.ceil(value.length / chunkSize));
      for (let i = 0; i < count; i++) {
        await store.set(
          partKey(key, i),
          value.slice(i * chunkSize, (i + 1) * chunkSize),
        );
      }
      await store.set(countKey(key), String(count));
      for (let i = count; i < previous; i++) {
        await store.remove(partKey(key, i));
      }
    },

    removeItem,
  };
}
