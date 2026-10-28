import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { auditTypeLists, compareTypeListCatalogs } from "../type-list-audit.mjs";

const require = createRequire(import.meta.url);
const {
  clientTypeListRecord,
  clientTypeListCounts,
  publicTypeRecord,
  typeRecord,
} = require("../../DatabaseCreator/database-creator.js");

test("game-store records preserve Frontier typelist rules and type tags", () => {
  const row = {
    _key: 565,
    name: "Synod Fabricator",
    description: "Composite industry outputs",
    displayNameID: 123,
    includedCategoryIDs: [6],
    excludedCategoryIDs: [],
    includedGroupIDs: [],
    excludedGroupIDs: [10],
    includedTypeIDs: [100],
    excludedTypeIDs: [],
    includedTypeListIDs: [623],
    excludedTypeListIDs: [624],
    includedTags: [213],
    excludedTags: [212],
    filterByTags: [204],
    requireAllFilteredTags: 1,
  };
  const record = clientTypeListRecord(row);
  assert.equal(record.listID, 565);
  assert.equal(record.name, row.name);
  assert.equal(record.description, row.description);
  assert.equal(record.displayNameID, 123);
  assert.deepEqual(record.includedTypeListIDs, [623]);
  assert.deepEqual(record.excludedTypeListIDs, [624]);
  assert.deepEqual(record.includedTags, [213]);
  assert.deepEqual(record.excludedTags, [212]);
  assert.deepEqual(record.filterByTags, [204]);
  assert.equal(record.requireAllFilteredTags, 1);
  assert.equal(clientTypeListCounts([record]).includedTypeListReferenceCount, 1);
  assert.equal(clientTypeListCounts([record]).filterTagReferenceCount, 1);

  const type = typeRecord(
    { _key: 100, groupID: 10, name: { en: "Tagged type" }, tags: [213, 204] },
    new Map([[10, { categoryID: 6, name: { en: "Group" } }]]),
    new Map([[6, { name: { en: "Ship" } }]]),
  );
  assert.deepEqual(type.tags, [213, 204]);
  assert.deepEqual(publicTypeRecord(type, "full").tags, [213, 204]);
  assert.deepEqual(publicTypeRecord(type, "skill").tags, [213, 204]);
});

test("typelist audit reports missing runtime IDs and empty authored lists without failing them", () => {
  const report = auditTypeLists({
    lists: [
      { _key: 1, includedTypeIDs: [100], includedTypeListIDs: [2] },
      { _key: 2, includedTags: [213], filterByTags: [204] },
      { _key: 3 },
    ],
    categories: [{ _key: 6 }],
    groups: [{ _key: 10 }],
    types: [{ _key: 100, tags: [213, 204] }],
    runtimeBindings: [
      { listID: 1, consumer: "present" },
      { listID: 3, consumer: "empty" },
      { listID: 9, consumer: "missing" },
    ],
  });
  assert.equal(report.counts.errors, 0);
  assert.deepEqual(report.emptyListIDs, [3]);
  assert.deepEqual(report.missingRuntimeBindings.map((entry) => entry.listID), [9]);
  assert.deepEqual(report.emptyRuntimeBindings.map((entry) => entry.listID), [3]);
});

test("typelist audit rejects duplicate IDs, dangling references, and nested cycles", () => {
  const report = auditTypeLists({
    lists: [
      { _key: 1, includedTypeListIDs: [2], includedTypeIDs: [999] },
      { _key: 2, includedTypeListIDs: [1, 5] },
      { _key: 2, includedTypeIDs: [100] },
    ],
    categories: [],
    groups: [],
    types: [{ _key: 100, tags: [] }],
    runtimeBindings: [],
  });
  const codes = report.errors.map((issue) => issue.code);
  assert.ok(codes.includes("duplicate-or-invalid-list-id"));
  assert.ok(codes.includes("unknown-reference"));
  assert.ok(codes.includes("nested-list-cycle"));
});

test("typelist audit fails closed for missing or empty authoritative runtime lists", () => {
  const report = auditTypeLists({
    lists: [{ _key: 1 }],
    categories: [],
    groups: [],
    types: [],
    runtimeBindings: [
      { listID: 1, consumer: "empty authority", required: true },
      { listID: 2, consumer: "missing authority", required: true },
    ],
  });
  assert.deepEqual(report.errors.map((issue) => issue.code), [
    "missing-runtime-list",
    "empty-runtime-list",
  ]);
});

test("typelist audit reports additions, removals, and changed rules across builds", () => {
  const delta = compareTypeListCatalogs(
    [
      { listID: 1, name: "Same", includedTypeIDs: [100] },
      { listID: 2, name: "Changed", includedTypeIDs: [200] },
      { listID: 3, name: "Removed", includedTypeIDs: [300] },
    ],
    [
      { _key: 1, name: "Same", includedTypeIDs: [100, 100] },
      { _key: 2, name: "Changed", includedTypeIDs: [201] },
      { _key: 4, name: "Added", includedTypeIDs: [400] },
    ],
  );
  assert.deepEqual(delta.addedIDs, [4]);
  assert.deepEqual(delta.removedIDs, [3]);
  assert.deepEqual(delta.changedIDs, [2]);
});
