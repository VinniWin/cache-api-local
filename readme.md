# 📦 cache-api-local

> A simple file-based caching wrapper for HTTP APIs using Node.js — ideal for prototyping, testing, and reducing redundant API calls.

---

## 🚀 Features

* ⚡ **Fast Local Caching**: Save API responses to the filesystem as `.json` files for quick retrieval.
* ⏱ **Cache Expiration**: Automatically refreshes data after a configurable `maxAge` (in seconds).
* 🔒 **Safe File Naming**: Sanitizes URL paths and query strings into valid, unique filenames.
* 🔄 **Auto Fallback**: If a live fetch fails, falls back to the most recent cached copy.
* 🧪 **Test-Friendly**: Easy to plug into testing pipelines or local dev environments.

---

## 📥 Installation

```bash
npm install cache-api-local
```

---

## 🧪 Example Usage

```ts
import CacheApi from "cache-api-local";

const api = new CacheApi("https://jsonplaceholder.typicode.com", "data", 300);

// Fetches from API (and caches)
const data1 = await api.getData("/photos/1?t=12", "photo");

// Within 300 seconds, this fetches from cache
const data2 = await api.getData("/photos/1?t=12", "photo");

console.log(data2);
```

---

## 🧰 Constructor

```ts
new CacheApi(baseUrl: string, cacheFolderName: string, maxAgeInSeconds?: number)
```

### Parameters:

| Name              | Type     | Description                                          |
| ----------------- | -------- | ---------------------------------------------------- |
| `baseUrl`         | `string` | The base API URL (e.g. `https://api.example.com`)    |
| `cacheFolderName` | `string` | Folder (relative to caller) where cache is stored    |
| `maxAgeInSeconds` | `number` | Optional. Time after which cache is considered stale |

---

## 📂 How It Works

* Responses are saved as JSON files under the specified folder.
* URLs are converted to safe filenames (e.g. `/posts/1?v=alpha` → `posts_1_v=alpha.json`).
* Metadata is stored in `.meta.json` files to track freshness.
* If data is older than `maxAge`, it fetches fresh data and updates the cache.
* If fetching fails, it tries using the cached version.

---

## ✅ Good Use Cases

* Avoid rate-limiting or repeated API calls in development.
* Improve speed of integration tests.
* Work offline with previously fetched data.

---

## 🧼 Cache Cleanup

All cached data is stored under the directory you specify (e.g. `data/`, `project_cache/`), and can be safely deleted if needed.

---

## 📌 Notes

* Works in Node.js environments (not for browser).
* You can set `maxAge` to a large value (or leave it out) to avoid expiry.

---

## 🧱 Example Project Structure

```
my-project/
├── src/
│   └── index.ts
├── data/
│   └── photo/
│       └── photos_1_t=12.json
└── ...
```

---

## 📃 License

MIT © You
