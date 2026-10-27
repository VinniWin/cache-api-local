# cache-api-local

Tiny, zero-dependency cache for `fetch`. Stale-while-revalidate, concurrent request dedupe, stale-if-error fallback, and pluggable storage. Runs on Node, Deno, Bun, browsers and edge runtimes.

- About 1.5 KB gzipped core, no dependencies
- Typed results with `get<T>()`
- ESM and CommonJS, with types for both
- Memory store everywhere, filesystem store on server runtimes, or bring your own

## Install

```bash
npm install cache-api-local
```

Requires a runtime with a global `fetch` (Node 18+), or pass your own via the `fetch` option.

## Usage

```ts
import { CacheApi } from "cache-api-local";

const api = new CacheApi({
  baseUrl: "https://jsonplaceholder.typicode.com",
  maxAge: 60, // fresh for 60 seconds
  staleWhileRevalidate: 300, // then serve stale for up to 5 more minutes while refreshing
});

type Post = { id: number; title: string };

const post = await api.get<Post>("/posts/1"); // network
const again = await api.get<Post>("/posts/1"); // cache
```

### Persist to disk

```ts
import { CacheApi } from "cache-api-local";
import { fsStore } from "cache-api-local/fs";

const api = new CacheApi({ baseUrl: "https://api.example.com", store: fsStore(".cache/api") });
```

`fsStore(dir)` resolves `dir` from the current working directory and writes one JSON file per entry, atomically. Values must be JSON-serializable, so keep the default `parse` (or one returning text or plain objects) with this store. Import it only on server runtimes; the core entry never touches the filesystem.

## How a `get` is answered

1. Entry younger than `maxAge`: returned from cache.
2. Entry older than `maxAge` but within `maxAge + staleWhileRevalidate`: returned from cache, and refreshed in the background.
3. Otherwise: fetched. Concurrent calls for the same key share one request.
4. If that fetch fails and `staleIfError` is on, the old entry is returned however old it is. With no entry, the error is thrown.

Only `GET` requests are cached. Other methods go straight to the network.

Good to know:

- **Per-user data is kept apart.** The default key is the URL plus every request header, so calls that differ by `Authorization`, `Cookie`, an API key or any other header never share an entry. If you send a header that changes on every call (a request or trace ID), it would defeat caching; set `key` to leave it out:

  ```ts
  new CacheApi({ key: (url, init) => url + new Headers(init.headers).get("cookie") });
  ```

- **Browser cookies are not visible to the cache.** With `credentials: "include"` the browser attaches cookies itself, so they are not in the key. That is fine in a browser (one user per tab), but on a server always pass the user's cookie or token explicitly in `headers`.
- **Store failures never fail a request.** A store that throws on read counts as a miss; one that throws on write is skipped and the fresh data is still returned.
- **Aborting is per caller.** Passing `signal` rejects only your call. A request shared with other callers, or a background refresh, keeps running and still updates the cache.
- **Results are shared objects.** Every caller gets the same cached value; copy it before mutating.

## API

### `new CacheApi(options?)`

| Option                 | Default             | Description                                                                 |
| ---------------------- | ------------------- | --------------------------------------------------------------------------- |
| `baseUrl`              | `""`                | Prepended to relative paths. Absolute URLs passed to `get` are used as is.  |
| `store`                | `memoryStore()`     | Where entries live. Default holds 1000 entries. See [Stores](#stores).     |
| `maxAge`               | `Infinity`          | Seconds an entry stays fresh.                                               |
| `staleWhileRevalidate` | `0`                 | Seconds past `maxAge` to serve stale while refreshing in the background.    |
| `staleIfError`         | `true`              | On fetch failure, return the cached entry instead of throwing.              |
| `fetch`                | global `fetch`      | Custom fetch, e.g. for auth, retries or tests.                              |
| `parse`                | `res => res.json()` | Turns a `Response` into the value to cache, e.g. `res => res.text()`.       |
| `key`                  | URL + all headers   | `(url, init) => string`. Narrow it if a header changes on every call.       |

### `api.get<T>(path, options?)`

`options` is a normal `RequestInit` plus:

- `maxAge`, `staleWhileRevalidate`: override the instance defaults for this call
- `force`: skip the cached entry and fetch now (the result is still cached)

Rejects with `HttpError` (`status`, `response`) on a non-2xx response when no stale entry can be used.

### `api.invalidate(path, init?)` and `api.clear()`

Remove one entry, or every entry in the store.

## Stores

```ts
import { memoryStore } from "cache-api-local";

memoryStore(); // up to 1000 entries, least recently used evicted first
memoryStore({ max: 500 }); // smaller cap
memoryStore({ max: Infinity }); // no cap: only for a bounded set of URLs
```

Expired entries are kept (they back `staleIfError`), so the cap is what bounds memory, not `maxAge`.

A store is any object with `get`, `set`, `delete` and `clear`, sync or async. That is enough for Redis, IndexedDB, Cloudflare KV, or anything else:

```ts
import type { Store } from "cache-api-local";

const kvStore = (kv: KVNamespace): Store => ({
  get: (key) => kv.get(key, "json"),
  set: (key, entry) => kv.put(key, JSON.stringify(entry)),
  delete: (key) => kv.delete(key),
  clear: async () => {},
});
```

## Upgrading from 1.x

See [CHANGELOG.md](CHANGELOG.md#200).

## License

ISC
