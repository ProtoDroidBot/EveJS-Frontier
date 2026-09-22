"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TYPE_CUTTING_LASER,
  TYPE_CRUDE_EXTRACTOR,
  TYPE_NEEDLE,
  applySkillShotUtilityHit,
  getHeldBeamUtilityProfile,
} = require("../src/services/frontier/skillShotUtilityRuntime");
const miningRuntime = require("../src/services/mining/miningRuntime");
const typeListAuthority = require("../src/services/inventory/typeListAuthority");
const {
  buildMiningModuleSnapshot,
} = require("../src/services/mining/miningDogma");

function runUtilityHit(moduleTypeID, miningResult) {
  const calls: any[] = [];
  const result = applySkillShotUtilityHit({
    scene: { systemID: 30000001 },
    sourceEntity: { itemID: 101 },
    targetEntity: { itemID: 202 },
    moduleItem: { itemID: 301, typeID: moduleTypeID },
    chargeItem: { itemID: 401, typeID: 82124 },
    nowMs: 12_345,
    rampMultiplier: 1.75,
    miningRuntime: {
      executeSkillShotMiningCycle(...args) {
        calls.push(args);
        return miningResult;
      },
    },
  });
  return { calls, result };
}

test("build 3502403 utility profiles distinguish multipurpose beams from the Crude Extractor", () => {
  assert.deepEqual(getHeldBeamUtilityProfile(TYPE_CUTTING_LASER), {
    kind: "multipurpose",
    allowsCombatDamage: true,
  });
  assert.deepEqual(getHeldBeamUtilityProfile(TYPE_CRUDE_EXTRACTOR), {
    kind: "crude_extraction",
    allowsCombatDamage: false,
  });
  assert.deepEqual(getHeldBeamUtilityProfile(TYPE_NEEDLE), {
    kind: "multipurpose",
    allowsCombatDamage: true,
  });
  assert.equal(getHeldBeamUtilityProfile(95753), null);
});

test("a mineable first collision is terminal and receives the authored held-beam ramp", () => {
  const { calls, result } = runUtilityHit(TYPE_CUTTING_LASER, {
    matched: true,
    success: true,
    data: { transferredQuantity: 7 },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].itemID, 101);
  assert.equal(calls[0][2].itemID, 202);
  assert.equal(calls[0][6].rampMultiplier, 1.75);
  assert.equal(result.matched, true);
  assert.equal(result.blockCombatDamage, true);
  assert.equal(result.utilityKind, "multipurpose");
  assert.equal(result.data.transferredQuantity, 7);
});

test("Crude Extractor never falls through to combat damage", () => {
  const { result } = runUtilityHit(TYPE_CRUDE_EXTRACTOR, {
    matched: false,
  });

  assert.equal(result.matched, false);
  assert.equal(result.blockCombatDamage, true);
  assert.equal(result.utilityKind, "crude_extraction");
});

test("Cutting Laser and Needle may damage only a non-mineable first collision", () => {
  for (const moduleTypeID of [TYPE_CUTTING_LASER, TYPE_NEEDLE]) {
    const { result } = runUtilityHit(moduleTypeID, { matched: false });
    assert.equal(result.matched, false);
    assert.equal(result.blockCombatDamage, false);
  }
});

test("mining efficiency and held-beam ramp scale authored miningAmount", () => {
  const cutting = miningRuntime._testing.resolveSkillShotMiningAmountMultiplier(
    { miningEfficiencyPercent: 60 },
    2.3,
  );
  assert.deepEqual(cutting, {
    authoredEfficiency: 0.6,
    rampMultiplier: 2.3,
    amountMultiplier: 1.38,
  });

  const needle = miningRuntime._testing.resolveSkillShotMiningAmountMultiplier(
    { miningEfficiencyPercent: 48 },
    2.5,
  );
  assert.deepEqual(needle, {
    authoredEfficiency: 0.48,
    rampMultiplier: 2.5,
    amountMultiplier: 1.2,
  });

  const crude = miningRuntime._testing.resolveSkillShotMiningAmountMultiplier(
    { miningEfficiencyPercent: 90 },
    1,
  );
  assert.deepEqual(crude, {
    authoredEfficiency: 0.9,
    rampMultiplier: 1,
    amountMultiplier: 0.9,
  });
});

test("all three held-beam modules mine their collision target without a lock or second volatility roll", () => {
  const profiles = [
    [TYPE_CUTTING_LASER, 13, 60, 2.3, 17.94],
    [TYPE_CRUDE_EXTRACTOR, 2.7, 90, 1, 2.43],
    [TYPE_NEEDLE, 10.4, 48, 2.5, 12.48],
  ];

  for (const [moduleTypeID, miningAmountM3, efficiency, ramp, expectedVolume] of profiles) {
    const cycleCalls: any[] = [];
    const crude = moduleTypeID === TYPE_CRUDE_EXTRACTOR;
    const yieldTypeID = crude ? 92394 : 91374;
    const lensListID = crude ? 601 : 612;
    const result = miningRuntime.executeSkillShotMiningCycle(
      {
        systemID: 30000001,
        getEntityByID: (itemID) => itemID === 202 ? { itemID: 202, groupID: crude ? 4593 : 450 } : null,
      },
      {
        itemID: 101,
        // Deliberately no targeting state: the swept collision is authority.
      },
      { itemID: 202, groupID: crude ? 4593 : 450 },
      { itemID: 301, typeID: moduleTypeID, flagID: 184 },
      { itemID: 401, typeID: crude ? 77518 : 83463 },
      12_345,
      {
        rampMultiplier: ramp,
        ensureSceneMiningState() {},
        getMineableState: () => ({
          entityID: 202,
          yieldTypeID,
          yieldKind: "ore",
          remainingQuantity: 100,
          unitVolume: 1,
        }),
        buildEntityMiningSnapshot: () => ({
          family: "ore",
          moduleTypeID,
          chargeTypeID: crude ? 77518 : 83463,
          crystalTargetTypeListID: lensListID,
          miningAmountM3,
          miningEfficiencyPercent: efficiency,
        }),
        isChargeCompatibleWithModule: () => true,
        isChargeValidForYield: () => true,
        matchesTypeList: ({ typeID }, listID) =>
          listID === lensListID && typeID === yieldTypeID,
        executeMiningCycle(...args) {
          cycleCalls.push(args);
          return {
            success: true,
            data: {
              transferredQuantity: expectedVolume,
            },
          };
        },
      },
    );

    assert.equal(result.matched, true);
    assert.equal(result.success, true);
    assert.equal(result.data.transferredQuantity, expectedVolume);
    assert.equal(result.data.amountMultiplier, efficiency / 100 * ramp);
    assert.equal(cycleCalls.length, 1);
    assert.equal(cycleCalls[0][2].targetID, 202);
    assert.equal(cycleCalls[0][4].requireTargetLock, false);
    assert.equal(cycleCalls[0][4].applyCrystalVolatility, false);
    assert.ok(Math.abs(
      miningAmountM3 * cycleCalls[0][4].amountMultiplier - expectedVolume,
    ) < 1e-9);
  }
});

test("held-beam extraction refuses to run without an equipped lens", () => {
  const result = miningRuntime.executeSkillShotMiningCycle(
    { systemID: 30000001 },
    { itemID: 101 },
    { itemID: 202 },
    { itemID: 301, typeID: TYPE_CUTTING_LASER },
    null,
    12_345,
  );
  assert.deepEqual(result, {
    matched: true,
    success: false,
    stopReason: "charge",
  });
});

test("held-beam mining denies the wrong target family before the transfer", () => {
  let transferred = false;
  const result = miningRuntime.executeSkillShotMiningCycle(
    { systemID: 30000001 },
    { itemID: 101 },
    { itemID: 202, groupID: 4593, frontierRiftResource: true },
    { itemID: 301, typeID: TYPE_CUTTING_LASER, flagID: 184 },
    { itemID: 401, typeID: 83463 },
    12_345,
    {
      ensureSceneMiningState() {},
      getMineableState: () => ({
        yieldTypeID: 92394,
        yieldKind: "ore",
        remainingQuantity: 100,
        unitVolume: 1,
      }),
      buildEntityMiningSnapshot: () => ({
        family: "ore",
        moduleTypeID: TYPE_CUTTING_LASER,
        chargeTypeID: 83463,
        crystalTargetTypeListID: 612,
        miningAmountM3: 13,
      }),
      isChargeCompatibleWithModule: () => true,
      isChargeValidForYield: () => true,
      matchesTypeList: ({ typeID }, listID) => listID === 601 && typeID === 92394,
      executeMiningCycle() {
        transferred = true;
        return { success: true };
      },
    },
  );
  assert.equal(result.matched, true);
  assert.equal(result.success, false);
  assert.equal(result.stopReason, "module");
  assert.equal(transferred, false);
});

test("lens authorization uses the mined source type, not its output item", () => {
  const validate = miningRuntime._testing.isChargeValidForYield;
  const matchesTypeList = ({ typeID }, listID) =>
    listID === 612 && [77800, 91374, 95349].includes(typeID);
  const lens = { typeID: 83463 };
  const snapshot = { crystalTargetTypeListID: 612 };
  assert.equal(validate(
    lens,
    { visualTypeID: 95349, yieldTypeID: 88764, yieldKind: "salvage" },
    snapshot,
    { matchesTypeList },
  ), true);
  assert.equal(validate(
    lens,
    { visualTypeID: 92394, yieldTypeID: 77800, yieldKind: "ore" },
    snapshot,
    { matchesTypeList },
  ), false);
});

test("generated Frontier typelists authorize salvageable wreckage but not crude for asteroid lenses", (t) => {
  if (!typeListAuthority.getTypeList(612)) {
    t.skip("generated Frontier typelist store not loaded");
    return;
  }
  const validate = miningRuntime._testing.isChargeValidForYield;
  const salvageable = { visualTypeID: 95349, yieldTypeID: 88764, yieldKind: "salvage" };
  const crude = { visualTypeID: 92394, yieldTypeID: 92394, yieldKind: "ore" };
  for (const listID of [599, 612, 613]) {
    assert.equal(validate({ typeID: 83463 }, salvageable, { crystalTargetTypeListID: listID }), true);
    assert.equal(validate({ typeID: 83463 }, crude, { crystalTargetTypeListID: listID }), false);
  }
  assert.equal(validate({ typeID: 77518 }, crude, { crystalTargetTypeListID: 601 }), true);
  assert.equal(validate({ typeID: 77518 }, salvageable, { crystalTargetTypeListID: 601 }), false);
});

test("depleted utility resources remain terminal non-combat collisions", () => {
  const result = miningRuntime.executeSkillShotMiningCycle(
    { systemID: 30000001 },
    { itemID: 101 },
    { itemID: 202 },
    { itemID: 301, typeID: TYPE_NEEDLE },
    { itemID: 401, typeID: 77800 },
    12_345,
    {
      ensureSceneMiningState() {},
      getMineableState: () => ({
        yieldTypeID: 91374,
        yieldKind: "ore",
        remainingQuantity: 0,
      }),
    },
  );

  assert.deepEqual(result, {
    matched: true,
    success: false,
    stopReason: "target",
  });
});

test("authored lens type lists reject the other held-beam resource family", {
  skip: process.env.EVEJS_TEST_FRONTIER_FIXTURES !== "1",
}, () => {
  const validate = miningRuntime._testing.isChargeValidForYield;
  const cuttingLens = { itemID: 401, typeID: 77800 };
  const crudeLens = { itemID: 402, typeID: 77518 };

  assert.equal(validate(
    cuttingLens,
    { yieldTypeID: 95349, yieldKind: "salvage" },
    { crystalTargetTypeListID: 612 },
  ), true);
  assert.equal(validate(
    cuttingLens,
    { yieldTypeID: 92394, yieldKind: "ore" },
    { crystalTargetTypeListID: 612 },
  ), false);
  assert.equal(validate(
    crudeLens,
    { yieldTypeID: 92394, yieldKind: "ore" },
    { crystalTargetTypeListID: 601 },
  ), true);
  assert.equal(validate(
    crudeLens,
    { yieldTypeID: 95349, yieldKind: "salvage" },
    { crystalTargetTypeListID: 601 },
  ), false);
});

test("build 3502403 dogma supplies held-beam mining amount, efficiency, and lens list", {
  skip: process.env.EVEJS_TEST_FRONTIER_FIXTURES !== "1",
}, () => {
  const shipItem = { itemID: 101, typeID: 95735 };
  const cases = [
    [TYPE_CUTTING_LASER, 83463, 13, 60, 612],
    [TYPE_CRUDE_EXTRACTOR, 77518, 2.7, 90, 601],
    [TYPE_NEEDLE, 95779, 10.4, 48, 612],
  ];

  for (const [moduleTypeID, chargeTypeID, amount, efficiency, typeListID] of cases) {
    const snapshot = buildMiningModuleSnapshot({
      shipItem,
      moduleItem: { itemID: 301, typeID: moduleTypeID, flagID: 183 },
      chargeItem: { itemID: 401, typeID: chargeTypeID, flagID: 184 },
    });
    assert.ok(snapshot);
    assert.equal(snapshot.miningAmountM3, amount);
    assert.equal(snapshot.miningEfficiencyPercent, efficiency);
    assert.equal(snapshot.crystalTargetTypeListID, typeListID);
  }
});
