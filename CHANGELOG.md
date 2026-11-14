# Changelog

## Unreleased

No breaking changes. Existing code and existing `fsStore` cache folders keep working.

### Added

- `etag` option (off by default): stores the response's `ETag`, sends it as `If-None-Match` on refresh, and reuses the cached value on a `304`.
- `Entry.etag`, an optional field. Custom stores that save the whole entry need no change. `fsStore` files gain an `etag` property only when the option is on.
- Tags: `get(path, { tags })`, `set(path, value, { tags })` and `api.invalidateTag(tag)` drop a group of entries at once. Works with every store, with no change to the `Store` interface.
- `api.subscribe(path, callback)`: called with every new value, including background refreshes.
- `cacheControl` option (off by default): the response's `Cache-Control` (`max-age`, `no-cache`, `no-store`) sets freshness per entry.
- `Entry.tags` and `Entry.maxAge`, optional fields, saved by `fsStore` and `webStore` only when used.
- `api.peek(path)` and `api.set(path, value)`: read and write the cache without a network call, for optimistic updates and prefilling.
- `fsStore(dir, { ttl })`: entries older than `ttl` seconds read as a miss and their files are deleted. Default is unchanged (kept forever).
- `webStore()` from the new `cache-api-local/web` entry: persists entries in `localStorage` or any `Storage`.

### Changed

- The core grew from about 1.5 KB to about 2 KB gzipped.
- `Entry.time` values written by one `CacheApi` instance are now strictly increasing, so two writes in the same millisecond differ by 1 ms. This is what orders a `set` after an `invalidateTag`.

## 2.0.0

Rewrite. Same idea, new API: runtime-agnostic storage, stale-while-revalidate, and request dedupe.

### Breaking

- Named export instead of default: `import { CacheApi } from "cache-api-local"`.
- Constructor takes an options object: `new CacheApi({ baseUrl, maxAge })` instead of `new CacheApi(baseUrl, folder, maxAge)`.
- `getData(urlPath, subFolder, options, bypass)` is now `get(path, { ...init, force })`. There is no sub-folder argument; use a separate store per group.
- Default storage is in memory. For disk, pass `store: fsStore(dir)` from `cache-api-local/fs`.
- `fsStore(dir)` resolves `dir` from the current working directory, not from the calling file. The stack-trace lookup broke under bundlers.
- Cache files are named by a hash of the key and hold data and timestamp together. 1.x cache folders are not read; delete them.
- `maxAge: 0` now means "always stale". Omit `maxAge` for "never expires".
- Non-GET requests are no longer cached.
- Non-2xx responses reject with `HttpError` (with `status` and `response`).
- The library no longer logs to the console.

### Migration

```ts
// 1.x
import CacheApi from "cache-api-local";
const api = new CacheApi("https://api.example.com", "data", 300);
await api.getData("/posts/1", "posts");

// 2.0
import { CacheApi } from "cache-api-local";
import { fsStore } from "cache-api-local/fs";
const api = new CacheApi({ baseUrl: "https://api.example.com", store: fsStore("data/posts"), maxAge: 300 });
await api.get("/posts/1");
```

### Added

- `staleWhileRevalidate`: serve stale entries while refreshing in the background.
- Concurrent requests for the same key share one network call.
- `staleIfError` option (on by default, matching 1.x fallback behaviour).
- Typed results: `get<T>()`.
- `invalidate(path)` and `clear()`.
- Per-call `maxAge` and `staleWhileRevalidate` overrides.
- Custom `fetch`, `parse` and `key` options. The default key is the URL plus every request header, so requests differing by `Authorization`, `Cookie` or any other header never share an entry.
- Store failures degrade to a cache miss instead of failing the request.
- `signal` aborts only the calling `get`; shared requests and background refreshes keep running.
- `invalidate()` and `clear()` stop requests already running from writing old data back.
- `memoryStore({ max })` with least-recently-used eviction. Defaults to 1000 entries so memory stays bounded; pass `max: Infinity` to opt out.
- Pluggable `Store` interface for any backend.
- Works on Node, Deno, Bun, browsers and edge runtimes.

### Fixed

- Cached falsy values (`0`, `false`, `""`) are returned instead of refetched.
- Disk writes are atomic; a crash can no longer leave a half-written cache file.
- Different URLs can no longer map to the same cache file.
- No double slash when `baseUrl` ends or `path` starts with `/`.
- File I/O no longer blocks the event loop.
