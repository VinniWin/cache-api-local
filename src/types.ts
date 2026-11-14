type MaybePromise<T> = T | Promise<T>;

/** A cached value plus the time it was fetched. */
export interface Entry<T = unknown> {
  value: T;
  /** Epoch milliseconds when the value was fetched. */
  time: number;
  /** The response's `ETag`, kept only when the `etag` option is on. Stores must hand it back unchanged. */
  etag?: string;
  /** Tags given to the `get` or `set` that produced the entry. Stores must hand them back unchanged. */
  tags?: string[];
  /** Seconds of freshness the server asked for, kept only when the `cacheControl` option is on. */
  maxAge?: number;
}

/** Storage backend. Sync or async; implement these four methods to cache anywhere. */
export interface Store {
  get(key: string): MaybePromise<Entry | undefined>;
  set(key: string, entry: Entry): MaybePromise<void>;
  delete(key: string): MaybePromise<void>;
  clear(): MaybePromise<void>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CacheOptions {
  /** Prepended to every relative path. Absolute URLs passed to `get` are used as is. */
  baseUrl?: string;
  /** Where entries live. Default: `memoryStore()`. */
  store?: Store;
  /** Seconds an entry stays fresh. Default: `Infinity` (never expires). */
  maxAge?: number;
  /** Seconds past `maxAge` during which the stale entry is returned and refreshed in the background. Default: `0`. */
  staleWhileRevalidate?: number;
  /** Return the cached entry, however old, when the request fails. Default: `true`. */
  staleIfError?: boolean;
  /**
   * Remember each response's `ETag` and send it as `If-None-Match` on the next refresh, so an unchanged
   * resource answers `304` with no body. Default: `false`, because in browsers the header makes
   * cross-origin requests preflight and the server must allow it.
   */
  etag?: boolean;
  /**
   * Let the response's `Cache-Control` decide freshness: `max-age=N` (less `Age`) replaces `maxAge` for that
   * entry, `no-cache` makes it always stale, and `no-store` keeps it out of the store. Default: `false`.
   */
  cacheControl?: boolean;
  /** Custom fetch implementation. Default: the global `fetch`. */
  fetch?: FetchLike;
  /** Turns a response into the value to cache. Default: `res.json()`. */
  parse?: (res: Response) => Promise<unknown>;
  /** Cache key for a request. Default: the full URL plus every request header. Narrow it if a header (e.g. a trace ID) changes on every call. */
  key?: (url: string, init: RequestInit) => string;
}

export interface GetOptions extends RequestInit {
  /** Labels stored with the entry, so `invalidateTag` can drop a whole group at once. */
  tags?: string[];
  /** Overrides `CacheOptions.maxAge`, and the server's `max-age`, for this call. */
  maxAge?: number;
  /** Overrides `CacheOptions.staleWhileRevalidate` for this call. */
  staleWhileRevalidate?: number;
  /** Skip the cached entry and fetch now. The result is still cached. */
  force?: boolean;
}
