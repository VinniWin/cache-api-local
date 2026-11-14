import type { Store } from "./types";

/**
 * Persists entries in `localStorage` (or any `Storage`, e.g. `sessionStorage`), so a page reload keeps the cache.
 * Values must be JSON-serializable. Needs `crypto.subtle`: browsers on HTTPS or localhost, Node 19+, Deno, Bun.
 */
export function webStore({
  storage = localStorage,
  prefix = "cache-api-local:",
}: { storage?: Storage; prefix?: string } = {}): Store {
  // The key itself is never stored: the default key can contain an Authorization header.
  const name = async (key: string) =>
    prefix + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))));

  // Only our own items, so the rest of the site's storage is never touched.
  const clear = () => {
    for (let i = storage.length - 1; i >= 0; i--) {
      const item = storage.key(i);
      if (item?.startsWith(prefix)) storage.removeItem(item);
    }
  };

  return {
    async get(key) {
      try {
        const { time, value, etag, tags, maxAge } = JSON.parse(storage.getItem(await name(key))!);
        return { time, value, etag, tags, maxAge };
      } catch {
        return undefined; // missing or unreadable item counts as a miss
      }
    },
    async set(key, { time, value, etag, tags, maxAge }) {
      const item = await name(key);
      const data = JSON.stringify({ time, value, etag, tags, maxAge }); // undefined fields are left out
      try {
        storage.setItem(item, data);
      } catch {
        // Storage is full (about 5 MB per origin): drop our entries and try once more, or caching would stop for good.
        clear();
        storage.setItem(item, data);
      }
    },
    async delete(key) {
      storage.removeItem(await name(key));
    },
    clear,
  };
}
