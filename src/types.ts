type MaybePromise<T> = T | Promise<T>;

/** A cached value plus the time it was fetched. */
export interface Entry<T = unknown> {
  value: T;
  /** Epoch milliseconds when the value was fetched. */
  time: number;
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
  /** Custom fetch implementation. Default: the global `fetch`. */
  fetch?: FetchLike;
  /** Turns a response into the value to cache. Default: `res.json()`. */
  parse?: (res: Response) => Promise<unknown>;
  /** Cache key for a request. Default: the full URL plus every request header. Narrow it if a header (e.g. a trace ID) changes on every call. */
  key?: (url: string, init: RequestInit) => string;
}

export interface GetOptions extends RequestInit {
  /** Overrides `CacheOptions.maxAge` for this call. */
  maxAge?: number;
  /** Overrides `CacheOptions.staleWhileRevalidate` for this call. */
  staleWhileRevalidate?: number;
  /** Skip the cached entry and fetch now. The result is still cached. */
  force?: boolean;
}
