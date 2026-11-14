import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { CacheApi } from "../dist/index.mjs";
import { fsStore } from "../dist/fs.mjs";
import { sleep, startServer } from "./server.mjs";

let server, dir;
before(async () => (server = await startServer()));
beforeEach(async () => {
  server.reset();
  dir = await mkdtemp(join(tmpdir(), "cache-api-"));
});
after(() => server.close());

const api = () => new CacheApi({ baseUrl: server.url, store: fsStore(dir) });

test("persists across instances", async () => {
  await api().get("/a");
  assert.deepEqual(await api().get("/a"), { n: 1, method: "GET" });
  assert.equal(server.state.hits, 1);
  await rm(dir, { recursive: true });
});

test("writes exactly one file per entry and leaves no temp files", async () => {
  await api().get("/a");
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[\da-f]{40}\.json$/);
  await rm(dir, { recursive: true });
});

test("never writes the key, so tokens stay off disk", async () => {
  await api().get("/a", { headers: { Authorization: "Bearer secret-token" } });
  const [file] = await readdir(dir);
  const saved = await readFile(join(dir, file), "utf8");
  assert.doesNotMatch(saved, /secret-token/);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ["time", "value"]);
  await rm(dir, { recursive: true });
});

test("keeps the etag on disk so another instance can revalidate with it", async () => {
  const etagApi = () => new CacheApi({ baseUrl: server.url, store: fsStore(dir), etag: true, maxAge: 0 });
  await etagApi().get("/etag");
  assert.deepEqual(await etagApi().get("/etag"), { n: 1, method: "GET" });
  assert.equal(server.state.hits, 2);
  await rm(dir, { recursive: true });
});

test("ttl: an entry older than ttl reads as a miss", async () => {
  const store = fsStore(dir, { ttl: 0.05 });
  await store.set("a", { value: 1, time: Date.now() });
  assert.equal((await store.get("a")).value, 1);
  await sleep(80);
  assert.equal(await store.get("a"), undefined);
  await sleep(30); // let the sweep started by `set` finish before the directory goes
  await rm(dir, { recursive: true });
});

test("ttl: a later write deletes expired files", async () => {
  const store = fsStore(dir, { ttl: 0.1 });
  await store.set("a", { value: 1, time: Date.now() });
  await sleep(150);
  await store.set("b", { value: 2, time: Date.now() });
  await sleep(40); // the sweep runs in the background; "b" is still inside its ttl here
  assert.equal((await readdir(dir)).length, 1);
  assert.equal((await store.get("b")).value, 2);
  await rm(dir, { recursive: true });
});

test("without ttl files are kept", async () => {
  const store = fsStore(dir);
  await store.set("a", { value: 1, time: 0 });
  await store.set("b", { value: 2, time: 0 });
  assert.equal((await store.get("a")).value, 1);
  assert.equal((await readdir(dir)).length, 2);
  await rm(dir, { recursive: true });
});

test("treats an unreadable file as a miss", async () => {
  await api().get("/a");
  const [file] = await readdir(dir);
  await writeFile(join(dir, file), "{ not json");
  assert.deepEqual(await api().get("/a"), { n: 2, method: "GET" });
  await rm(dir, { recursive: true });
});

test("clear removes only cache files", async () => {
  await writeFile(join(dir, "keep.txt"), "mine");
  const cache = api();
  await cache.get("/a");
  await cache.clear();
  assert.deepEqual(await readdir(dir), ["keep.txt"]);
  await rm(dir, { recursive: true });
});

test("clear on a missing directory is a no-op", async () => {
  await rm(dir, { recursive: true });
  await api().clear();
});
