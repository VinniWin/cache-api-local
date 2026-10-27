import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Store } from "./types";

/**
 * Persists each entry as one JSON file under `dir` (resolved from the current working directory).
 * Values must be JSON-serializable. Runs on Node, Deno and Bun.
 */
export function fsStore(dir: string): Store {
  const root = resolve(dir);
  const file = (key: string) => join(root, createHash("sha1").update(key).digest("hex") + ".json");

  return {
    async get(key) {
      try {
        const { time, value } = JSON.parse(await readFile(file(key), "utf8"));
        return { time, value };
      } catch {
        return undefined; // missing or unreadable file counts as a miss
      }
    },
    async set(key, { time, value }) {
      await mkdir(root, { recursive: true });
      const target = file(key);
      const tmp = `${target}.${randomUUID()}.tmp`;
      try {
        // The key itself is never written: the default key can contain an Authorization header.
        await writeFile(tmp, JSON.stringify({ time, value }));
        await rename(tmp, target); // atomic replace: readers never see a half-written file
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    },
    async delete(key) {
      await rm(file(key), { force: true });
    },
    async clear() {
      // Only our own files, so pointing `dir` at a shared folder never deletes anything else.
      const names = await readdir(root).catch(() => [] as string[]);
      await Promise.all(
        names
          .filter((name) => /^[\da-f]{40}\.json(\..+\.tmp)?$/.test(name))
          .map((name) => rm(join(root, name), { force: true })),
      );
    },
  };
}
