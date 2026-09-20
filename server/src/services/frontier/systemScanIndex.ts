"use strict";

/**
 * Cold, read-only per-system scan contribution index.
 *
 * The cache is intentionally an aggregate sensor index, not a second world
 * authority.  It can be invalidated by domain writers and safely rebuilt from
 * durable dungeon, mining, inventory, structure, NPC, and bloom authorities.
 * Rebuilding never creates a scene.
 */

const crypto = require("crypto");
const path = require("path");

const cacheBySystem = new Map<number, any>();
const dirtySystems = new Set<number>();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.trunc(toFinite(value, fallback));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function positionFrom(...values) {
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const position = {
      x: toFinite(value.x, NaN),
      y: toFinite(value.y, NaN),
      z: toFinite(value.z, NaN),
    };
    if (Object.values(position).every(Number.isFinite)) return position;
  }
  return { x: 0, y: 0, z: 0 };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function revisionFor(value) {
  const digest = crypto.createHash("sha256").update(stableJson(value)).digest();
  return digest.readUInt32BE(0);
}

function normalizeTypeIDs(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => positiveInt(value, 0)).filter(Boolean))].sort((a, b) => a - b);
}

function countBand(value) {
  const count = Math.max(0, Math.trunc(toFinite(value, 0)));
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 4) return "2-4";
  if (count <= 9) return "5-9";
  if (count <= 24) return "10-24";
  return "25+";
}

function quantityBand(value) {
  const quantity = Math.max(0, toFinite(value, 0));
  if (quantity === 0) return "depleted";
  if (quantity < 1_000) return "trace";
  if (quantity < 10_000) return "low";
  if (quantity < 100_000) return "medium";
  if (quantity < 1_000_000) return "high";
  return "very_high";
}

function createSystemScanIndex(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const config = options.config || require(path.join(__dirname, "../../config"));
  const worldData = options.worldData || require(path.join(__dirname, "../../space/worldData"));
  const dungeonRuntime = options.dungeonRuntime || require(path.join(__dirname, "../dungeon/dungeonRuntime"));
  const dungeonAuthority = options.dungeonAuthority || require(path.join(__dirname, "../dungeon/dungeonAuthority"));
  const dungeonVisibility = options.dungeonVisibility || require(path.join(__dirname, "../dungeon/dungeonVisibilityPolicy"));
  const miningSites = options.miningSites || require(path.join(__dirname, "../mining/miningResourceSiteService"));
  const itemStore = options.itemStore || require(path.join(__dirname, "../inventory/itemStore"));
  const structureState = options.structureState || require(path.join(__dirname, "../structure/structureState"));
  const npcStore = options.npcStore || require(path.join(__dirname, "../../space/npc/nativeNpcStore"));
  const scanningRuntime = options.scanningRuntime || require(path.join(__dirname, "./scanningRuntime"));
  const signatureEvents = options.signatureEvents || require(path.join(__dirname, "./systemSignatureEventRuntime"));
  const deploymentRuntime = options.deploymentRuntime || require(path.join(__dirname, "./deploymentRuntime"));
  const scanInhibitorRuntime = options.scanInhibitorRuntime || require(path.join(
    __dirname, "../ship/mobileScanInhibitorRuntime",
  ));

  function signatureProfile(source, defaults: Record<string, any> = {}) {
    const metadata = source && source.typeID && itemStore.getItemMetadata
      ? itemStore.getItemMetadata(source.typeID) : null;
    const target = { ...(metadata || {}), ...(source || {}) };
    let baseSignature = Math.max(0.001, toFinite(defaults.baseSignature, 1));
    try {
      baseSignature = Math.max(0.001, toFinite(scanningRuntime.resolveBaseSignature(target), baseSignature));
    } catch (_) {}
    let gravimetric = Math.max(0.05, toFinite(defaults.gravimetric, 1));
    try {
      gravimetric = Math.max(0.05, toFinite(
        scanningRuntime.resolveGravimetricSignatureMultiplier(target), gravimetric,
      ));
    } catch (_) {}
    return {
      baseSignature,
      channelMultiplier: {
        gravimetric,
        electromagnetic: Math.max(0.05, toFinite(defaults.electromagnetic, 1)),
        thermal: Math.max(0.05, toFinite(defaults.thermal, 1)),
      },
    };
  }

  function resourceMetadata(instance, template) {
    const spawn = instance && instance.spawnState && typeof instance.spawnState === "object"
      ? instance.spawnState : {};
    const composition = template && template.resourceComposition &&
      typeof template.resourceComposition === "object" ? template.resourceComposition : {};
    const potentialTypeIDs = normalizeTypeIDs([
      ...(composition.resourceTypeIDs || []),
      ...(composition.oreTypeIDs || []),
      ...(composition.gasTypeIDs || []),
      ...(composition.iceTypeIDs || []),
    ]);
    const remainingTypeIDs = normalizeTypeIDs([
      ...(spawn.resourceTypeIDs || []),
      ...(Array.isArray(spawn.members)
        ? spawn.members.map((member) => member && (member.yieldTypeID || member.resourceTypeID))
        : []),
    ]);
    const originalQuantity = Math.max(0, toFinite(spawn.totalOriginalQuantity,
      Array.isArray(spawn.members) ? spawn.members.reduce((sum, member) =>
        sum + Math.max(0, toFinite(member && member.originalQuantity, 0)), 0) : 0));
    const remainingQuantity = Math.max(0, toFinite(spawn.totalRemainingQuantity,
      Array.isArray(spawn.members) ? spawn.members.reduce((sum, member) =>
        sum + Math.max(0, toFinite(member && member.remainingQuantity, 0)), 0) : 0));
    const memberCount = Math.max(0, positiveInt(spawn.memberCount, 0) ||
      (Array.isArray(spawn.members) ? spawn.members.length : 0));
    const activeMemberCount = Math.max(0, positiveInt(spawn.activeMemberCount, 0) ||
      (Array.isArray(spawn.members) ? spawn.members.filter((member) =>
        toFinite(member && member.remainingQuantity, 0) > 0).length : 0));
    return {
      potentialTypeIDs,
      remainingTypeIDs,
      originalQuantityBand: quantityBand(originalQuantity),
      remainingQuantityBand: quantityBand(remainingQuantity),
      originalMemberCountBand: countBand(memberCount),
      activeMemberCountBand: countBand(activeMemberCount),
      depleted: originalQuantity > 0 && remainingQuantity <= 0,
    };
  }

  function buildDungeonLayer(systemID) {
    const contributions: any[] = [];
    const instances = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true }) || [];
    for (const instance of instances) {
      if (!instance || typeof instance !== "object") continue;
      const template = dungeonAuthority.getTemplateByID(instance.templateID) || null;
      const position = positionFrom(instance.position, instance.spawnState && instance.spawnState.position);
      const family = String(instance.siteFamily || template && template.siteFamily || "unknown")
        .trim().toLowerCase() || "unknown";
      const siteKind = String(instance.siteKind || template && template.siteKind || "signature")
        .trim().toLowerCase() || "signature";
      const profile = signatureProfile(instance, { baseSignature: 12, gravimetric: 1.4, thermal: 0.7 });
      const key = `dungeon:${String(instance.instanceID || instance.siteKey || instance.templateID)}`;
      contributions.push({
        contributorKey: key,
        sourceDomain: "dungeon",
        systemID,
        position,
        kind: "dungeon",
        ...profile,
        observedAtMs: now(),
        visibilityInstance: clone(instance),
        siteMetadata: {
          family,
          siteKind,
          difficulty: template && (template.difficulty || template.difficultyClass) || null,
          displayType: String(template && (template.name || template.dungeonName) || family).slice(0, 96),
        },
      });
      const resource = resourceMetadata(instance, template);
      if (resource.potentialTypeIDs.length > 0 || resource.remainingTypeIDs.length > 0 ||
          ["ore", "gas", "ice", "mining"].includes(family)) {
        const generatedSiteID = positiveInt(instance.spawnState && instance.spawnState.siteID, 0);
        contributions.push({
          contributorKey: generatedSiteID
            ? `resource:generated:${generatedSiteID}`
            : `resource:${key}`,
          sourceDomain: "mining",
          systemID,
          position,
          kind: "resource_field",
          ...signatureProfile(instance, { baseSignature: 20, gravimetric: 2, thermal: 0.35 }),
          observedAtMs: now(),
          visibilityInstance: clone(instance),
          resourceSummary: { family, ...resource },
        });
      }
    }
    return contributions;
  }

  function buildGeneratedResourceLayer(systemID, occupiedKeys) {
    const definitions = typeof miningSites.buildGeneratedResourceSiteDefinitionsForSystem === "function"
      ? miningSites.buildGeneratedResourceSiteDefinitionsForSystem(systemID) || [] : [];
    const contributions: any[] = [];
    for (const definition of definitions) {
      const key = `resource:generated:${definition.siteID || definition.rawSiteIndex}`;
      if (occupiedKeys.has(key)) continue;
      const members = Array.isArray(definition.members) ? definition.members : [];
      const original = Math.max(0, toFinite(definition.totalOriginalQuantity,
        members.reduce((sum, member) => sum + Math.max(0, toFinite(member.originalQuantity, 0)), 0)));
      const remaining = Math.max(0, toFinite(definition.totalRemainingQuantity,
        members.reduce((sum, member) => sum + Math.max(0, toFinite(member.remainingQuantity, 0)), 0)));
      contributions.push({
        contributorKey: key,
        sourceDomain: "mining",
        systemID,
        position: positionFrom(definition.position),
        kind: "resource_field",
        ...signatureProfile(definition, { baseSignature: 20, gravimetric: 2, thermal: 0.3 }),
        observedAtMs: now(),
        resourceSummary: {
          family: String(definition.family || "resource").toLowerCase(),
          potentialTypeIDs: normalizeTypeIDs(definition.resourceTypeIDs),
          remainingTypeIDs: normalizeTypeIDs(definition.resourceTypeIDs),
          originalQuantityBand: quantityBand(original),
          remainingQuantityBand: quantityBand(remaining),
          originalMemberCountBand: countBand(definition.memberCount || members.length),
          activeMemberCountBand: countBand(definition.activeMemberCount ||
            members.filter((member) => toFinite(member.remainingQuantity, 0) > 0).length),
          depleted: original > 0 && remaining <= 0,
        },
      });
    }
    return contributions;
  }

  function isCloaked(source) {
    return source && (source.cloaked === true || source.isCloaked === true ||
      String(source.cloakState || "").toLowerCase() === "cloaked");
  }

  function itemKind(item) {
    const metadata = itemStore.getItemMetadata ? itemStore.getItemMetadata(item.typeID) : null;
    const categoryID = positiveInt(item.categoryID ?? (metadata && metadata.categoryID), 0);
    if (categoryID === Number(itemStore.SHIP_CATEGORY_ID || 6)) return "ship";
    try {
      const state = deploymentRuntime.readConstructionState(item);
      if (state && [1, 2, 5].includes(Number(state.assemblyStatus))) return "base";
    } catch (_) {}
    return null;
  }

  function buildItemLayer(systemID) {
    const contributions = new Map<string, any>();
    for (const item of itemStore.listSystemSpaceItems(systemID) || []) {
      const kind = itemKind(item);
      if (!kind || isCloaked(item)) continue;
      const key = `${kind}:${String(item.itemID)}`;
      contributions.set(key, {
        contributorKey: key,
        sourceDomain: "inventory",
        systemID,
        position: positionFrom(item.spaceState && item.spaceState.position, item.position),
        kind,
        ...signatureProfile(item, kind === "base"
          ? { baseSignature: 35, gravimetric: 4, electromagnetic: 1.5, thermal: 1.2 }
          : { baseSignature: 8, gravimetric: 1, electromagnetic: 1, thermal: 1 }),
        observedAtMs: now(),
      });
    }
    return contributions;
  }

  function buildStructureLayer(systemID, contributions) {
    for (const structure of structureState.listStructuresForSystem(systemID, { refresh: false }) || []) {
      if (!structure || structure.destroyedAt || isCloaked(structure)) continue;
      const key = `base:structure:${String(structure.structureID || structure.itemID)}`;
      contributions.set(key, {
        contributorKey: key,
        sourceDomain: "structure",
        systemID,
        position: positionFrom(structure.position, structure.spaceState && structure.spaceState.position),
        kind: "base",
        ...signatureProfile(structure, { baseSignature: 45, gravimetric: 5, electromagnetic: 1.8, thermal: 1.3 }),
        observedAtMs: now(),
      });
    }
  }

  function buildNpcLayer(systemID, contributions) {
    for (const entity of npcStore.listNativeEntitiesForSystem(systemID) || []) {
      if (!entity || isCloaked(entity)) continue;
      const key = `ship:${String(entity.entityID || entity.itemID)}`;
      contributions.set(key, {
        contributorKey: key,
        sourceDomain: "npc",
        systemID,
        position: positionFrom(entity.position, entity.runtimeState && entity.runtimeState.position,
          entity.spaceState && entity.spaceState.position),
        kind: "ship",
        ...signatureProfile(entity, { baseSignature: 8, gravimetric: 1, electromagnetic: 0.9, thermal: 0.8 }),
        observedAtMs: Math.max(0, toFinite(entity.updatedAtMs, now())),
        stale: entity.materialized === false || entity.virtualized === true,
      });
    }
  }

  function buildBloomLayer(systemID) {
    return (signatureEvents.listActiveSystemSignatureBlooms(systemID, now()) || []).map((event) => ({
      contributorKey: `bloom:${event.observationID}`,
      sourceDomain: "transient",
      systemID,
      position: positionFrom(event.approximatePosition),
      kind: "transient_travel",
      baseSignature: 1,
      channelIntensity: clone(event.channelIntensity),
      observedAtMs: event.observedAtMs,
      bloomMetadata: {
        observationID: event.observationID,
        phase: event.phase,
        travelMode: event.travelMode,
      },
    }));
  }

  function buildLiveLayer(systemID, scene, contributions) {
    if (!scene) return;
    const candidates = [
      ...(Array.isArray(scene.staticEntities) ? scene.staticEntities : []),
      ...(scene.entities instanceof Map ? [...scene.entities.values()] : []),
    ];
    for (const entity of candidates) {
      if (!entity || !entity.position || isCloaked(entity)) continue;
      const kind = itemKind(entity);
      if (!kind) continue;
      const key = `${kind}:${String(entity.itemID || entity.entityID)}`;
      contributions.set(key, {
        contributorKey: key,
        sourceDomain: "live",
        systemID,
        position: positionFrom(entity.position),
        kind,
        ...signatureProfile(entity, kind === "base"
          ? { baseSignature: 35, gravimetric: 4, electromagnetic: 1.5, thermal: 1.2 }
          : { baseSignature: 8, gravimetric: 1, electromagnetic: 1, thermal: 1 }),
        observedAtMs: now(),
      });
    }
  }

  function rebuild(systemID, rebuildOptions: Record<string, any> = {}) {
    const dungeon = buildDungeonLayer(systemID);
    const resourceKeys = new Set(dungeon.filter((row) => row.kind === "resource_field")
      .map((row) => row.contributorKey));
    const generatedResources = buildGeneratedResourceLayer(systemID, resourceKeys);
    const entities = buildItemLayer(systemID);
    buildStructureLayer(systemID, entities);
    buildNpcLayer(systemID, entities);
    buildLiveLayer(systemID, rebuildOptions.liveScene, entities);
    const blooms = buildBloomLayer(systemID);
    const contributions = [...dungeon, ...generatedResources, ...entities.values(), ...blooms]
      .sort((left, right) => left.contributorKey.localeCompare(right.contributorKey));
    for (const contribution of contributions) {
      try {
        contribution.scanAttenuation = scanInhibitorRuntime.isPositionScanInhibited(
          systemID, contribution.position,
        ) ? 0.1 : 1;
      } catch (_) {
        contribution.scanAttenuation = 1;
      }
    }
    const byDomain: Record<string, any[]> = {};
    for (const contribution of contributions) {
      (byDomain[contribution.sourceDomain] ||= []).push(contribution);
    }
    const revisions = Object.fromEntries(Object.entries(byDomain)
      .map(([domain, rows]) => [domain, revisionFor(rows.map((row) => {
        const revisionRow = clone(row);
        delete revisionRow.observedAtMs;
        return revisionRow;
      }))]));
    for (const domain of ["dungeon", "mining", "inventory", "structure", "npc", "live", "transient"]) {
      if (!Object.hasOwn(revisions, domain)) revisions[domain] = 0;
    }
    const snapshot = {
      systemID,
      builtAtMs: now(),
      contributions,
      revisions,
      revision: revisionFor(revisions),
    };
    cacheBySystem.set(systemID, snapshot);
    dirtySystems.delete(systemID);
    return snapshot;
  }

  function filterVisibility(snapshot, actorSession) {
    const contributions = snapshot.contributions.filter((contribution) => {
      const instance = contribution.visibilityInstance;
      if (!instance || !dungeonVisibility.isPrivateDungeonInstance(instance)) return true;
      return dungeonVisibility.canSessionAccessDungeonInstance(actorSession, instance);
    }).map((contribution) => {
      const copy = clone(contribution);
      delete copy.visibilityInstance;
      return copy;
    });
    return { ...clone(snapshot), contributions };
  }

  function getSystemScanSnapshot(systemID, queryOptions: Record<string, any> = {}) {
    const numericSystemID = positiveInt(systemID, 0);
    if (!numericSystemID || !worldData.getSolarSystemByID(numericSystemID)) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_SYSTEM_NOT_FOUND" };
    }
    const ttlMs = Math.max(0, toFinite(config.frontierRemoteScanIndexTtlMs, 15_000));
    let snapshot = cacheBySystem.get(numericSystemID) || null;
    if (queryOptions.forceRebuild === true || dirtySystems.has(numericSystemID) ||
        !snapshot || snapshot.builtAtMs + ttlMs <= now() || queryOptions.liveScene) {
      snapshot = rebuild(numericSystemID, queryOptions);
    }
    return { success: true as const, data: filterVisibility(snapshot, queryOptions.actorSession) };
  }

  return {
    getSystemScanSnapshot,
    markSystemDirty(systemID) {
      const numericSystemID = positiveInt(systemID, 0);
      if (numericSystemID) dirtySystems.add(numericSystemID);
      return Boolean(numericSystemID);
    },
    clearCache(systemID) {
      if (systemID === undefined) {
        cacheBySystem.clear();
        dirtySystems.clear();
      } else {
        const numericSystemID = positiveInt(systemID, 0);
        cacheBySystem.delete(numericSystemID);
        dirtySystems.delete(numericSystemID);
      }
    },
    _testing: { rebuild, countBand, quantityBand, revisionFor },
  };
}

const singleton = createSystemScanIndex();

module.exports = {
  createSystemScanIndex,
  ...singleton,
};
