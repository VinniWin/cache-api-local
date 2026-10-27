# Changelog

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
