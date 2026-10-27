const assert = require("node:assert/strict");
const { test } = require("node:test");

test("CommonJS entry points load", () => {
  const core = require("cache-api-local");
  const fs = require("cache-api-local/fs");
  assert.equal(typeof core.CacheApi, "function");
  assert.equal(typeof core.HttpError, "function");
  assert.equal(typeof core.memoryStore, "function");
  assert.equal(typeof fs.fsStore, "function");
});
