import * as fs from "fs";
import * as path from "path";
import CacheApi from "../src";

function cleanupCache(relativePath: string) {
  const dirPath = path.resolve(__dirname, relativePath);
  if (fs.existsSync(dirPath)) {
    console.log(`🧹 Cleaning up: ${dirPath}`);
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

async function runCacheTest(
  baseUrl: string,
  cacheDir: string,
  endpoint: string,
  cacheKey: string,
  expectedFileName: string
) {
  const resolvedCacheDir = path.resolve(__dirname, cacheDir);
  cleanupCache(cacheDir);
  const api = new CacheApi(baseUrl, cacheDir, 100);
  console.log(`\n🚀 Test: Caching in '${cacheDir}'`);

  try {
    const data1 = await api.getData(endpoint, cacheKey);
    console.log(`📥 Fetched (API): ${data1.id}`);

    const data2 = await api.getData(endpoint, cacheKey);
    console.log(`📦 Fetched (Cache): ${data2.id}`);

    const expectedPath = path.join(
      resolvedCacheDir,
      cacheKey,
      expectedFileName
    );
    if (fs.existsSync(expectedPath)) {
      console.log(`✅ Cache file exists at: ${expectedPath}`);
    } else {
      console.error(`❌ Cache file NOT FOUND at: ${expectedPath}`);
    }
  } catch (e) {
    console.error(`❗ Error in test for '${cacheDir}':`, e);
  } finally {
    cleanupCache(cacheDir);
  }
}

async function runTests() {
  await runCacheTest(
    "https://jsonplaceholder.typicode.com",
    "data",
    "/photos/1?t=test1",
    "album1_photos",
    "photos_1_t=test1.json"
  );

  await runCacheTest(
    "https://jsonplaceholder.typicode.com",
    "../project_level_cache",
    "/posts/1?v=alpha",
    "user_posts",
    "posts_1_v=alpha.json"
  );

  await runCacheTest(
    "https://jsonplaceholder.typicode.com",
    "data_original_test",
    "/photos/1?t=12",
    "photo",
    "photos_1_t=12.json"
  );

  console.log("\n✅ All tests completed.");
}

runTests().catch((e) => console.error("💥 Global test error:", e));
