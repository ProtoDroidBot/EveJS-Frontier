"use strict";

const { TEMPORARY_LANDSCAPE_POLICY_REVISION } = require("./temporaryLandscapePolicyVersion");

const objectKey = object => ["landscape", object.patternKind, object.dungeonID,
  object.occurrenceIndex, object.roomID, object.objectID].join(":");
const sourceKey = source => [source.patternKind, source.dungeonID, source.occurrenceIndex].join(":");
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

// Exact names/IDs from evedungeons/common/const.pyc in build 3640684. The
// compiler never treats unknown trigger/event IDs as an unconditional spawn.
const TRIGGER_EVENTS = Object.freeze({
  1: "attacked", 2: "proximity", 3: "entity-destroyed", 7: "mined", 8: "entry",
  9: "group-cleared", 10: "mined", 17: "entry", 31: "group-cleared", 48: "resource-depleted",
});

function compileNativeLandscapeTriggers(sources, objects, allocations) {
  const triggers = [], diagnostics = [];
  for (const source of sources) {
    const local = objects.filter(object => object.patternKind === source.patternKind &&
      object.dungeonID === source.dungeonID && object.occurrenceIndex === source.occurrenceIndex);
    const objectKeys = id => allocations.filter(entry => entry.sourceObjectID === id &&
      (entry.sourceKey === sourceKey(source) || entry.key.startsWith(`${sourceKey(source)}:`) ||
       entry.key.startsWith(`landscape:${sourceKey(source)}:`))).map(entry => entry.key);
    for (const raw of source.dungeon?.triggers || []) {
      const events = raw.triggerEvents || [];
      // Empty authored triggers carry no action. Retain a diagnostic without
      // fabricating completion rewards, NPC waves or missing event parameters.
      if (!events.length) { diagnostics.push({ code: "NATIVE_TRIGGER_HAS_NO_ACTIONS", dungeonID: source.dungeonID, triggerID: raw.triggerID }); continue; }
      const event = TRIGGER_EVENTS[raw.triggerTypeID];
      if (!event) { diagnostics.push({ code: "UNSUPPORTED_NATIVE_TRIGGER", dungeonID: source.dungeonID, triggerID: raw.triggerID, triggerTypeID: raw.triggerTypeID }); continue; }
      const object = local.find(object => object.objectID === raw.objectID);
      const sourcesForTrigger = raw.triggerTypeID === 9 ? allocations.filter(entry =>
        entry.sourceKey === sourceKey(source) && entry.miningYieldTypeID).map(entry => entry.key)
        : raw.objectID ? objectKeys(raw.objectID) : allocations.filter(entry =>
          entry.sourceKey === sourceKey(source)).map(entry => entry.key);
      for (const action of events) {
        if (![2, 3].includes(action.eventTypeID)) {
          diagnostics.push({ code: "UNSUPPORTED_NATIVE_ACTION", dungeonID: source.dungeonID, triggerID: raw.triggerID, eventTypeID: action.eventTypeID }); continue;
        }
        const targets = allocations.filter(entry => action.eventTypeID === 2
          ? entry.sourceEntityID === action.entityID && entry.sourceKey === sourceKey(source)
          : entry.sourceObjectID === action.objectID && entry.sourceKey === sourceKey(source)).map(entry => entry.key);
        if (!targets.length) { diagnostics.push({ code: "UNRESOLVED_NATIVE_SPAWN_TARGET", dungeonID: source.dungeonID, triggerID: raw.triggerID, eventID: action.eventID }); continue; }
        if (!["entry", "proximity"].includes(event) && !sourcesForTrigger.length) {
          diagnostics.push({ code: "UNRESOLVED_NATIVE_TRIGGER_SOURCE", dungeonID: source.dungeonID, triggerID: raw.triggerID }); continue;
        }
        const key = `native:${sourceKey(source)}:${raw.triggerID}:${action.eventID}`;
        const chance = Math.max(0, Math.min(1, finite(raw.usageChance, 100) / 100)) *
          Math.max(0, Math.min(1, finite(action.usageChance, 100) / 100));
        triggers.push({ key, event, targets, sourceKeys: sourcesForTrigger,
          positionOffset: object?.positionOffset || source.transform?.positionOffset || { x: 0, y: 0, z: 0 },
          rangeMeters: Math.max(1, finite(raw.radius, finite(object?.radius, 250_000))),
          delayMs: Math.max(0, finite(raw.eventDelay) + finite(action.eventDelay)) * 1000,
          chance, repeat: false, nativeTriggerID: raw.triggerID, nativeEventID: action.eventID });
        for (const target of allocations.filter(entry => targets.includes(entry.key))) {
          // Explicit initially-visible bindings stay visible. Only authored
          // triggerSpawn flags defer a native entity until its event fires.
          if (target.triggerSpawn === true) target.activation = "trigger";
        }
      }
    }
  }
  return { triggers, diagnostics };
}

function buildTemporaryLandscapePolicy({ site, ecosystem, sources, objects, locators, resolveType, resourceProps = [] }) {
  const resourcePlan = require("./temporaryLandscapeResources").buildTemporaryLandscapeResourceAllocation({
    site, ecosystem, locators, resolveType,
  });
  const npcPlan = require("./temporaryLandscapeNpcs").buildTemporaryLandscapeNpcAllocation({
    site, ecosystem, locators, objects, resolveType, hasResources: resourcePlan.resources.length > 0 || resourceProps.length > 0,
  });
  const resources = [...resourcePlan.resources.map(entry => ({ ...entry, activation: entry.activation || "entry",
    sourceKey: [entry.patternKind, entry.sourceDungeonID, entry.occurrenceIndex].join(":") })),
    ...resourceProps.map(entry => ({ ...entry, sourceObjectID: entry.dunObjectID, activation: "entry",
      miningYieldKind: "salvage", preserveMiningVisualPresentation: true,
      temporaryLandscapeResource: true, temporaryLandscapeRevision: site.temporaryLandscapeRevision }))];
  const npcs = npcPlan.npcs.map(entry => ({ ...entry }));
  const all = [...resources, ...npcs];
  const native = compileNativeLandscapeTriggers(sources, objects, all);
  const triggers = [...(npcPlan.triggers || []), ...native.triggers].map(trigger => ({
    ...trigger,
    ...(trigger.event === "mined" && !trigger.sourceKeys?.length
      ? { sourceKeys: resources.map(resource => resource.key) } : {}),
  }));
  const keys = new Set();
  for (const entry of all) {
    if (!entry.key || keys.has(entry.key)) throw new Error("TEMPORARY_LANDSCAPE_DUPLICATE_ALLOCATION");
    keys.add(entry.key);
    if (!Number.isSafeInteger(entry.typeID) || entry.typeID <= 0 ||
        ![entry.positionOffset?.x, entry.positionOffset?.y, entry.positionOffset?.z].every(Number.isFinite)) {
      throw new Error("TEMPORARY_LANDSCAPE_INVALID_ALLOCATION");
    }
  }
  for (const trigger of triggers) {
    if (!trigger.targets?.length || trigger.targets.some(key => !keys.has(key))) throw new Error("TEMPORARY_LANDSCAPE_DANGLING_TRIGGER");
  }
  return { revision: TEMPORARY_LANDSCAPE_POLICY_REVISION, resources, npcs, triggers,
    moduleBlocking: ecosystem.entryPattern?.blocksModules === true || ecosystem.entryPattern?.blocksModules === 1,
    moduleBlockingRangeMeters: 250_000,
    diagnostics: [resourcePlan.diagnostics, ...(npcPlan.diagnostics || []), ...native.diagnostics].filter(Boolean) };
}

module.exports = { TRIGGER_EVENTS, objectKey, sourceKey, compileNativeLandscapeTriggers, buildTemporaryLandscapePolicy };
