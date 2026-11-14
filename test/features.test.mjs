// Tags, subscribe and Cache-Control. Kept apart from cache.test.mjs, which covers the core get path.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { CacheApi, HttpError, memoryStore } from "../dist/index.mjs";
import { fsStore } from "../dist/fs.mjs";
import { sleep, startServer } from "./server.mjs";

let server;
before(async () => (server = await startServer()));
beforeEach(() => server.reset());
after(() => server.close());

const api = (options) => new CacheApi({ baseUrl: server.url, ...options });
const users = { tags: ["users"] };

// ---- tags ----

test("invalidateTag drops every entry with the tag and leaves the rest", async () => {
  const cache = api();
  await cache.get("/a", users);
  await cache.get("/b", users);
  await cache.get("/c");
  await cache.invalidateTag("users");
  assert.deepEqual(await cache.get("/a", users), { n: 4, method: "GET" });
  assert.deepEqual(await cache.get("/b", users), { n: 5, method: "GET" });
  assert.deepEqual(await cache.get("/c"), { n: 3, method: "GET" });
  assert.equal(server.state.hits, 5);
});

test("an entry refetched after invalidateTag is cached again", async () => {
  const cache = api();
  await cache.get("/a", users);
  await cache.invalidateTag("users");
  await cache.get("/a", users);
  await cache.get("/a", users);
  assert.equal(server.state.hits, 2);
});

test("an entry with several tags is dropped by any one of them", async () => {
  const cache = api();
  await cache.get("/a", { tags: ["users", "admin"] });
  await cache.invalidateTag("admin");
  assert.equal(await cache.peek("/a"), undefined);
});

test("invalidating an unrelated tag changes nothing", async () => {
  const cache = api();
  await cache.get("/a", users);
  await cache.invalidateTag("posts");
  await cache.get("/a", users);
  assert.equal(server.state.hits, 1);
});

test("tags are not part of the key and do not reach fetch", async () => {
  let seen;
  const cache = new CacheApi({
    fetch: async (url, init) => {
      seen = init;
      return new Response("1");
    },
  });
  await cache.get("https://example.test/a", users);
  await cache.get("https://example.test/a");
  assert.equal("tags" in seen, false);
  assert.equal(await cache.peek("https://example.test/a"), 1);
});

test("a tagged entry gives no stale fallback once its tag is invalidated", async () => {
  const cache = api();
  await cache.get("/a", users);
  await cache.invalidateTag("users");
  server.state.failing = true;
  await assert.rejects(cache.get("/a", users), HttpError);
});

test("invalidateTag during a request stops it keeping the old data", async () => {
  const store = memoryStore();
  const cache = api({ store });
  const seen = [];
  cache.subscribe("/slow", (value) => seen.push(value));
  const pending = cache.get("/slow", users);
  await sleep(10);
  await cache.invalidateTag("users");
  assert.deepEqual(await pending, { n: 1, method: "GET" });
  assert.deepEqual(seen, []); // subscribers are not handed data from before the invalidation
  assert.equal(store.get(server.url + "/slow"), undefined);
  assert.equal(await cache.peek("/slow"), undefined);
});

test("a set right after invalidateTag is kept", async () => {
  const cache = api();
  for (let i = 0; i < 50; i++) {
    await cache.invalidateTag("users");
    await cache.set("/a", i, users);
    assert.equal(await cache.peek("/a"), i);
  }
});

test("set with tags is dropped by invalidateTag", async () => {
  const cache = api();
  await cache.set("/a", "mine", users);
  await cache.invalidateTag("users");
  assert.equal(await cache.peek("/a"), undefined);
});

test("the latest fetch decides the tags", async () => {
  const cache = api();
  await cache.get("/a", users);
  await cache.get("/a", { force: true });
  await cache.invalidateTag("users");
  assert.deepEqual(await cache.peek("/a"), { n: 2, method: "GET" });
});

test("tags reach every instance sharing a store", async () => {
  const store = memoryStore();
  await api({ store }).get("/a", users);
  await api({ store }).invalidateTag("users");
  assert.equal(await api({ store }).peek("/a"), undefined);
});

test("tags survive on disk and no tag or key is written in clear text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cache-api-"));
  const disk = () => api({ store: fsStore(dir) });
  await disk().get("/a", { ...users, headers: { Authorization: "Bearer secret-token" } });
  const [file] = await readdir(dir);
  const saved = await readFile(join(dir, file), "utf8");
  assert.deepEqual(JSON.parse(saved).tags, ["users"]);
  assert.doesNotMatch(saved, /secret-token/);
  await disk().invalidateTag("users");
  assert.equal(await disk().peek("/a", { headers: { Authorization: "Bearer secret-token" } }), undefined);
  for (const name of await readdir(dir)) assert.match(name, /^[\da-f]{40}\.json$/);
  await rm(dir, { recursive: true });
});

test("clear also forgets tag invalidations without bringing entries back", async () => {
  const cache = api();
  await cache.get("/a", users);
  await cache.invalidateTag("users");
  await cache.clear();
  assert.equal(await cache.peek("/a"), undefined);
});

test("a store that fails while checking a tag counts as a miss", async () => {
  const inner = memoryStore();
  const store = { ...inner, get: (key) => (key.includes("tag:") ? Promise.reject(new Error("down")) : inner.get(key)) };
  const cache = api({ store });
  await cache.get("/a", users);
  assert.deepEqual(await cache.get("/a", users), { n: 2, method: "GET" });
});

// ---- subscribe ----

test("subscribe receives fetched values, but nothing on a cache hit", async () => {
  const cache = api();
  const seen = [];
  cache.subscribe("/a", (value) => seen.push(value));
  await cache.get("/a");
  await cache.get("/a");
  assert.deepEqual(seen, [{ n: 1, method: "GET" }]);
});

test("subscribe receives the result of a background refresh", async () => {
  const cache = api({ maxAge: 0.05, staleWhileRevalidate: 10 });
  await cache.get("/a");
  const seen = [];
  cache.subscribe("/a", (value) => seen.push(value));
  await sleep(80);
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
  await sleep(50);
  assert.deepEqual(seen, [{ n: 2, method: "GET" }]);
});

test("subscribe receives values written with set", async () => {
  const cache = api();
  const seen = [];
  cache.subscribe("/a", (value) => seen.push(value));
  await cache.set("/a", "mine");
  assert.deepEqual(seen, ["mine"]);
});

test("the function subscribe returns stops the callback, and is safe to call twice", async () => {
  const cache = api();
  const seen = [];
  const stop = cache.subscribe("/a", (value) => seen.push(value));
  await cache.set("/a", 1);
  stop();
  stop();
  await cache.set("/a", 2);
  assert.deepEqual(seen, [1]);
});

test("stopping one subscriber leaves the others on the same path", async () => {
  const cache = api();
  const first = [];
  const second = [];
  const stop = cache.subscribe("/a", (value) => first.push(value));
  cache.subscribe("/a", (value) => second.push(value));
  stop();
  await cache.set("/a", 1);
  assert.deepEqual([first, second], [[], [1]]);
});

test("a subscriber that throws fails neither the request nor the other subscribers", async () => {
  const cache = api();
  const seen = [];
  cache.subscribe("/a", () => {
    throw new Error("broken subscriber");
  });
  cache.subscribe("/a", (value) => seen.push(value));
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
  assert.equal(seen.length, 1);
  assert.deepEqual(await cache.peek("/a"), { n: 1, method: "GET" });
});

test("subscriptions follow the key, so other paths and other headers are separate", async () => {
  const cache = api();
  const seen = [];
  const alice = { headers: { Authorization: "Bearer alice" } };
  cache.subscribe("/me", (value) => seen.push(value), alice);
  await cache.set("/me", "bob", { headers: { Authorization: "Bearer bob" } });
  await cache.set("/other", "x", alice);
  await cache.set("/me", "alice", alice);
  assert.deepEqual(seen, ["alice"]);
});

test("subscribe is silent on a 304 and when a request was invalidated", async () => {
  const cache = api({ etag: true, maxAge: 0.05 });
  await cache.get("/etag");
  const seen = [];
  cache.subscribe("/etag", (value) => seen.push(value));
  cache.subscribe("/slow", (value) => seen.push(value));
  await sleep(80);
  await cache.get("/etag");
  const pending = cache.get("/slow");
  await sleep(10);
  await cache.invalidate("/slow");
  await pending;
  assert.deepEqual(seen, []);
});

// ---- Cache-Control ----

test("cacheControl: the server's max-age replaces the instance maxAge", async () => {
  server.state.cacheControl = "public, max-age=60";
  const long = api({ cacheControl: true, maxAge: 0 });
  await long.get("/a");
  await long.get("/a");
  assert.equal(server.state.hits, 1);

  server.state.cacheControl = "max-age=0";
  const short = api({ cacheControl: true, maxAge: 60 });
  await short.get("/b");
  await short.get("/b");
  assert.equal(server.state.hits, 3);
});

test("cacheControl: a response without the header uses the instance maxAge", async () => {
  const cache = api({ cacheControl: true, maxAge: 60 });
  await cache.get("/a");
  await cache.get("/a");
  assert.equal(server.state.hits, 1);
});

test("cacheControl: a per-call maxAge wins over the server", async () => {
  server.state.cacheControl = "max-age=60";
  const cache = api({ cacheControl: true });
  await cache.get("/a");
  await sleep(20);
  assert.deepEqual(await cache.get("/a", { maxAge: 0.01 }), { n: 2, method: "GET" });
});

test("cacheControl is off by default", async () => {
  server.state.cacheControl = "no-store";
  const store = memoryStore();
  const cache = api({ store });
  await cache.get("/a");
  await cache.get("/a");
  assert.equal(server.state.hits, 1);
  assert.deepEqual(Object.keys(store.get(server.url + "/a")).sort(), ["time", "value"]);
});

test("cacheControl: no-store keeps the response out of the store and removes an older entry", async () => {
  const store = memoryStore();
  const cache = api({ store, cacheControl: true, maxAge: 0 });
  await cache.get("/a");
  assert.notEqual(store.get(server.url + "/a"), undefined);
  server.state.cacheControl = "no-store";
  assert.deepEqual(await cache.get("/a"), { n: 2, method: "GET" });
  assert.equal(store.get(server.url + "/a"), undefined);
  server.state.failing = true;
  await assert.rejects(cache.get("/a"), HttpError);
});

test("cacheControl: no-cache always revalidates but still backs staleIfError", async () => {
  server.state.cacheControl = "no-cache";
  const cache = api({ cacheControl: true });
  await cache.get("/a");
  assert.deepEqual(await cache.get("/a"), { n: 2, method: "GET" });
  server.state.failing = true;
  assert.deepEqual(await cache.get("/a"), { n: 2, method: "GET" });
});

test("cacheControl: s-maxage is ignored and Age is subtracted from max-age", async () => {
  let headers;
  let calls = 0;
  const cache = new CacheApi({
    cacheControl: true,
    maxAge: 0,
    fetch: async () => new Response(String(++calls), { headers }),
  });
  headers = { "cache-control": "s-maxage=600" };
  await cache.get("https://example.test/shared");
  assert.equal(await cache.get("https://example.test/shared"), 2);

  headers = { "cache-control": "max-age=60", age: "60" };
  await cache.get("https://example.test/aged");
  assert.equal(await cache.get("https://example.test/aged"), 4);

  headers = { "cache-control": "max-age=60", age: "10" };
  await cache.get("https://example.test/young");
  assert.equal(await cache.get("https://example.test/young"), 5);
});

test("cacheControl: a 304 keeps the stored max-age unless it sends a new one", async () => {
  server.state.cacheControl = "max-age=0";
  const cache = api({ cacheControl: true, etag: true });
  await cache.get("/etag");
  assert.deepEqual(await cache.get("/etag"), { n: 1, method: "GET" });
  assert.equal(server.state.hits, 2);
  server.state.cacheControl = "max-age=60";
  await cache.get("/etag");
  await cache.get("/etag");
  assert.equal(server.state.hits, 3);
});

test("cacheControl: the server's max-age is kept on disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cache-api-"));
  server.state.cacheControl = "max-age=60";
  const disk = () => api({ store: fsStore(dir), cacheControl: true, maxAge: 0 });
  await disk().get("/a");
  await disk().get("/a");
  assert.equal(server.state.hits, 1);
  const [file] = await readdir(dir);
  assert.equal(JSON.parse(await readFile(join(dir, file), "utf8")).maxAge, 60);
  await rm(dir, { recursive: true });
});

// ---- behaviour the new clock must not change ----

test("maxAge 0 refetches every time, even back to back", async () => {
  const cache = api({ maxAge: 0 });
  for (let i = 0; i < 20; i++) await cache.get("/a");
  assert.equal(server.state.hits, 20);
});

test("times written to the store stay close to the real clock under a burst of writes", async () => {
  const store = memoryStore();
  const cache = api({ store });
  for (let i = 0; i < 2000; i++) await cache.set("/a", i);
  assert.ok(store.get(server.url + "/a").time - Date.now() < 2000);
});
