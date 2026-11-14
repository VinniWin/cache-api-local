import { memoryStore } from "./memory";
import type { CacheOptions, Entry, FetchLike, GetOptions, Store } from "./types";

/** Thrown when the server answers with a non-2xx status. */
export class HttpError extends Error {
  readonly status: number;
  readonly response: Response;

  constructor(response: Response) {
    super(`HTTP ${response.status} ${response.statusText}`.trim());
    this.name = "HttpError";
    this.status = response.status;
    this.response = response;
  }
}

/**
 * Default key: the URL plus every request header, so requests differing by Authorization, Cookie,
 * an API key or any other header never share an entry. `Headers` lowercases and sorts names.
 */
function defaultKey(url: string, init: RequestInit): string {
  let key = url;
  for (const [name, value] of new Headers(init.headers)) key += `\n${name}: ${value}`;
  return key;
}

/** Store key of the marker recording when `tag` was last invalidated. It starts with a newline, which no URL does. */
const tagKey = (tag: string) => `\ntag:${tag}`;

/**
 * Seconds of freshness the server asked for: `max-age` less the response's `Age`, 0 for `no-cache`,
 * -1 for `no-store`, undefined when the response says nothing.
 */
function serverMaxAge(res: Response): number | undefined {
  const header = res.headers.get("cache-control") ?? "";
  if (/\bno-store\b/i.test(header)) return -1;
  if (/\bno-cache\b/i.test(header)) return 0;
  const match = /\bmax-age=(\d+)/i.exec(header); // `s-maxage` has no hyphen there, so it never matches
  return match ? Math.max(0, Number(match[1]) - (Number(res.headers.get("age")) || 0)) : undefined;
}

/** Settles with `promise`, or rejects as soon as `signal` aborts. The underlying request keeps running. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    // Attached before the aborted check so `promise` always has a handler and never rejects unhandled.
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) onAbort();
  });
}

export class CacheApi {
  private readonly baseUrl: string;
  private readonly store: Store;
  private readonly maxAge: number;
  private readonly swr: number;
  private readonly staleIfError: boolean;
  private readonly etag: boolean;
  private readonly cacheControl: boolean;
  private readonly fetchFn: FetchLike;
  private readonly parse: (res: Response) => Promise<unknown>;
  private readonly keyFn: (url: string, init: RequestInit) => string;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  private stamp = 0;

  constructor(options: CacheOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.store = options.store ?? memoryStore();
    this.maxAge = options.maxAge ?? Infinity;
    this.swr = options.staleWhileRevalidate ?? 0;
    this.staleIfError = options.staleIfError ?? true;
    this.etag = options.etag ?? false;
    this.cacheControl = options.cacheControl ?? false;
    // Wrapped, not stored directly: calling a bare global `fetch` as a method throws "Illegal invocation" in browsers.
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.parse = options.parse ?? ((res) => res.json());
    this.keyFn = options.key ?? defaultKey;
  }

  /** Fetch `path`, served from cache when fresh. Only GET requests are cached; other methods pass straight through. */
  async get<T = unknown>(path: string, options: GetOptions = {}): Promise<T> {
    const { maxAge, staleWhileRevalidate = this.swr, force = false, signal, tags, ...init } = options;
    const url = this.url(path);
    if ((init.method ?? "GET").toUpperCase() !== "GET") return (await this.load(url, { ...init, signal })).fresh.value as T;

    // `signal` stays out of the shared request: one caller aborting must not fail the others sharing it.
    const key = this.keyFn(url, init);
    const entry = await this.read(key);

    if (entry && !force) {
      // Clamped: `now` can run a few milliseconds ahead of the clock, which must not make `maxAge: 0` look fresh.
      const age = Math.max(0, Date.now() - entry.time) / 1000;
      const fresh = maxAge ?? (this.cacheControl ? entry.maxAge : undefined) ?? this.maxAge;
      if (age < fresh) return entry.value as T;
      if (age < fresh + staleWhileRevalidate) {
        // Failure is ignored on purpose: the stale entry stays and the next call retries.
        this.revalidate(key, url, init, tags, entry).catch(() => {});
        return entry.value as T;
      }
    }

    try {
      // `force` asks for a full download, so the cached entry is not offered for a 304.
      return (await abortable(this.revalidate(key, url, init, tags, force ? undefined : entry), signal)) as T;
    } catch (err) {
      if (entry && this.staleIfError && !signal?.aborted) return entry.value as T;
      throw err;
    }
  }

  /** The cached value for `path`, however old, without fetching. `undefined` when nothing is cached. */
  async peek<T = unknown>(path: string, init: RequestInit = {}): Promise<T | undefined> {
    return (await this.read(this.keyFn(this.url(path), init)))?.value as T | undefined;
  }

  /** Store `value` as the fresh entry for `path`, e.g. after a mutation or to prefill from server-rendered data. */
  async set(path: string, value: unknown, init: RequestInit & { tags?: string[] } = {}): Promise<void> {
    const { tags, ...rest } = init;
    const key = this.keyFn(this.url(path), rest);
    this.inflight.delete(key); // a request already running must not overwrite this value
    const entry: Entry = { value, time: this.now() };
    if (tags?.length) entry.tags = tags;
    await this.store.set(key, entry);
    this.notify(key, value);
  }

  /**
   * Call `callback` with every new value for `path`: from a fetch, a background refresh or `set`.
   * Returns a function that stops it. Only sees changes made through this instance.
   */
  subscribe<T = unknown>(path: string, callback: (value: T) => void, init: RequestInit = {}): () => void {
    const key = this.keyFn(this.url(path), init);
    const callbacks = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, callbacks);
    callbacks.add(callback as (value: unknown) => void);
    return () => {
      callbacks.delete(callback as (value: unknown) => void);
      if (!callbacks.size && this.listeners.get(key) === callbacks) this.listeners.delete(key);
    };
  }

  /** Remove the cached entry for `path`. Pass the same `init` used with `get` if the key depends on it. */
  async invalidate(path: string, init: RequestInit = {}): Promise<void> {
    const key = this.keyFn(this.url(path), init);
    this.inflight.delete(key); // a request already running must not write the old data back
    await this.store.delete(key);
  }

  /**
   * Drop every entry fetched or set with `tag`, in every instance sharing the store. Nothing is deleted:
   * a marker records the time, and entries tagged before it read as missing from then on.
   */
  async invalidateTag(tag: string): Promise<void> {
    await this.store.set(tagKey(tag), { value: null, time: this.now() });
  }

  /** Remove every entry in the store. */
  async clear(): Promise<void> {
    this.inflight.clear();
    await this.store.clear();
  }

  private url(path: string): string {
    if (!this.baseUrl || /^[a-z][a-z\d+.-]*:/i.test(path)) return path;
    return `${this.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  /**
   * Epoch milliseconds, but never the same value twice: a `set` right after an `invalidateTag`
   * must get a later time than the marker, even inside one millisecond.
   */
  private now(): number {
    return (this.stamp = Math.max(Date.now(), this.stamp + 1));
  }

  /** True when any of `tags` was invalidated at or after `since`. */
  private async invalidated(tags: string[] | undefined, since: number): Promise<boolean> {
    for (const tag of tags ?? []) {
      const marker = await this.store.get(tagKey(tag));
      if (marker && marker.time >= since) return true;
    }
    return false;
  }

  /** A broken store degrades to a cache miss instead of failing the request. So does an entry whose tag was invalidated. */
  private async read(key: string): Promise<Entry | undefined> {
    try {
      const entry = await this.store.get(key);
      return entry && (await this.invalidated(entry.tags, entry.time)) ? undefined : entry;
    } catch {
      return undefined;
    }
  }

  private notify(key: string, value: unknown): void {
    for (const callback of this.listeners.get(key) ?? []) {
      try {
        callback(value);
      } catch {
        // A subscriber that throws must not fail the request that produced the value, or the other subscribers.
      }
    }
  }

  /** Fetch and store, sharing one request between concurrent callers of the same key. */
  private revalidate(key: string, url: string, init: RequestInit, tags?: string[], entry?: Entry): Promise<unknown> {
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const started = this.now();
    const request: Promise<unknown> = this.load(url, init, entry)
      .then(async ({ fresh, keep }) => {
        // Skip the write if invalidate, clear or set dropped this request while it ran.
        if (this.inflight.get(key) === request) {
          let outdated = false;
          try {
            if (keep) {
              await this.store.set(key, tags?.length ? { ...fresh, tags } : fresh);
              // Checked after the write, so a tag invalidated at any point while the request ran is caught.
              outdated = await this.invalidated(tags, started);
            }
            // `no-store`, or data from before a tag invalidation: nothing may stay, not even an older entry.
            if (!keep || outdated) await this.store.delete(key);
          } catch {
            // A failed write only costs a future miss; the caller still gets fresh data.
          }
          // A 304 hands back the same value, which subscribers already have.
          if (!outdated && fresh.value !== entry?.value) this.notify(key, fresh.value);
        }
        return fresh.value;
      })
      .finally(() => {
        if (this.inflight.get(key) === request) this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  /**
   * Fetch and parse. With the `etag` option, `entry` is offered to the server and reused on a 304.
   * `keep` is false when the server said `no-store`.
   */
  private async load(url: string, init: RequestInit, entry?: Entry): Promise<{ fresh: Entry; keep: boolean }> {
    let sent: string | undefined;
    if (this.etag && entry?.etag) {
      const headers = new Headers(init.headers);
      // A caller sending its own If-None-Match handles the 304 itself.
      if (!headers.has("if-none-match")) {
        sent = entry.etag;
        headers.set("if-none-match", sent);
        init = { ...init, headers };
      }
    }
    const res = await this.fetchFn(url, init);
    // 304: the server confirmed the cached value is current, so it becomes fresh again without a download.
    const unchanged = sent !== undefined && res.status === 304;
    if (!unchanged && !res.ok) throw new HttpError(res);

    const fresh: Entry = { value: unchanged ? entry!.value : await this.parse(res), time: this.now() };
    const etag = unchanged ? res.headers.get("etag") ?? sent : this.etag && res.headers.get("etag");
    if (etag) fresh.etag = etag;
    const maxAge = this.cacheControl ? serverMaxAge(res) ?? (unchanged ? entry!.maxAge : undefined) : undefined;
    if (maxAge !== undefined && maxAge >= 0) fresh.maxAge = maxAge;
    return { fresh, keep: maxAge !== -1 };
  }
}
