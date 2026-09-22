"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const npcFactionConfig = require("../src/config/npcFactionConfig");
const iffRuntime = require("../src/services/frontier/iffRuntime");
const npcBehaviorLoop = require("../src/space/npc/npcBehaviorLoop");
const npcRegistry = require("../src/space/npc/npcRegistry");
const npcService = require("../src/space/npc/npcService");

function buildNpc(itemID, factionID, options: Record<string, any> = {}) {
  return {
    itemID,
    kind: "ship",
    nativeNpc: true,
    npcEntityType: options.npcEntityType || "npc",
    npcFactionID: factionID,
    npcFactionKey: options.npcFactionKey || null,
    npcProfileID: options.npcProfileID || null,
    spawnGroupID: options.spawnGroupID || null,
    warFactionID: factionID,
    corporationID: options.corporationID || (1_000_000 + factionID),
    ownerID: options.corporationID || (1_000_000 + factionID),
    systemID: 30_000_142,
    bubbleID: 1,
    radius: 10,
    position: options.position || { x: 0, y: 0, z: 0 },
  };
}

function buildPlayer(itemID, ownerID, options: Record<string, any> = {}) {
  return {
    itemID,
    kind: "ship",
    ownerID,
    characterID: ownerID,
    pilotCharacterID: ownerID,
    session: { characterID: ownerID },
    iffTransponder: options.iffTransponder || null,
    systemID: 30_000_142,
    bubbleID: 1,
    radius: 10,
    position: options.position || { x: 1_000, y: 0, z: 0 },
  };
}

test.afterEach(() => {
  npcRegistry.clearControllers();
});

test("NPC faction config loads the shipped faction and relation matrix", () => {
  const summary = npcFactionConfig.getConfigSummary();
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.enabled, true);
  assert.equal(summary.factionCount, 20);
  assert.equal(summary.transponderEnabled, true);
  assert.equal(summary.transponderChannel, "code");
  assert.equal(summary.transponderSignalCount, 20);
  assert.equal(summary.transponderSuffixCount, 0);
  assert.equal(summary.suiWalletFundingEnabled, true);
  assert.equal(summary.suiWalletBudgetMist, "10000000000");
  assert.equal(summary.relationRuleCount, 4);
  assert.ok(summary.resolvedRelationCount > 50);
  const config = npcFactionConfig.getConfig();
  assert.equal(config.defaults.unidentifiedDisposition, "suspicious");
  assert.equal("playerDisposition" in config.defaults, false);
  assert.equal(config.defaults.hardwarePolicy.allowPlayerOwned, true);
  assert.equal(config.defaults.hardwarePolicy.allowFactionOwned, true);
  assert.equal(config.defaults.hardwarePolicy.allowCrossFactionDonation, false);
  assert.ok(config.defaults.hardwarePolicy.allowedRoles.includes("weapon"));
  assert.ok(config.defaults.hardwarePolicy.allowedRoles.includes("ammunition"));
  assert.ok(config.defaults.hardwarePolicy.allowedRoles.includes("jump_drive"));
  assert.equal(config.defaults.hardwarePolicy.equipmentLossPolicy, "return");
});

test("NPCs in one faction share a stable code across spawn groups", () => {
  const firstGroupMember = buildNpc(91_600_001, 500010, {
    spawnGroupID: "guristas_gate_patrol",
  });
  const secondGroupMember = buildNpc(91_600_002, 500010, {
    spawnGroupID: "guristas_gate_patrol",
  });
  const otherGroupMember = buildNpc(91_600_003, 500010, {
    spawnGroupID: "guristas_belt_patrol",
  });
  const frontierGroupMember = buildNpc(91_600_004, 500025, {
    npcFactionKey: "okryda",
    spawnGroupID: "frontier_okryda_dominion_cluster_with_a_long_catalog_name",
  });

  const first = iffRuntime.resolveNpcTransponder(firstGroupMember);
  const second = iffRuntime.resolveNpcTransponder(secondGroupMember);
  const other = iffRuntime.resolveNpcTransponder(otherGroupMember);
  const frontier = iffRuntime.resolveNpcTransponder(frontierGroupMember);

  assert.equal(first.channel, "code");
  assert.equal(first.signal, "GURISTAS");
  assert.equal(first.code, second.code);
  assert.equal(first.code, other.code);
  assert.equal(first.factionIdentity, "faction:id:500010");
  assert.equal(first.code, "GURISTAS");
  assert.equal(frontier.signal, "OKRYDA");
  assert.notEqual(first.code, frontier.code);
  assert.ok(frontier.code.length <= iffRuntime.IFF_CODE_MAX_LENGTH);
  assert.equal(
    frontier.code,
    iffRuntime.resolveNpcTransponder(frontierGroupMember).code,
    "the faction code must remain deterministic regardless of spawn metadata",
  );
});

test("NPC transponders require a configured faction and ignore profile metadata", () => {
  const profiled = buildNpc(91_700_001, 500024, {
    npcProfileID: "drifter_lancer",
  });
  const factionOnly = buildNpc(91_700_002, 500024);
  const legacyProfile = buildNpc(91_700_004, 0, {
    npcProfileID: "legacy_lancer",
  });

  assert.equal(
    npcFactionConfig.resolveNpcTransponderGroupIdentity(profiled),
    "faction:id:500024",
  );
  assert.equal(
    npcFactionConfig.resolveNpcTransponderGroupIdentity(factionOnly),
    "faction:id:500024",
  );
  assert.equal(
    iffRuntime.resolveNpcTransponder(profiled).code,
    iffRuntime.resolveNpcTransponder(factionOnly).code,
  );
  assert.equal(
    npcFactionConfig.resolveNpcTransponderGroupIdentity(legacyProfile),
    null,
  );
  assert.equal(iffRuntime.resolveNpcTransponder(legacyProfile), null);
  assert.equal(iffRuntime.resolveNpcTransponder(buildPlayer(91_700_003, 12345)), null);
});

test("faction transponder codes support one validated shared suffix", () => {
  const code = iffRuntime.buildNpcTransponderCode(
    "GURISTAS",
    "scout",
  );
  assert.equal(code, "GURISTAS:SCOUT");
  assert.ok(code.length <= iffRuntime.IFF_CODE_MAX_LENGTH);
  assert.equal(
    iffRuntime.buildNpcTransponderCode(
      "TRIGLAVIAN",
      "expeditionary-wing",
    ),
    iffRuntime.buildNpcTransponderCode(
      "TRIGLAVIAN",
      "expeditionary-wing",
    ),
  );
});

test("Frontier faction keys separate NPC groups that share legacy IDs and corporations", () => {
  const sharedIdentity = {
    corporationID: 1_000_287,
  };
  const osa = buildNpc(91_500_001, 500025, {
    ...sharedIdentity,
    npcFactionKey: "osa",
  });
  const secondOsa = buildNpc(91_500_002, 500025, {
    ...sharedIdentity,
    npcFactionKey: "osa",
  });
  const okryda = buildNpc(91_500_003, 500025, {
    ...sharedIdentity,
    npcFactionKey: "okryda",
  });

  assert.equal(npcFactionConfig.resolveNpcFactionDisposition(osa, secondOsa), "friendly");
  assert.equal(npcFactionConfig.resolveNpcFactionDisposition(osa, okryda), "neutral");
  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcTransponderTargetDisposition(osa, okryda),
    "suspicious",
  );
  assert.equal(npcBehaviorLoop.__testing.isFriendlyCombatTarget(osa, okryda), false);
});

test("NPC faction config validates relation identities and disposition values", () => {
  const base = {
    schemaVersion: 1,
    enabled: true,
    suiWalletFunding: {
      enabled: true,
      budgetMist: "10000000000",
      faucetEnabled: true,
      gasReserveMist: "100000000",
      maxFaucetRequests: 3,
    },
    defaults: {
      sameFactionDisposition: "friendly",
      sameCorporationDisposition: "friendly",
      unlistedNpcDisposition: "neutral",
      unidentifiedDisposition: "inherit",
      retaliateAgainstAggressors: true,
    },
    factions: [],
    relations: [],
  };
  const normalized = npcFactionConfig.validateConfig(base);
  assert.equal(normalized.defaults.hardwarePolicy.allowPlayerOwned, true);
  assert.ok(normalized.defaults.hardwarePolicy.allowedRoles.includes("mining"));
  const suffixed = npcFactionConfig.validateConfig({
    ...base,
    transponder: { enabled: true, channel: "code" },
    factions: [{
      factionID: 500010,
      name: "Guristas Pirates",
      transponderSignal: "guristas",
      transponderSuffix: "shared_wing",
    }],
  });
  assert.equal(suffixed.factions[0].transponderSuffix, "SHARED_WING");
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      transponder: { enabled: true, channel: "code" },
      factions: [{
        factionID: 500010,
        name: "Missing Signal",
      }],
    }),
    /transponderSignal is required/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      transponder: { enabled: true, channel: "code" },
      factions: [
        { factionID: 500010, name: "First", transponderSignal: "SHARED" },
        { factionID: 500011, name: "Second", transponderSignal: "shared" },
      ],
    }),
    /duplicate faction transponderSignal/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      transponder: { enabled: true, channel: "code" },
      factions: [{
        factionID: 500010,
        name: "Oversized Code",
        transponderSignal: "12345678901234567890",
        transponderSuffix: "TWELVE-CHARS",
      }],
    }),
    /32-character client code limit/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      transponder: { enabled: true, channel: "code" },
      factions: [{
        factionID: 500010,
        name: "Guristas Pirates",
        transponderSignal: "GURISTAS",
        transponderSuffix: "not shared!",
      }],
    }),
    /transponderSuffix/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      relations: [{
        id: "bad-relation",
        sourceFactionIDs: [500001],
        targetFactionIDs: [500010],
        disposition: "annoyed",
      }],
    }),
    /friendly, neutral, or hostile/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      suiWalletFunding: { ...base.suiWalletFunding, budgetMist: "01" },
    }),
    /suiWalletFunding\.budgetMist/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      defaults: {
        ...base.defaults,
        hardwarePolicy: {
          allowedRoles: ["weapon", "doomsday_bananaphone"],
        },
      },
    }),
    /unsupported/,
  );
  assert.throws(
    () => npcFactionConfig.validateConfig({
      ...base,
      defaults: {
        ...base.defaults,
        hardwarePolicy: {
          allowedRoles: ["weapon"],
          equipmentLossPolicy: "duplicate",
        },
      },
    }),
    /return or destroy/,
  );
});

test("faction relations do not bypass suspicious transponder handling", () => {
  const caldari = buildNpc(91_000_001, 500001);
  const anotherCaldari = buildNpc(91_000_002, 500001);
  const guristas = buildNpc(91_000_003, 500010);
  const ore = buildNpc(91_000_004, 500014);

  assert.equal(
    npcFactionConfig.resolveNpcFactionDisposition(caldari, guristas),
    "neutral",
  );
  assert.equal(npcBehaviorLoop.__testing.isFriendlyCombatTarget(caldari, guristas), false);
  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcTransponderTargetDisposition(caldari, guristas),
    "suspicious",
  );
  assert.equal(
    npcBehaviorLoop.__testing.isFriendlyCombatTarget(caldari, anotherCaldari),
    true,
  );
  assert.equal(
    npcBehaviorLoop.__testing.isFriendlyCombatTarget(caldari, ore),
    false,
    "an unrecognized code is investigated even when the faction pair is unlisted",
  );
});

test("unidentified targets remain suspicious until they attempt aggression", () => {
  const player = buildPlayer(92_000_001, 12_345);
  const guristas = buildNpc(92_000_002, 500010);
  const ore = buildNpc(92_000_003, 500014);

  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcTransponderTargetDisposition(guristas, player),
    "suspicious",
  );
  assert.equal(npcBehaviorLoop.__testing.isFriendlyCombatTarget(guristas, player), false);
  assert.equal(npcBehaviorLoop.__testing.isSuspiciousNpcTarget(ore, player), true);
  assert.equal(
    npcBehaviorLoop.__testing.shouldAllowNpcWeaponsAgainstTarget(ore, player),
    false,
  );

  npcRegistry.registerController({
    entityID: ore.itemID,
    systemID: ore.systemID,
    lastAggressorID: player.itemID,
    lastAggressorOwnerID: player.ownerID,
  });
  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcTransponderTargetDisposition(ore, player),
    "hostile",
    "a firing attempt promotes a suspicious contact to hostile",
  );
  assert.equal(
    npcBehaviorLoop.__testing.shouldAllowNpcWeaponsAgainstTarget(ore, player),
    true,
  );
});

test("matching transponder codes identify players and NPCs as allies", () => {
  const source = buildNpc(92_500_001, 500010, {
    spawnGroupID: "guristas_gate_patrol",
  });
  const expectedCode = iffRuntime.resolveNpcTransponder(source).code;
  const identifiedPlayer = buildPlayer(92_500_002, 12_345, {
    iffTransponder: { channel: "code", code: expectedCode },
  });
  const unidentifiedPlayer = buildPlayer(92_500_003, 12_346, {
    iffTransponder: { channel: "code", code: "WRONG-CODE" },
  });
  const identifiedFactionNpc = buildNpc(92_500_004, 500010, {
    spawnGroupID: "guristas_belt_patrol",
  });

  assert.equal(
    npcFactionConfig.resolveNpcTargetIdentification(source, identifiedPlayer),
    "ally",
  );
  assert.equal(
    npcFactionConfig.resolveNpcTargetIdentification(source, unidentifiedPlayer),
    "unidentified",
  );
  assert.equal(npcBehaviorLoop.__testing.isFriendlyCombatTarget(source, identifiedPlayer), true);
  assert.equal(npcBehaviorLoop.__testing.isFriendlyCombatTarget(source, unidentifiedPlayer), false);
  assert.equal(
    npcFactionConfig.resolveNpcFactionDisposition(source, identifiedFactionNpc),
    "friendly",
    "all spawn groups in one faction use the same code",
  );
  assert.equal(npcBehaviorLoop.__testing.isFriendlyCombatTarget(source, identifiedFactionNpc), true);
});

test("an attack attempt against a transponder ally escalates suspicious contacts", () => {
  const defender = buildNpc(92_600_001, 500001, {
    spawnGroupID: "caldari_security_patrol",
  });
  const expectedCode = iffRuntime.resolveNpcTransponder(defender).code;
  const protectedPlayer = buildPlayer(92_600_002, 12_345, {
    iffTransponder: { channel: "code", code: expectedCode },
  });
  const attacker = buildPlayer(92_600_003, 12_346, {
    iffTransponder: { channel: "code", code: "UNKNOWN-CODE" },
  });
  const controller = npcRegistry.registerController({
    entityID: defender.itemID,
    systemID: defender.systemID,
    runtimeKind: "nativeAmbient",
    nextThinkAtMs: 50_000,
  });
  const entities = new Map<any, any>([
    [defender.itemID, defender],
    [protectedPlayer.itemID, protectedPlayer],
    [attacker.itemID, attacker],
  ]);
  const scene = {
    getEntityByID(entityID) {
      return entities.get(entityID) || null;
    },
  };

  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcTransponderTargetDisposition(
      defender,
      attacker,
    ),
    "suspicious",
  );
  const result = npcService.noteNpcIncomingAggression(
    protectedPlayer,
    attacker,
    10_000,
    { scene },
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.data.propagatedEntityIDs, [defender.itemID]);
  assert.equal(controller.lastAggressorID, attacker.itemID);
  assert.equal(controller.preferredTargetID, attacker.itemID);
  assert.equal(controller.runtimeKind, "nativeCombat");
  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcTransponderTargetDisposition(
      defender,
      attacker,
    ),
    "hostile",
  );
  assert.equal(
    npcBehaviorLoop.__testing.shouldAllowNpcWeaponsAgainstTarget(
      defender,
      attacker,
    ),
    true,
  );
});

test("neutral NPC factions can retaliate without becoming permanently hostile", () => {
  const ore = buildNpc(93_000_001, 500014);
  const caldari = buildNpc(93_000_002, 500001);

  npcRegistry.registerController({
    entityID: ore.itemID,
    systemID: ore.systemID,
    lastAggressorID: caldari.itemID,
    lastAggressorOwnerID: caldari.ownerID,
  });
  assert.equal(
    npcBehaviorLoop.__testing.isFriendlyCombatTarget(ore, caldari),
    false,
  );

  const unrelatedCaldari = buildNpc(93_000_003, 500001, {
    corporationID: caldari.corporationID,
  });
  assert.equal(
    npcBehaviorLoop.__testing.isFriendlyCombatTarget(ore, unrelatedCaldari),
    false,
    "aggression is remembered by owner so another ship controlled by that owner remains answerable",
  );
});

test("faction policy adds target classes and selects suspicious contacts", () => {
  const source = buildNpc(94_000_001, 500001, {
    position: { x: 0, y: 0, z: 0 },
  });
  const friendly = buildNpc(94_000_002, 500001, {
    position: { x: 500, y: 5_000, z: 0 },
  });
  const hostile = buildNpc(94_000_003, 500010, {
    position: { x: 2_000, y: 0, z: 0 },
  });
  const targetClasses = npcBehaviorLoop.__testing.applyNpcFactionTargetClasses(
    source,
    ["player"],
  );
  assert.deepEqual(targetClasses.sort(), ["concord", "drone", "npc", "player"]);
  assert.deepEqual(
    npcBehaviorLoop.__testing.applyNpcFactionTargetClasses(hostile, []).sort(),
    ["concord", "drone", "npc", "player"],
    "suspicious contacts enroll players, drones, and NPCs for investigation",
  );

  const scene = {
    dynamicEntities: new Map([
      [source.itemID, source],
      [friendly.itemID, friendly],
      [hostile.itemID, hostile],
    ]),
    staticEntities: [],
  };
  const selected = npcBehaviorLoop.__testing.findNearestCombatTarget(
    scene,
    source,
    100_000,
    { allowedTargetClasses: targetClasses },
  );
  assert.equal(selected && selected.itemID, hostile.itemID);
});

test("dungeon arrivals wake faction-appropriate hostile and friendly responses", () => {
  const nowMs = 1_800_000;
  const responder = buildNpc(95_000_001, 500001);
  const hostileArrival = buildNpc(95_000_002, 500010);
  const friendlyArrival = buildNpc(95_000_003, 500001);
  const hostileController = npcRegistry.registerController({
    entityID: responder.itemID,
    systemID: responder.systemID,
    runtimeKind: "nativeAmbient",
    behaviorProfile: {
      autoAggro: true,
      autoAggroTargetClasses: ["player"],
    },
    nextThinkAtMs: nowMs + 30_000,
  });

  assert.equal(
    npcBehaviorLoop.resolveNpcDungeonArrivalDisposition(
      responder,
      hostileArrival,
      hostileController,
    ),
    "suspicious",
  );
  const hostileResponse = npcBehaviorLoop.noteDungeonArrivalResponse(
    responder.itemID,
    hostileArrival.itemID,
    "suspicious",
    nowMs,
  );
  assert.equal(hostileResponse.success, true);
  assert.equal(hostileController.preferredTargetID, hostileArrival.itemID);
  assert.equal(hostileController.investigatingTargetID, hostileArrival.itemID);
  assert.equal(hostileController.runtimeKind, "nativeCombat");
  assert.equal(hostileController.nextThinkAtMs, nowMs);
  assert.equal(hostileController.lastAggressorID, undefined);

  assert.equal(
    npcBehaviorLoop.resolveNpcDungeonArrivalDisposition(
      responder,
      friendlyArrival,
      hostileController,
    ),
    "friendly",
  );
  const friendlyResponse = npcBehaviorLoop.noteDungeonArrivalResponse(
    responder.itemID,
    friendlyArrival.itemID,
    "friendly",
    nowMs + 1_000,
  );
  assert.equal(friendlyResponse.success, true);
  assert.equal(
    hostileController.preferredAssistanceTargetID,
    friendlyArrival.itemID,
  );
  assert.equal(
    hostileController.friendlyDungeonArrivalEntityID,
    friendlyArrival.itemID,
  );
  assert.ok(hostileController.friendlyDungeonArrivalResponseUntilMs > nowMs + 1_000);
});

test("unidentified player dungeon arrivals start an investigation", () => {
  const player = buildPlayer(96_000_001, 12_345);
  const hostileNpc = buildNpc(96_000_002, 500010);
  const retaliationOnlyNpc = buildNpc(96_000_003, 500014);

  assert.equal(
    npcBehaviorLoop.resolveNpcDungeonArrivalDisposition(hostileNpc, player),
    "suspicious",
  );
  assert.equal(
    npcBehaviorLoop.resolveNpcDungeonArrivalDisposition(retaliationOnlyNpc, player),
    "suspicious",
    "all configured factions investigate an unidentified arrival without attacking first",
  );
});

test("dungeon arrival notification reaches only existing NPCs in the same instance", () => {
  const nowMs = 2_000_000;
  const arrivingPlayer = {
    ...buildPlayer(97_000_001, 12_345),
    dungeonCurrentInstanceID: 8_001,
    dungeonCurrentSiteID: 71,
  };
  const sameDungeonNpc = {
    ...buildNpc(97_000_002, 500010),
    dungeonSiteInstanceID: 8_001,
    dungeonSiteID: 71,
  };
  const otherDungeonNpc = {
    ...buildNpc(97_000_003, 500010),
    dungeonSiteInstanceID: 8_002,
    dungeonSiteID: 71,
  };
  const sameDungeonController = npcRegistry.registerController({
    entityID: sameDungeonNpc.itemID,
    systemID: sameDungeonNpc.systemID,
    runtimeKind: "nativeCombat",
    behaviorProfile: { autoAggro: true },
    nextThinkAtMs: nowMs + 10_000,
  });
  const otherDungeonController = npcRegistry.registerController({
    entityID: otherDungeonNpc.itemID,
    systemID: otherDungeonNpc.systemID,
    runtimeKind: "nativeCombat",
    behaviorProfile: { autoAggro: true },
    nextThinkAtMs: nowMs + 10_000,
  });
  const entities = new Map<any, any>([
    [arrivingPlayer.itemID, arrivingPlayer],
    [sameDungeonNpc.itemID, sameDungeonNpc],
    [otherDungeonNpc.itemID, otherDungeonNpc],
  ]);
  const scene = {
    systemID: arrivingPlayer.systemID,
    getEntityByID(entityID) {
      return entities.get(entityID) || null;
    },
  };

  const result = npcService.notifyNpcDungeonArrival(
    scene,
    arrivingPlayer,
    nowMs,
  );
  assert.equal(result.success, true);
  assert.equal(result.data.responseCount, 1);
  assert.equal(result.data.hostileResponseCount, 0);
  assert.equal(result.data.suspiciousResponseCount, 1);
  assert.equal(sameDungeonController.preferredTargetID, arrivingPlayer.itemID);
  assert.equal(sameDungeonController.investigatingTargetID, arrivingPlayer.itemID);
  assert.equal(sameDungeonController.nextThinkAtMs, nowMs);
  assert.equal(otherDungeonController.preferredTargetID, undefined);
  assert.equal(otherDungeonController.nextThinkAtMs, nowMs + 10_000);
});
