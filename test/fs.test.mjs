import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { CacheApi } from "../dist/index.mjs";
import { fsStore } from "../dist/fs.mjs";
import { startServer } from "./server.mjs";

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
