const test = require("node:test");
const assert = require("node:assert/strict");

const objectCacheRuntime = require("../src/services/cache/objectCacheRuntime");
const objectCacheCodecPool = require("../src/services/cache/objectCacheCodecPool");
const searchIndexPool = require("../src/services/_other/searchIndexPool");
const TaleMgrService = require("../src/services/tale/taleMgrService");

test("object-cache marshal and checksums run in a bounded codec worker", async (t) => {
  t.after(async () => objectCacheCodecPool.close());
  const payload = [
    "cache-isolation",
    Buffer.from("worker-buffer"),
    Array.from({ length: 50 }, (_, id) => [id, `row-${id}`]),
  ];
  const synchronous = objectCacheRuntime.buildCachedMethodCallResult(payload, {
    serviceName: "isolationTest",
    method: "GetPayloadSync",
  });
  const isolated = await objectCacheRuntime.buildCachedMethodCallResultAsync(payload, {
    serviceName: "isolationTest",
    method: "GetPayloadAsync",
  });
  assert.deepEqual(isolated.args[1], synchronous.args[1]);
  assert.equal(isolated.args[2].items[1], synchronous.args[2].items[1], "Adler-32 must remain wire compatible");
  const liveProxyResult = await new TaleMgrService().callMethod(
    "GetGlobalWorldEventTales",
    [],
    null,
    null,
  );
  assert.equal(liveProxyResult.name.value, "carbon.common.script.net.objectCaching.CachedMethodCallResult");
  assert.equal(liveProxyResult.args[1].name.value, "carbon.common.script.net.cachedObject.CachedObject");
  assert.equal(objectCacheCodecPool.getPendingTaskCount(), 0);
});

test("search filtering runs in the index worker without retaining transient owner indexes", async (t) => {
  t.after(async () => searchIndexPool.close());
  const entries = [
    { id: 1, name: "Jita IV - Moon 4" },
    { id: 2, name: "New Caldari" },
    { id: 3, name: "Jita Trading Annex" },
  ];
  assert.deepEqual(await searchIndexPool.searchEntries(entries, "jita", 0, 10), [1, 3]);
  assert.deepEqual(await searchIndexPool.searchEntries(entries, "new caldari", 1, 10), [2]);
  assert.deepEqual(await searchIndexPool.getWorkerStats(), { indexCount: 0, queryCount: 0 });
  assert.equal(searchIndexPool.getPendingTaskCount(), 0);
});
