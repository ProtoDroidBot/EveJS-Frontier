"use strict";

const crypto = require("node:crypto");

// Local, conservative allocation policy. These are verified target types, but
// the server-only npcGrouping roster and locator encounter catalog are absent.
const NPC_ALLOCATION_POLICY = Object.freeze({
  version: 1, watcherTypeID: 83566, patrolTypeID: 94167,
  groupingReplacements: Object.freeze({ 33025: 83566 }),
  provenance: "temporary server allocation; not the official encounter roster",
  grouping33025Evidence: "Watcher has the authored behaviorName 1981 and groupBehaviorID 2086",
  missingGuard: Object.freeze({ aggressionRange: 75000, orbitRange: 5000, entitySpawnOnce: 1 }),
});

function numeric(value, fallback = 0) {
  const n = Number(value); return Number.isFinite(n) ? n : fallback;
}
function vector(value) {
  const out = { x: numeric(value?.x, NaN), y: numeric(value?.y, NaN), z: numeric(value?.z, NaN) };
  if (!Object.values(out).every(Number.isFinite)) throw new TypeError("NPC position must be finite");
  return out;
}
function values(value) { return Array.isArray(value) ? value : Object.values(value || {}); }
function npcSourceKey(object) {
  return [object.patternKind || "entry", object.dungeonID, object.occurrenceIndex || 0,
    object.roomID, object.objectID].join(":");
}
function isTemporaryLandscapeNpcType(type) {
  return Number(type?.categoryID) === 11 && [5081, 5130].includes(Number(type?.groupID));
}
function boundedGuard(value = {}) {
  const guard = { ...NPC_ALLOCATION_POLICY.missingGuard, ...value };
  for (const field of ["aggressionRange", "orbitRange", "entityDelaySpawn", "entityMinRespawnDelay", "entityMaxRespawnDelay"]) {
    if (guard[field] != null && (!Number.isFinite(Number(guard[field])) || Number(guard[field]) < 0)) throw new TypeError(`Invalid NPC guard ${field}`);
  }
  return guard;
}

function buildTemporaryLandscapeNpcAllocation({ site, ecosystem, locators = [], objects = [], resolveType, hasResources = false, limits = null }) {
  const npcs: any[] = [], triggers: any[] = [], diagnostics: any[] = [], replacedObjectKeys: string[] = [];
  if (typeof resolveType !== "function") throw new TypeError("Target NPC type resolver is required");
  if (ecosystem.spawnEnabled === false || ecosystem.spawnEnabled === 0) return { npcs, triggers, diagnostics, replacedObjectKeys };
  const add = (object, typeID, suffix, extra: Record<string, any> = {}) => {
    const type = resolveType(typeID);
    if (!isTemporaryLandscapeNpcType(type)) throw new TypeError(`Unverified temporary NPC type ${typeID}`);
    const sourceKey = npcSourceKey(object), key = `npc:${sourceKey}:${suffix}`;
    const spec = { key, typeID, count: 1, positionOffset: vector(object.positionOffset),
      activation: "entry", guard: boundedGuard(object.guardCommand), groupKey: `npc-group:${sourceKey}`,
      sourceKey: [object.patternKind || "entry", object.dungeonID, object.occurrenceIndex || 0].join(":"),
      sourceDungeonID: object.dungeonID, sourceRoomID: object.roomID, sourceObjectID: object.objectID,
      sourcePatternKind: object.patternKind, sourceOccurrenceIndex: object.occurrenceIndex || 0,
      policyProvenance: NPC_ALLOCATION_POLICY.provenance, ...extra };
    if (npcs.some(entry => entry.key === key)) throw new TypeError(`Duplicate NPC allocation ${key}`);
    npcs.push(spec); return spec;
  };
  for (const object of objects) {
    if (isTemporaryLandscapeNpcType(resolveType(object.typeID))) {
      const triggerSpawn = Number(object.guardCommand?.objectTriggerSpawn) > 0;
      add(object, object.typeID, "authored", { activation: triggerSpawn ? "trigger" : "entry", triggerSpawn,
        authoredType: true, policyProvenance: "authored target NPC object" });
      replacedObjectKeys.push(npcSourceKey(object));
    }
    for (const entity of values(object.entities) as any[]) {
      const typeID = NPC_ALLOCATION_POLICY.groupingReplacements[Number(entity.npcGroupingID)];
      if (!typeID) {
        diagnostics.push({ kind: "unresolved-native-npc-group", npcGroupingID: entity.npcGroupingID, sourceKey: npcSourceKey(object) });
        continue;
      }
      add(object, typeID, `entity:${entity.entityID}`, { nativeEntityID: entity.entityID, sourceEntityID: entity.entityID, triggerSpawn: Number(entity.triggerSpawn) > 0, npcGroupingID: entity.npcGroupingID,
        nativeBehaviorName: entity.behaviorName, nativeGroupBehaviorName: entity.groupBehaviorName,
        activation: Number(entity.triggerSpawn) > 0 ? "trigger" : "entry" });
      diagnostics.push({ kind: "temporary-npc-group-replacement", npcGroupingID: entity.npcGroupingID, typeID,
        evidence: NPC_ALLOCATION_POLICY.grouping33025Evidence });
    }
  }
  const caps = limits || require("./temporaryLandscapeResources").getTemporaryLocatorLimits(
    require("./temporaryLandscapeResources").getTemporaryLandscapeTags(site, ecosystem), locators.filter(entry => entry.role === "resourceLocator").length);
  for (const [role, capName, typeID, event] of [
    ["npcLocator", "npc", 94167, "entry"], ["threatLocator", "threat", 83566, "proximity"],
    ["eventLocator", "event", 94167, hasResources ? "mined" : "proximity"],
  ] as any[]) {
    const candidates = locators.filter(entry => entry.role === role).sort((a, b) => {
      const hash = object => crypto.createHash("sha256").update(`${site.itemID || site.siteID}:${npcSourceKey(object)}`).digest("hex");
      return hash(a).localeCompare(hash(b));
    });
    const cap = Math.max(0, Math.min(2, Math.trunc(Number(caps[capName] ?? caps[`${capName}Limit`] ?? 0))));
    for (const object of candidates.slice(0, cap)) {
      const spec = add(object, typeID, role);
      if (event !== "entry") {
        const key = `trigger:${spec.key}`;
        spec.activation = key;
        triggers.push({ key, event, positionOffset: { ...spec.positionOffset }, rangeMeters: 75000,
          delayMs: 0, targets: [spec.key], chance: 1, repeat: false });
      }
    }
  }
  return { npcs, triggers, diagnostics, replacedObjectKeys };
}

function buildTemporaryLandscapeNpcDefinition(spec, resolveType) {
  const type = resolveType(Number(spec.typeID));
  if (!isTemporaryLandscapeNpcType(type)) throw new TypeError("Temporary NPC must use verified target NPC metadata");
  const guard = boundedGuard(spec.guard), profileID = `temporary-landscape-v1-type-${type.typeID}`;
  return {
    profile: { profileID, name: type.name, shipNameTemplate: type.name, shipTypeID: type.typeID,
      presentationTypeID: type.typeID, entityType: "npc", hardwareFamily: "sdeEntityNpc",
      loadoutID: `${profileID}-empty`, behaviorProfileID: `${profileID}-guard`,
      bounty: 0, suppressBounty: true, temporaryLandscapePolicy: true,
      hostileResponseThreshold: 11, friendlyResponseThreshold: 11 },
    loadout: { loadoutID: `${profileID}-empty`, modules: [], charges: [], cargo: [] },
    behaviorProfile: { behaviorProfileID: `${profileID}-guard`, name: "Temporary landscape guard",
      thinkIntervalMs: 500, autoAggro: true, autoAggroTargetClasses: ["player"],
      targetPreference: "preferredTargetThenNearestPlayer", movementMode: "orbit",
      orbitDistanceMeters: numeric(guard.orbitRange, 5000), followRangeMeters: numeric(guard.orbitRange, 5000),
      aggressionRangeMeters: numeric(guard.aggressionRange, 75000),
      leashRangeMeters: Math.max(75000, numeric(guard.aggressionRange, 75000) * 2),
      returnToHomeWhenIdle: true, guardAnchor: true, homeArrivalMeters: 1500,
      autoActivateWeapons: true },
    lootTable: null,
  };
}

function npcIdentity(scene, site, spec, options) {
  const identity = options.identity || {};
  if (!/^[a-f0-9]{64}$/.test(identity.profileRevision || "") || !/^[a-f0-9]{64}$/.test(identity.policyRevision || "") ||
      identity.systemID !== scene.systemID || identity.siteID !== site.itemID || !Number.isSafeInteger(site.itemID) || site.itemID <= 0 ||
      !spec.key || (options.entryKey && options.entryKey !== spec.key)) throw new TypeError("Invalid temporary NPC identity");
  const generation = Number(options.generation || 0);
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError("Invalid NPC generation");
  const slot = String(options.identitySlot || [identity.profileRevision, identity.policyRevision, identity.systemID,
    identity.siteID, spec.key, "generation", generation].join(":"));
  return { slot, metadata: { temporaryLandscapeRevision: identity.profileRevision,
    temporaryLandscapePolicyRevision: identity.policyRevision, landscapeSiteID: identity.siteID,
    landscapePolicyKey: spec.key, landscapePolicyGeneration: String(generation) } };
}

function spawnTemporaryLandscapeNpc(scene, site, spec, options: Record<string, any> = {}) {
  const { slot, metadata } = npcIdentity(scene, site, spec, options);
  const store = options.nativeNpcStore || require("../../space/npc/nativeNpcStore");
  const service = options.nativeNpcService || require("../../space/npc/nativeNpcService");
  const persistence = options.persistence || require("../../space/npc/npcRuntimePersistence");
  persistence.initializeNpcRuntimePersistence?.();
  const matches = store.listNativeEntitiesForSystem(scene.systemID).filter(row => row.npcIdentitySlot === slot);
  if (matches.length > 1) return { success: false, errorMsg: "LANDSCAPE_NPC_IDENTITY_CONFLICT" };
  const record = matches[0];
  if (record) {
    if (record.typeID !== spec.typeID || Object.entries(metadata).some(([key, value]) => String(record[key]) !== String(value))) {
      return { success: false, errorMsg: "LANDSCAPE_NPC_IDENTITY_CONFLICT" };
    }
    const result = service.materializeStoredNativeController(scene, record.entityID, options);
    return result.success ? { success: true, data: { ...result.data, entityID: record.entityID, reused: true } } : result;
  }
  const operations = persistence.listNpcOperations().filter(operation => operation.payload?.npcIdentitySlot === slot);
  if (operations.some(operation => operation.operationType === "destroy" || (operation.operationType === "spawn" && operation.status === "committed"))) {
    return { success: true, data: { entityID: Number(options.entityID) || null, destroyed: true } };
  }
  if (options.entityID) return { success: false, errorMsg: "LANDSCAPE_NPC_RECEIPT_MISSING" };
  const resolveType = options.resolveType || (id => require("./temporaryLandscapeProfile").getTemporaryLandscapeProfile()?.types.get(id));
  const definition = buildTemporaryLandscapeNpcDefinition(spec, resolveType);
  const positionOffset = vector(spec.positionOffset), base = vector(site.position);
  const result = service.spawnNativeNpcEntityInContext({ scene, systemID: scene.systemID, anchorEntity: site,
    anchorKind: "landscape", anchorLabel: site.itemName || "Landscape" }, definition, {
    broadcast: options.broadcast === true, excludedSession: options.excludedSession || null,
    createNpcPilot: false, npcIdentitySlot: slot, runtimeKind: "temporaryLandscape",
    operatorKind: "temporaryLandscape", entityScopeMetadata: metadata,
    spawnSiteID: String(site.itemID), spawnGroupID: spec.groupKey || slot,
    deferInitialBehaviorTick: true,
    spawnStateOverride: { position: { x: base.x + positionOffset.x, y: base.y + positionOffset.y, z: base.z + positionOffset.z },
      velocity: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, mode: "STOP" },
  });
  return result.success ? { success: true, data: { ...result.data,
    entityID: result.data?.entity?.itemID || result.data?.entityRecord?.entityID, reused: false } } : result;
}

function isTemporaryLandscapeRevisionActive(record) {
  if (!record?.temporaryLandscapeRevision) return true;
  const profile = require("./temporaryLandscapeProfile").getTemporaryLandscapeProfile();
  const revision = require("./temporaryLandscapePolicyVersion").TEMPORARY_LANDSCAPE_POLICY_REVISION;
  return Boolean(profile && profile.revision === record.temporaryLandscapeRevision && revision === record.temporaryLandscapePolicyRevision);
}

function dematerializeTemporaryLandscapeNpc(scene, entity, options: Record<string, any> = {}) {
  const service = options.nativeNpcService || require("../../space/npc/nativeNpcService");
  return service.dematerializeNativeController({ entityID: entity.itemID || entity.entityID, systemID: scene.systemID },
    { broadcast: options.broadcast === true, persistState: true });
}

module.exports = { NPC_ALLOCATION_POLICY, npcSourceKey, isTemporaryLandscapeNpcType, buildTemporaryLandscapeNpcAllocation,
  buildTemporaryLandscapeNpcDefinition, spawnTemporaryLandscapeNpc, dematerializeTemporaryLandscapeNpc, isTemporaryLandscapeRevisionActive };
