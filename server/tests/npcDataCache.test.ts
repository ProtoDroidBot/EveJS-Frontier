"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("NPC generated-table indexes are reused across repeated lookups", () => {
  const npcData = require("../src/space/npc/npcData");
  const authoredRows = [{ profileID: "cached_profile", name: "Cached Profile" }];
  let generatedCatalogReads = 0;
  const dependencies = {
    readAuthoredNpcRows: () => authoredRows,
    buildNpcRows: (_tableName, rows) => {
      generatedCatalogReads += 1;
      return rows;
    },
  };

  npcData._testing.clearTableIndexCache("npcProfiles");
  const first = npcData._testing.getNpcTableIndex(
    "npcProfiles",
    dependencies,
  );
  const second = npcData._testing.getNpcTableIndex(
    "npcProfiles",
    dependencies,
  );

  assert.equal(second, first);
  assert.equal(generatedCatalogReads, 1);
  npcData._testing.clearTableIndexCache("npcProfiles");
});
