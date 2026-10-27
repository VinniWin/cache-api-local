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
  private readonly fetchFn: FetchLike;
  private readonly parse: (res: Response) => Promise<unknown>;
  private readonly keyFn: (url: string, init: RequestInit) => string;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: CacheOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.store = options.store ?? memoryStore();
    this.maxAge = options.maxAge ?? Infinity;
    this.swr = options.staleWhileRevalidate ?? 0;
    this.staleIfError = options.staleIfError ?? true;
    // Wrapped, not stored directly: calling a bare global `fetch` as a method throws "Illegal invocation" in browsers.
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.parse = options.parse ?? ((res) => res.json());
    this.keyFn = options.key ?? defaultKey;
  }

  /** Fetch `path`, served from cache when fresh. Only GET requests are cached; other methods pass straight through. */
  async get<T = unknown>(path: string, options: GetOptions = {}): Promise<T> {
    const { maxAge = this.maxAge, staleWhileRevalidate = this.swr, force = false, signal, ...init } = options;
    const url = this.url(path);
    if ((init.method ?? "GET").toUpperCase() !== "GET") return (await this.load(url, { ...init, signal })) as T;

    // `signal` stays out of the shared request: one caller aborting must not fail the others sharing it.
    const key = this.keyFn(url, init);
    const entry = await this.read(key);

    if (entry && !force) {
      const age = (Date.now() - entry.time) / 1000;
      if (age < maxAge) return entry.value as T;
      if (age < maxAge + staleWhileRevalidate) {
        // Failure is ignored on purpose: the stale entry stays and the next call retries.
        this.revalidate(key, url, init).catch(() => {});
        return entry.value as T;
      }
    }

    try {
      return (await abortable(this.revalidate(key, url, init), signal)) as T;
    } catch (err) {
      if (entry && this.staleIfError && !signal?.aborted) return entry.value as T;
      throw err;
    }
  }

  /** Remove the cached entry for `path`. Pass the same `init` used with `get` if the key depends on it. */
  async invalidate(path: string, init: RequestInit = {}): Promise<void> {
    const key = this.keyFn(this.url(path), init);
    this.inflight.delete(key); // a request already running must not write the old data back
    await this.store.delete(key);
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

  /** A broken store degrades to a cache miss instead of failing the request. */
  private async read(key: string): Promise<Entry | undefined> {
    try {
      return await this.store.get(key);
    } catch {
      return undefined;
    }
  }

  /** Fetch and store, sharing one request between concurrent callers of the same key. */
  private revalidate(key: string, url: string, init: RequestInit): Promise<unknown> {
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request: Promise<unknown> = this.load(url, init)
      .then(async (value) => {
        // Skip the write if invalidate or clear dropped this request while it ran.
        if (this.inflight.get(key) === request) {
          try {
            await this.store.set(key, { value, time: Date.now() });
          } catch {
            // A failed write only costs a future miss; the caller still gets fresh data.
          }
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === request) this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  private async load(url: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchFn(url, init);
    if (!res.ok) throw new HttpError(res);
    return this.parse(res);
  }
}
