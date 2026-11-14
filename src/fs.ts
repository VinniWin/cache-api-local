import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Store } from "./types";

/**
 * Persists each entry as one JSON file under `dir` (resolved from the current working directory).
 * Values must be JSON-serializable. Runs on Node, Deno and Bun.
 *
 * `ttl` is the seconds an entry is kept after it was fetched; older entries read as a miss and their
 * files are deleted. Default: `Infinity` (files stay until `invalidate` or `clear`).
 */
export function fsStore(dir: string, { ttl = Infinity }: { ttl?: number } = {}): Store {
  const root = resolve(dir);
  const file = (key: string) => join(root, createHash("sha1").update(key).digest("hex") + ".json");
  const ours = /^[\da-f]{40}\.json(\..+\.tmp)?$/;
  let swept = 0;

  /** Delete our files older than `ttl`, by mtime, which every `set` renews. Also removes temp files left by a crash. */
  const sweep = async () => {
    const cutoff = Date.now() - ttl * 1000;
    for (const name of await readdir(root)) {
      if (!ours.test(name)) continue;
      const path = join(root, name);
      const info = await stat(path).catch(() => undefined); // gone already: nothing to do
      if (info && info.mtimeMs < cutoff) await rm(path, { force: true });
    }
  };

  return {
    async get(key) {
      try {
        const { time, value, etag, tags, maxAge } = JSON.parse(await readFile(file(key), "utf8"));
        if (Date.now() - time > ttl * 1000) return undefined;
        return { time, value, etag, tags, maxAge };
      } catch {
        return undefined; // missing or unreadable file counts as a miss
      }
    },
    async set(key, { time, value, etag, tags, maxAge }) {
      await mkdir(root, { recursive: true });
      const target = file(key);
      const tmp = `${target}.${randomUUID()}.tmp`;
      try {
        // The key itself is never written: the default key can contain an Authorization header.
        await writeFile(tmp, JSON.stringify({ time, value, etag, tags, maxAge })); // undefined fields are left out
        await rename(tmp, target); // atomic replace: readers never see a half-written file
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
      // At most once per `ttl` (or per hour, if shorter), so a write never pays for a directory scan twice in a row.
      if (ttl !== Infinity && Date.now() - swept > Math.min(ttl, 3600) * 1000) {
        swept = Date.now();
        // Not awaited, failures ignored: a missed sweep only delays cleanup until the next one.
        sweep().catch(() => {});
      }
    },
    async delete(key) {
      await rm(file(key), { force: true });
    },
    async clear() {
      // Only our own files, so pointing `dir` at a shared folder never deletes anything else.
      const names = await readdir(root).catch(() => [] as string[]);
      await Promise.all(names.filter((name) => ours.test(name)).map((name) => rm(join(root, name), { force: true })));
    },
  };
}
