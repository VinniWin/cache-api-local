import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { CacheApi } from "../dist/index.mjs";
import { webStore } from "../dist/web.mjs";
import { startServer } from "./server.mjs";

/** Minimal `Storage`. `limit` makes `setItem` throw once that many items are held, like a full quota. */
function fakeStorage(limit = Infinity) {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (name) => map.get(name) ?? null,
    setItem(name, data) {
      if (!map.has(name) && map.size >= limit) throw new Error("QuotaExceededError");
      map.set(name, data);
    },
    removeItem: (name) => void map.delete(name),
  };
}

let server, storage;
before(async () => (server = await startServer()));
beforeEach(() => {
  server.reset();
  storage = fakeStorage();
});
after(() => server.close());

const api = () => new CacheApi({ baseUrl: server.url, store: webStore({ storage }) });

test("persists across instances", async () => {
  await api().get("/a");
  assert.deepEqual(await api().get("/a"), { n: 1, method: "GET" });
  assert.equal(server.state.hits, 1);
});

test("never stores the key, so tokens stay out of storage", async () => {
  await api().get("/a", { headers: { Authorization: "Bearer secret-token" } });
  const [[name, data]] = storage.map;
  assert.match(name, /^cache-api-local:/);
  assert.doesNotMatch(name + data, /secret-token/);
  assert.deepEqual(Object.keys(JSON.parse(data)).sort(), ["time", "value"]);
});

test("treats an unreadable item as a miss", async () => {
  await api().get("/a");
  storage.map.set([...storage.map.keys()][0], "{ not json");
  assert.deepEqual(await api().get("/a"), { n: 2, method: "GET" });
});

test("invalidate removes one entry", async () => {
  const cache = api();
  await cache.get("/a");
  await cache.get("/b");
  await cache.invalidate("/a");
  assert.equal(storage.length, 1);
});

test("clear removes only its own items", async () => {
  storage.setItem("theme", "dark");
  const cache = api();
  await cache.get("/a");
  await cache.get("/b");
  await cache.clear();
  assert.deepEqual([...storage.map], [["theme", "dark"]]);
});

test("keeps tags, so invalidateTag works across instances", async () => {
  await api().get("/a", { tags: ["users"] });
  assert.deepEqual(await api().peek("/a"), { n: 1, method: "GET" });
  await api().invalidateTag("users");
  assert.equal(await api().peek("/a"), undefined);
  for (const name of storage.map.keys()) assert.doesNotMatch(name, /users/);
});

test("a full storage drops old entries and stores the new one", async () => {
  storage = fakeStorage(2);
  const cache = api();
  await cache.get("/a");
  await cache.get("/b");
  await cache.get("/c");
  assert.equal(storage.length, 1);
  assert.deepEqual(await cache.get("/c"), { n: 3, method: "GET" });
  assert.equal(server.state.hits, 3);
});
