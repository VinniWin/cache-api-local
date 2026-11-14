# cache-api-local

Tiny, zero-dependency cache for `fetch`. Stale-while-revalidate, concurrent request dedupe, stale-if-error fallback, and pluggable storage. Runs on Node, Deno, Bun, browsers and edge runtimes.

- About 2 KB gzipped core, no dependencies
- Typed results with `get<T>()`
- ESM and CommonJS, with types for both
- Memory store everywhere, filesystem store on server runtimes, `localStorage` store in browsers, or bring your own
- Optional `ETag` revalidation: an unchanged resource is confirmed with a `304`, not downloaded again
- Optional `Cache-Control` support: the server decides how long each response stays fresh
- Tags to invalidate a group of entries at once, and `subscribe` to hear about refreshed data

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

By default files stay until `invalidate` or `clear` removes them, so a long-running process with many URLs keeps growing on disk. Give the store a `ttl` in seconds to bound it:

```ts
fsStore(".cache/api", { ttl: 7 * 24 * 3600 }); // drop entries fetched more than a week ago
```

An entry older than `ttl` reads as a miss, and its file is deleted during a later write (the directory is scanned at most once per `ttl`, or once an hour if that is shorter). Keep `ttl` well above `maxAge + staleWhileRevalidate`: an entry past `ttl` is gone, so it can no longer back `staleIfError`.

### Persist in the browser

```ts
import { CacheApi } from "cache-api-local";
import { webStore } from "cache-api-local/web";

const api = new CacheApi({ baseUrl: "https://api.example.com", store: webStore() });
```

`webStore()` keeps entries in `localStorage`, so the cache survives a page reload. Pass `{ storage: sessionStorage }` to keep it for the tab only, or `{ prefix: "my-app:" }` to change the item names (default `cache-api-local:`).

- Values must be JSON-serializable, as with `fsStore`.
- Item names are a hash of the key, so tokens and cookies in the key are never stored.
- `localStorage` holds about 5 MB per origin. When it is full, the store drops its own entries and stores the new one. `clear` removes only its own items.
- It needs `crypto.subtle`, which browsers provide on HTTPS and localhost only. On a plain `http://` page nothing is cached and every call goes to the network.
- Call it in the browser, not during server rendering, where `localStorage` does not exist.

### Skip downloads of unchanged data

```ts
const api = new CacheApi({ baseUrl: "https://api.example.com", maxAge: 60, etag: true });
```

With `etag: true` the response's `ETag` header is stored with the entry. When the entry expires, the next request sends it as `If-None-Match`; if the server answers `304 Not Modified`, the cached value is kept and counts as fresh again, with no body downloaded or parsed. Servers that send no `ETag` behave as before.

It is off by default because of browsers: on a cross-origin request `If-None-Match` triggers a CORS preflight, and the server must allow that header and expose `ETag`. On servers, and for same-origin requests, it is safe to turn on.

### Let the server decide freshness

```ts
const api = new CacheApi({ baseUrl: "https://api.example.com", cacheControl: true, maxAge: 60 });
```

With `cacheControl: true` the response's `Cache-Control` header sets the freshness of that entry:

| Server sends          | Effect                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `max-age=N`           | Fresh for `N` seconds, less the response's `Age` header. Replaces the instance `maxAge`. |
| `no-cache`            | Stored, but revalidated on every call. Still backs `staleIfError`.                       |
| `no-store`            | Never stored, and any older entry for that request is removed.                           |
| nothing, or other directives | The instance `maxAge` applies.                                                   |

A `maxAge` passed to `get` still wins over the server. `s-maxage` is ignored, since it addresses shared proxies. The server's `stale-while-revalidate` directive is not read; use the `staleWhileRevalidate` option.

### Invalidate a group with tags

```ts
await api.get("/users/1", { tags: ["users"] });
await api.get("/users?page=2", { tags: ["users"] });

await api.get("/users/1", { method: "PATCH", body: "..." });
await api.invalidateTag("users"); // both entries are gone
```

Give related requests the same tag, then drop them all with one call after a mutation. An entry can carry several tags and is dropped by any of them.

- It works with every store, including your own, and reaches every `CacheApi` instance sharing the store (for example several servers on one Redis).
- A request still running when the tag is invalidated does not keep its result.
- Nothing is scanned or deleted: `invalidateTag` saves one small marker entry per tag in the store, and tagged entries older than the marker read as missing. Reading a tagged entry therefore costs one extra store read per tag.
- The tags of an entry are those of the call that last fetched it.

### React to refreshed data

```ts
const stop = api.subscribe<Post>("/posts/1", (post) => render(post));

render(await api.get<Post>("/posts/1")); // may be stale; the callback fires when the refresh lands
stop(); // when the view goes away
```

With `staleWhileRevalidate`, `get` answers with the stale value and refreshes in the background. `subscribe` is how the caller learns about the new value. The callback runs for every new value of that request: a fetch, a background refresh, or `set`. It does not run on a cache hit or on a `304`.

It only sees changes made through the same `CacheApi` instance, not other tabs or processes. As with `invalidate`, pass the same `init` you use with `get` when the key depends on headers.

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
| `etag`                 | `false`             | Revalidate with `If-None-Match` and reuse the cached value on a `304`.      |
| `cacheControl`         | `false`             | Let the response's `Cache-Control` set freshness per entry.                 |
| `fetch`                | global `fetch`      | Custom fetch, e.g. for auth, retries or tests.                              |
| `parse`                | `res => res.json()` | Turns a `Response` into the value to cache, e.g. `res => res.text()`.       |
| `key`                  | URL + all headers   | `(url, init) => string`. Narrow it if a header changes on every call.       |

### `api.get<T>(path, options?)`

`options` is a normal `RequestInit` plus:

- `maxAge`, `staleWhileRevalidate`: override the instance defaults for this call
- `tags`: labels stored with the entry, for `invalidateTag`
- `force`: skip the cached entry and fetch now (the result is still cached). Always a full download, even with `etag` on.

Rejects with `HttpError` (`status`, `response`) on a non-2xx response when no stale entry can be used.

### `api.peek<T>(path, init?)` and `api.set(path, value, init?)`

Read and write the cache directly, with no network call.

- `peek` resolves with the cached value however old it is, or `undefined` when nothing is cached.
- `set` stores `value` as a fresh entry. A request already running for that entry will not overwrite it.

```ts
// Optimistic update: show the change now, roll back if the server rejects it.
const before = await api.peek<User>("/users/1");
await api.set("/users/1", { ...before, name: "New name" });
try {
  await api.get("/users/1", { method: "PATCH", body: JSON.stringify({ name: "New name" }) });
} catch {
  await api.set("/users/1", before);
}
```

`set` also prefills the cache, for example with data the server already rendered into the page. As with `invalidate`, pass the same `init` you use with `get` when the key depends on headers. `init` may also carry `tags`.

### `api.subscribe<T>(path, callback, init?)`

Calls `callback(value)` for every new value of that request and returns a function that stops it. See [React to refreshed data](#react-to-refreshed-data).

### `api.invalidateTag(tag)`

Drops every entry fetched or set with `tag`. See [Invalidate a group with tags](#invalidate-a-group-with-tags).

### `api.invalidate(path, init?)` and `api.clear()`

Remove one entry, or every entry in the store.

The default key includes the request headers, so an entry fetched with headers is only removed when `invalidate` gets the same ones. Without them it removes nothing and does not throw:

```ts
const init = { headers: { Authorization: "Bearer abc" } };
await api.get("/users", init);
await api.invalidate("/users"); // different key: the entry stays
await api.invalidate("/users", init); // removed
```

## Stores

```ts
import { memoryStore } from "cache-api-local";

memoryStore(); // up to 1000 entries, least recently used evicted first
memoryStore({ max: 500 }); // smaller cap
memoryStore({ max: Infinity }); // no cap: only for a bounded set of URLs
```

Expired entries are kept (they back `staleIfError`), so the cap is what bounds memory, not `maxAge`. Each invalidated tag also takes one slot.

A store is any object with `get`, `set`, `delete` and `clear`, sync or async. That is enough for Redis, IndexedDB, Cloudflare KV, or anything else. Save and return the whole entry: `value`, `time`, and the optional `etag`, `tags` and `maxAge`. A store that drops the optional fields still caches, but `etag`, tags and `cacheControl` stop working with it:

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
