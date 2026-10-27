import type { Entry, Store } from "./types";

/**
 * In-memory store. Works in every runtime. Holds at most `max` entries (default 1000),
 * evicting the least recently used, so a long-running process cannot grow without bound.
 */
export function memoryStore({ max = 1000 }: { max?: number } = {}): Store {
  const map = new Map<string, Entry>();
  return {
    get(key) {
      const entry = map.get(key);
      if (entry) {
        // Map keeps insertion order, so re-inserting marks it most recently used.
        map.delete(key);
        map.set(key, entry);
      }
      return entry;
    },
    set(key, entry) {
      map.delete(key);
      map.set(key, entry);
      if (map.size > max) map.delete(map.keys().next().value!);
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}
