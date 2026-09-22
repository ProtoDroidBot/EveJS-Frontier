const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createTypeListAuthority,
  expandTypeList,
  matchesTypeListInAuthority,
  isTradableInventoryItemInAuthority,
} = require(path.join(__dirname, "../src/services/inventory/typeListAuthority"));
const typeListAuthority = require(path.join(__dirname, "../src/services/inventory/typeListAuthority"));
const itemTypeRegistry = require(path.join(__dirname, "../src/services/inventory/itemTypeRegistry"));
const dungeonAuthority = require(path.join(__dirname, "../src/services/dungeon/dungeonAuthority"));
const KeeperService = require(path.join(__dirname, "../src/services/dungeon/keeperService"));
const TradeMgrService = require(path.join(__dirname, "../src/services/trade/tradeMgrService"));
const mobileAnalysisBeaconRuntime = require(path.join(
  __dirname, "../src/services/ship/mobileAnalysisBeaconRuntime",
));
const AutoMoonMiningService = require(path.join(
  __dirname, "../src/services/structure/autoMoonMiningService",
));
const industryRuntimeState = require(path.join(
  __dirname, "../src/services/industry/industryRuntimeState",
));
const miningIndustry = require(path.join(
  __dirname, "../src/services/mining/miningIndustry",
));
const EssMgrService = require(path.join(
  __dirname, "../src/services/dynamic/essMgrService",
));
const { resolveDungeonShipRestrictions } = require(path.join(
  __dirname, "../src/services/dungeon/dungeonShipRestrictionResolver",
));

function ids(authority, listID) {
  const members = expandTypeList(authority, listID);
  return members ? [...members].sort((left, right) => left - right) : null;
}

test("Frontier typelists union includes, subtract excludes, then filter tags", () => {
  const authority = createTypeListAuthority({
    source: { buildNumber: 3502403, typeListsSha256: "test-lists", typesSha256: "test-types" },
    typeLists: [
      { listID: 1, includedCategoryIDs: [6], includedTypeIDs: [100], excludedGroupIDs: [10] },
      { listID: 2, includedTags: [213], excludedTags: [203], filterByTags: [204], requireAllFilteredTags: 1 },
      { listID: 3, includedTypeListIDs: [2], excludedTypeIDs: [103] },
      { listID: 4, includedTypeIDs: [100, 101], filterByTags: [10], requireAllFilteredTags: 0 },
      { listID: 5, includedTypeListIDs: [6] },
      { listID: 6, includedTypeListIDs: [5] },
      { listID: 7, includedTypeListIDs: [999] },
      { listID: 8, includedTypeIDs: [100, 101], filterByTags: [204, 213], requireAllFilteredTags: 1 },
      { listID: 9, includedTypeListIDs: [2], excludedTypeListIDs: [3] },
      { listID: 10 },
      { listID: 11, includedGroupIDs: [0], includedCategoryIDs: [0] },
      { listID: 36, includedTypeIDs: [100] },
      { listID: 142, includedTypeIDs: [103] },
    ],
  }, [
    { typeID: 100, groupID: 10, categoryID: 6, tags: [213, 204] },
    { typeID: 101, groupID: 11, categoryID: 6, tags: [214, 204] },
    { typeID: 102, groupID: 12, categoryID: 7, tags: [213, 203] },
    { typeID: 103, groupID: 13, categoryID: 8, tags: [213, 204] },
    { typeID: 104, groupID: null, categoryID: null },
  ]);

  assert.equal(authority.versionKey, "3502403:test-lists:test-types");
  assert.deepEqual(ids(authority, 1), [101]); // A direct include does not override a group exclusion.
  assert.deepEqual(ids(authority, 2), [100, 103]);
  assert.deepEqual(ids(authority, 3), [100]);
  assert.deepEqual(ids(authority, 4), [100]); // Client uses group IDs for the non-all filter branch.
  assert.equal(ids(authority, 5), null); // Recursive or broken lists fail closed.
  assert.equal(ids(authority, 7), null);
  assert.deepEqual(ids(authority, 8), [100]);
  assert.deepEqual(ids(authority, 9), [103]);
  assert.deepEqual(ids(authority, 10), []);
  assert.deepEqual(ids(authority, 11), []); // Missing metadata is not group/category zero.
  assert.equal(matchesTypeListInAuthority(authority, { typeID: 100 }, 3), true);
  assert.equal(matchesTypeListInAuthority(authority, { typeID: 103 }, 3), false);
  assert.equal(isTradableInventoryItemInAuthority(authority, { typeID: 100 }), false);
  assert.equal(isTradableInventoryItemInAuthority(authority, { typeID: 101 }), true);
  assert.equal(isTradableInventoryItemInAuthority(authority, { typeID: 999 }), false);
});

test("legacy six-field typelists remain readable", () => {
  const authority = createTypeListAuthority({
    typeLists: [{ listID: 9, includedGroupIDs: [10], excludedTypeIDs: [101] }],
  }, [
    { typeID: 100, groupID: 10, categoryID: 6 },
    { typeID: 101, groupID: 10, categoryID: 6 },
  ]);
  assert.deepEqual(ids(authority, 9), [100]);
});

test("gameplay fallbacks apply only when the authored list is absent", () => {
  const types = [
    { typeID: 100, groupID: 547, categoryID: 6 },
    { typeID: 101, groupID: 547, categoryID: 6 },
    { typeID: 102, groupID: 427, categoryID: 4 },
  ];
  const standardBeacon = 60244;
  const carrierBeacon = 92183;
  typeListAuthority._setTypeListAuthorityForTests({
    source: { buildNumber: 3502403, typeListsSha256: "fallback-test" },
    typeLists: [
      { listID: 300, includedTypeIDs: [100] },
      { listID: 611 },
    ],
  }, types);
  try {
    const canLink = mobileAnalysisBeaconRuntime._testing.isShipTypeLinkableForBeaconType;
    assert.equal(canLink(standardBeacon, types[0]), true);
    assert.equal(canLink(standardBeacon, types[1]), false); // Present list overrides group fallback.
    assert.equal(canLink(carrierBeacon, types[1]), true); // 946 is absent in this build.
    assert.equal(canLink(carrierBeacon, { typeID: 103, groupID: 485, categoryID: 6 }), false);
    assert.equal(AutoMoonMiningService._testing.isAutoMoonMinerOutputMaterial(types[2]), false);
    assert.equal(industryRuntimeState._testing.isLowerInventionSkillProbability(23087), true);

    typeListAuthority._setTypeListAuthorityForTests({
      source: { buildNumber: 3502403, typeListsSha256: "missing-611" },
      typeLists: [
        { listID: 300, includedTypeIDs: [100] },
        { listID: 799 },
      ],
    }, types);
    assert.equal(AutoMoonMiningService._testing.isAutoMoonMinerOutputMaterial(types[2]), true);
    assert.equal(industryRuntimeState._testing.isLowerInventionSkillProbability(23087), false);
  } finally {
    typeListAuthority._setTypeListAuthorityForTests(null);
  }
});

test("trade checks nested items before staging and again before settlement", () => {
  const types = [
    { typeID: 100, groupID: 10, categoryID: 4 },
    { typeID: 101, groupID: 10, categoryID: 4 },
  ];
  typeListAuthority._setTypeListAuthorityForTests({
    typeLists: [
      { listID: 36 },
      { listID: 142, includedTypeIDs: [101] },
    ],
  }, types);
  const trade = Object.create(TradeMgrService.prototype);
  const root = { itemID: 501, typeID: 100, ownerID: 77 };
  const child = { itemID: 502, typeID: 100, ownerID: 77 };
  trade._collectContainedItems = () => [child];
  trade._listTradeItems = () => [root];
  const staged = {
    traders: [77, 88],
    stagedItemOrigins: new Map([[501, { ownerID: 77 }]]),
  };
  try {
    assert.equal(trade._isTradeTreeEligible(root), true);
    assert.equal(trade._areStagedTradeTreesEligible(staged), true);
    child.typeID = 101;
    assert.equal(trade._isTradeTreeEligible(root), false);
    assert.equal(trade._areStagedTradeTreesEligible(staged), false);
    child.typeID = 100;
    child.ownerID = 99;
    assert.equal(trade._isTradeTreeEligible(root), false);
  } finally {
    typeListAuthority._setTypeListAuthorityForTests(null);
  }
});

test("structure compression checks list 336 at the mutation helper", () => {
  const item = { typeID: 100 };
  typeListAuthority._setTypeListAuthorityForTests({
    typeLists: [{ listID: 336 }],
  }, [{ typeID: 100, groupID: 450, categoryID: 25 }]);
  try {
    assert.equal(miningIndustry.isCompressionSourceAllowed(item, { requiredTypeListID: 336 }), false);
    assert.equal(miningIndustry.isCompressionSourceAllowed(item), true); // In-space mapping is separate.
    typeListAuthority._setTypeListAuthorityForTests({
      typeLists: [{ listID: 336, includedGroupIDs: [450] }],
    }, [{ typeID: 100, groupID: 450, categoryID: 25 }]);
    assert.equal(miningIndustry.isCompressionSourceAllowed(item, { requiredTypeListID: 336 }), true);
  } finally {
    typeListAuthority._setTypeListAuthorityForTests(null);
  }
});

test("ESS link attempts without an in-space ship fail closed", () => {
  assert.equal(EssMgrService._testing.validateEssLinkEligibility(
    { characterID: 77 },
    { essID: 501, mainBankLink: null, reserveLinkedCharacterIDs: new Set() },
    "main",
  ), "LINK_ERROR_NO_BALLPARK");
});

test("dungeon restriction display and gate enforcement use the same membership", () => {
  const types = [
    { typeID: 100, groupID: 10, categoryID: 6, name: "Allowed ship", raceID: 1 },
    { typeID: 101, groupID: 10, categoryID: 6, name: "Excluded ship", raceID: 1 },
  ];
  const previousGetDungeon = dungeonAuthority.getClientDungeonByID;
  itemTypeRegistry._setEntriesForTests(types);
  typeListAuthority._setTypeListAuthorityForTests({
    typeLists: [{ listID: 900, includedGroupIDs: [10], excludedTypeIDs: [101] }],
  }, types);
  dungeonAuthority.getClientDungeonByID = () => ({
    connections: [{ fromObjectID: 77, allowedShipsList: 900 }],
  });
  try {
    const restrictions = resolveDungeonShipRestrictions(123, 77);
    assert.deepEqual(restrictions.allowedShipTypes, [100]);
    assert.deepEqual(restrictions.restrictedShipTypes, [101]);
    const gate = { dungeonGateAllowedShipsList: 900 };
    const gateState = { metadata: { allowedShipsList: 900 } };
    assert.doesNotThrow(() => KeeperService._testing.assertShipMayUseGate(types[0], gate, gateState));
    assert.throws(() => KeeperService._testing.assertShipMayUseGate(types[1], gate, gateState));
  } finally {
    dungeonAuthority.getClientDungeonByID = previousGetDungeon;
    typeListAuthority._setTypeListAuthorityForTests(null);
    itemTypeRegistry._setEntriesForTests(null);
  }
});

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
}

const snapshot = path.resolve(__dirname, "../../_local/frontier-sde/3502403");
const fixture = require("./fixtures/frontierTypeListClient3502403.json");
test("build 3502403 membership matches the installed client bytecode oracle", {
  skip: !fs.existsSync(path.join(snapshot, "typeLists.jsonl")),
}, () => {
  const listsPath = path.join(snapshot, "typeLists.jsonl");
  const typesPath = path.join(snapshot, "types.jsonl");
  const hash = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  assert.equal(hash(listsPath), fixture.source.typeListsSha256);
  assert.equal(hash(typesPath), fixture.source.typesSha256);

  const groups = new Map(readJsonl(path.join(snapshot, "groups.jsonl"))
    .map((row) => [row._key, row.categoryID]));
  const types = readJsonl(typesPath).map((row) => ({
    ...row,
    typeID: row._key,
    categoryID: groups.get(row.groupID),
  }));
  const authority = createTypeListAuthority({
    source: { buildNumber: 3502403, typeListsSha256: hash(listsPath), typesSha256: hash(typesPath) },
    typeLists: readJsonl(listsPath),
  }, types);

  for (const listID of [36, 142, 231, 300, 336, 492, 599, 601, 612, 613, 861, 923, 985]) {
    assert.ok(authority.byID.has(listID), `P2 list ${listID} exists in build 3502403`);
  }
  for (const listID of [611, 799, 946]) {
    assert.equal(authority.byID.has(listID), false, `P2 fallback list ${listID} is absent`);
  }
  for (const listID of [599, 612, 613]) {
    assert.equal(matchesTypeListInAuthority(authority, 91374, listID), true);
    assert.equal(matchesTypeListInAuthority(authority, 95349, listID), true);
    assert.equal(matchesTypeListInAuthority(authority, 92394, listID), false);
  }
  assert.equal(matchesTypeListInAuthority(authority, 92394, 601), true);
  assert.equal(matchesTypeListInAuthority(authority, 95349, 601), false);
  assert.equal(matchesTypeListInAuthority(authority, 95349, 985), true);

  for (const [listID, [expectedCount, expectedHash]] of Object.entries<any>(fixture.membership)) {
    const members = ids(authority, Number(listID));
    assert.ok(members, `List ${listID} failed to expand`);
    assert.equal(members.length, expectedCount, `List ${listID} member count`);
    const digest = crypto.createHash("sha256").update(members.join(",")).digest("hex");
    assert.equal(digest, expectedHash, `List ${listID} client membership digest`);
  }

  const catalogDigestInput = [...authority.byID.keys()].sort((left, right) => left - right)
    .map((listID) => {
      const members = ids(authority, listID);
      assert.ok(members, `List ${listID} failed to expand`);
      const digest = crypto.createHash("sha256").update(members.join(",")).digest("hex");
      return `${listID}:${digest}`;
    }).join("|");
  assert.equal(authority.byID.size, 420);
  assert.equal(
    crypto.createHash("sha256").update(catalogDigestInput).digest("hex"),
    fixture.catalogSha256,
    "full Frontier typelist catalog matches the installed client",
  );
});
