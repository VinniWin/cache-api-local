import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { CacheApi, HttpError, memoryStore } from "../dist/index.mjs";
import { sleep, startServer } from "./server.mjs";

let server;
before(async () => (server = await startServer()));
beforeEach(() => server.reset());
after(() => server.close());

const api = (options) => new CacheApi({ baseUrl: server.url, ...options });

test("caches GET responses", async () => {
  const cache = api();
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
  assert.equal(server.state.hits, 1);
});

test("joins baseUrl and path regardless of slashes", async () => {
  const cache = new CacheApi({ baseUrl: server.url + "/" });
  await cache.get("/a",{credentials:"include"});
  await cache.get("a");
  assert.equal(server.state.hits, 1);
});

test("uses absolute URLs as is", async () => {
  const cache = new CacheApi({ baseUrl: "http://unused.invalid" });
  assert.deepEqual(await cache.get(server.url + "/a"), { n: 1, method: "GET" });
});

test("dedupes concurrent requests for the same key", async () => {
  const cache = api();
  const results = await Promise.all(Array.from({ length: 5 }, () => cache.get("/a")));
  assert.equal(server.state.hits, 1);
  for (const r of results) assert.deepEqual(r, { n: 1, method: "GET" });
});

test("refetches after maxAge", async () => {
  const cache = api({ maxAge: 0.05 });
  await cache.get("/a");
  await sleep(80);
  assert.deepEqual(await cache.get("/a"), { n: 2, method: "GET" });
});

test("per-call maxAge overrides the default", async () => {
  const cache = api({ maxAge: 60 });
  await cache.get("/a");
  await sleep(20);
  assert.deepEqual(await cache.get("/a", { maxAge: 0.01 }), { n: 2, method: "GET" });
});

test("stale-while-revalidate returns stale and refreshes in the background", async () => {
  const store = memoryStore();
  const cache = api({ store, maxAge: 0.05, staleWhileRevalidate: 10 });
  await cache.get("/a");
  await sleep(80);
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
  await sleep(50);
  // Read the store, not `get`, so this test leaves no background request running into the next one.
  assert.deepEqual(store.get(server.url + "/a").value, { n: 2, method: "GET" });
  assert.equal(server.state.hits, 2);
});

test("stale-while-revalidate keeps the stale entry when the refresh fails", async () => {
  const store = memoryStore();
  const cache = api({ store, maxAge: 0.05, staleWhileRevalidate: 10 });
  await cache.get("/a");
  await sleep(80);
  server.state.failing = true;
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
  await sleep(50);
  assert.deepEqual(store.get(server.url + "/a").value, { n: 1, method: "GET" });
  assert.equal(server.state.hits, 2);
});

test("staleIfError returns the old entry when the fetch fails", async () => {
  const cache = api({ maxAge: 0.05 });
  await cache.get("/a");
  await sleep(80);
  server.state.failing = true;
  assert.deepEqual(await cache.get("/a"), { n: 1, method: "GET" });
});

test("staleIfError: false surfaces the HttpError", async () => {
  const cache = api({ maxAge: 0.05, staleIfError: false });
  await cache.get("/a");
  await sleep(80);
  server.state.failing = true;
  await assert.rejects(cache.get("/a"), (err) => err instanceof HttpError && err.status === 500);
});

test("throws HttpError when there is nothing cached", async () => {
  server.state.failing = true;
  await assert.rejects(api().get("/a"), HttpError);
});

test("does not cache non-GET requests", async () => {
  const store = memoryStore();
  const cache = api({ store });
  assert.deepEqual(await cache.get("/a", { method: "POST" }), { n: 1, method: "POST" });
  assert.deepEqual(await cache.get("/a", { method: "post" }), { n: 2, method: "POST" });
  assert.equal(store.get(server.url + "/a"), undefined);
});

test("force skips the cache but still stores the result", async () => {
  const cache = api();
  await cache.get("/a");
  assert.deepEqual(await cache.get("/a", { force: true }), { n: 2, method: "GET" });
  assert.deepEqual(await cache.get("/a"), { n: 2, method: "GET" });
});

test("caches falsy values", async () => {
  const cache = api();
  assert.equal(await cache.get("/zero"), 0);
  assert.equal(await cache.get("/zero"), 0);
  assert.equal(server.state.hits, 1);
});

test("invalidate and clear remove entries", async () => {
  const cache = api();
  await cache.get("/a");
  await cache.get("/b");
  await cache.invalidate("/a");
  await cache.get("/a");
  await cache.get("/b");
  assert.equal(server.state.hits, 3);
  await cache.clear();
  await cache.get("/a");
  await cache.get("/b");
  assert.equal(server.state.hits, 5);
});

test("custom key, fetch and parse", async () => {
  const calls = [];
  const cache = new CacheApi({
    baseUrl: "https://example.test",
    fetch: async (url, init) => {
      calls.push(url);
      return new Response(`hello ${init.headers.lang}`);
    },
    parse: (res) => res.text(),
    key: (url, init) => `${url}|${init.headers.lang}`,
  });
  assert.equal(await cache.get("x", { headers: { lang: "en" } }), "hello en");
  assert.equal(await cache.get("x", { headers: { lang: "fr" } }), "hello fr");
  assert.equal(await cache.get("x", { headers: { lang: "en" } }), "hello en");
  assert.deepEqual(calls, ["https://example.test/x", "https://example.test/x"]);
});

test("a store that fails to read falls back to the network", async () => {
  const store = { ...memoryStore(), get: () => Promise.reject(new Error("store down")) };
  assert.deepEqual(await api({ store }).get("/a"), { n: 1, method: "GET" });
});

test("a store that fails to write still returns the fetched data", async () => {
  const store = { ...memoryStore(), set: () => Promise.reject(new Error("disk full")) };
  assert.deepEqual(await api({ store }).get("/a"), { n: 1, method: "GET" });
});

test("one caller aborting does not fail others sharing the request", async () => {
  const cache = api();
  const controller = new AbortController();
  const first = cache.get("/slow", { signal: controller.signal });
  const second = cache.get("/slow");
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.deepEqual(await second, { n: 1, method: "GET" });
  assert.equal(server.state.hits, 1);
});

test("an aborted caller gets the abort, not a stale entry", async () => {
  const cache = api({ maxAge: 0.05 });
  await cache.get("/slow");
  await sleep(80);
  const controller = new AbortController();
  const pending = cache.get("/slow", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await sleep(80); // let the shared request finish before the next test
});

test("background refresh survives the triggering caller aborting", async () => {
  const store = memoryStore();
  const cache = api({ store, maxAge: 0.05, staleWhileRevalidate: 10 });
  await cache.get("/slow");
  await sleep(80);
  const controller = new AbortController();
  assert.deepEqual(await cache.get("/slow", { signal: controller.signal }), { n: 1, method: "GET" });
  controller.abort();
  await sleep(100);
  assert.deepEqual(store.get(server.url + "/slow").value, { n: 2, method: "GET" });
});

test("invalidate during a request stops it writing the old data back", async () => {
  const store = memoryStore();
  const cache = api({ store });
  const pending = cache.get("/slow");
  await sleep(10);
  await cache.invalidate("/slow");
  await pending;
  assert.equal(store.get(server.url + "/slow"), undefined);
});

test("clear during a request stops it writing the old data back", async () => {
  const store = memoryStore();
  const cache = api({ store });
  const pending = cache.get("/slow");
  await sleep(10);
  await cache.clear();
  await pending;
  assert.equal(store.get(server.url + "/slow"), undefined);
});

test("different Authorization headers never share an entry", async () => {
  const cache = api();
  const as = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(await cache.get("/me", as("alice")), { n: 1, method: "GET" });
  assert.deepEqual(await cache.get("/me", as("bob")), { n: 2, method: "GET" });
  assert.deepEqual(await cache.get("/me", as("alice")), { n: 1, method: "GET" });
  assert.deepEqual(await cache.get("/me", { headers: new Headers({ authorization: "Bearer bob" }) }), {
    n: 2,
    method: "GET",
  });
  assert.equal(server.state.hits, 2);
});

test("different cookies or custom auth headers never share an entry", async () => {
  const cache = api();
  assert.deepEqual(await cache.get("/me", { headers: { Cookie: "session=alice" } }), { n: 1, method: "GET" });
  assert.deepEqual(await cache.get("/me", { headers: { Cookie: "session=bob" } }), { n: 2, method: "GET" });
  assert.deepEqual(await cache.get("/me", { headers: { "X-Api-Key": "k1" } }), { n: 3, method: "GET" });
  assert.deepEqual(await cache.get("/me"), { n: 4, method: "GET" });
  assert.deepEqual(await cache.get("/me", { headers: { cookie: "session=alice" } }), { n: 1, method: "GET" });
  assert.equal(server.state.hits, 4);
});

test("header order and name case do not change the key", async () => {
  const cache = api();
  await cache.get("/a", { headers: { Accept: "application/json", Cookie: "s=1" } });
  await cache.get("/a", { headers: [["cookie", "s=1"], ["accept", "application/json"]] });
  assert.equal(server.state.hits, 1);
});

test("non-GET requests honour the caller's signal", async () => {
  const controller = new AbortController();
  const pending = api().get("/slow", { method: "POST", signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await sleep(80);
});

test("memoryStore is capped at 1000 entries by default", () => {
  const store = memoryStore();
  for (let i = 0; i <= 1000; i++) store.set(String(i), { value: i, time: 0 });
  assert.equal(store.get("0"), undefined);
  assert.equal(store.get("1000").value, 1000);
});

test("memoryStore evicts the least recently used entry past max", () => {
  const store = memoryStore({ max: 2 });
  store.set("a", { value: 1, time: 0 });
  store.set("b", { value: 2, time: 0 });
  store.get("a");
  store.set("c", { value: 3, time: 0 });
  assert.equal(store.get("b"), undefined);
  assert.equal(store.get("a").value, 1);
  assert.equal(store.get("c").value, 3);
});
