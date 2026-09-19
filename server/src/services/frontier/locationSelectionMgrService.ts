"use strict";

const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildList,
  buildObjectEx1,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const {
  clearCharacterActiveShipForCloneSelection,
} = require(path.join(__dirname, "../character/characterState"));
const deploymentRuntime = require(path.join(__dirname, "./deploymentRuntime"));
const berthingRuntime = require(path.join(__dirname, "./berthingRuntime"));
const {
  DEFAULT_SHELL_TYPE_ID,
} = require(path.join(__dirname, "./shellEquipmentRuntime"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  resolveShipByTypeID,
} = require(path.join(__dirname, "../chat/shipTypeRegistry"));

const DEATH_REPORT_CLASS =
  "frontier.clone_selection.common.location.DeathReport";
const DEATH_LOCATION_KEY_CLASS =
  "frontier.clone_selection.common.location.DeathLocationKey";
const REFUGE_LOCATION_KEY_CLASS =
  "frontier.clone_selection.common.location.RefugeLocationKey";
const FITTING_CLASS = "frontier.clone_selection.common.location.Fitting";
const LOCATION_CLASS = "frontier.clone_selection.common.location.Location";
const CREATION_SHIP_TYPE_ID = berthingRuntime.CREATION_SHIP_TYPE_ID || 95276;
const REFUGE_TYPE_ID = berthingRuntime.REFUGE_TYPE_ID || 87160;
const REFUGE_SHIP_TYPE_ID = 95735;
const DEFAULT_FALLBACK_STATION_ID = 60003760;
const CLONE_SPAWN_CLEARANCE_METERS = 1_000;
const STATION_CLONE_SPAWN_CLEARANCE_METERS = 5_000;

const ENVIRONMENTAL_STATUS_EFFECT_KEYS = new Set([
  "heat",
  "feralization",
  "temporal_drift",
]);

const lastDeathReportsByCharacterID = new Map();
const pendingCloneDeathsByCharacterID = new Map();

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(value, fallback: Record<string, any> = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(value && value.x, fallback.x),
    y: toFiniteNumber(value && value.y, fallback.y),
    z: toFiniteNumber(value && value.z, fallback.z),
  };
}

function normalizeVector(value, fallback: Record<string, any> = { x: 1, y: 0, z: 0 }) {
  const vector = cloneVector(value, fallback);
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function normalizeDeathStatusEffect(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ENVIRONMENTAL_STATUS_EFFECT_KEYS.has(normalized) ? normalized : null;
}

function buildPythonDatetimePayload(milliseconds) {
  const date = new Date(Number(milliseconds));
  const normalizedDate = date instanceof Date && Number.isFinite(date.getTime())
    ? date
    : new Date();
  // datetime.datetime is in the client's core marshal whitelist. Construct it
  // through ObjectEx instead of nesting a cPicked stream inside DeathReport:
  // the latter reaches the native FromPickle path and aborts the entire RPC
  // response before the death-message controller can render its blue frame.
  return buildObjectEx1("datetime.datetime", [
    normalizedDate.getUTCFullYear(),
    normalizedDate.getUTCMonth() + 1,
    normalizedDate.getUTCDate(),
    normalizedDate.getUTCHours(),
    normalizedDate.getUTCMinutes(),
    normalizedDate.getUTCSeconds(),
    normalizedDate.getUTCMilliseconds() * 1000,
  ]);
}

function recordCloneDeathReport(
  characterID,
  report: Record<string, any> = {},
) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const solarSystemID = toPositiveInt(report.solarSystemID, 0);
  if (numericCharacterID <= 0 || solarSystemID <= 0) {
    return null;
  }

  const normalized = {
    characterID: numericCharacterID,
    deathStatusEffect: normalizeDeathStatusEffect(
      report.deathStatusEffect ?? report.statusEffectKey,
    ),
    deathTimeMs: Number.isFinite(Number(report.deathTimeMs))
      ? Number(report.deathTimeMs)
      : Date.now(),
    finalBlow: toPositiveInt(
      report.finalBlow ?? report.finalCharacterID,
      0,
    ) || null,
    finalShipTypeID: toPositiveInt(
      report.finalShipTypeID ?? report.attackerShipTypeID,
      0,
    ) || null,
    shellTypeID: toPositiveInt(report.shellTypeID, DEFAULT_SHELL_TYPE_ID),
    shipID: toPositiveInt(report.shipID, 0),
    shipTypeID: toPositiveInt(report.shipTypeID, CREATION_SHIP_TYPE_ID),
    solarSystemID,
  };
  lastDeathReportsByCharacterID.set(numericCharacterID, normalized);
  return { ...normalized };
}

function recordEnvironmentalDeathReport(characterID, report: Record<string, any> = {}) {
  const deathStatusEffect = normalizeDeathStatusEffect(
    report.deathStatusEffect ?? report.statusEffectKey,
  );
  if (!deathStatusEffect) {
    return null;
  }
  return recordCloneDeathReport(characterID, {
    ...report,
    deathStatusEffect,
  });
}

function getLastDeathReport(characterID) {
  const report = lastDeathReportsByCharacterID.get(
    toPositiveInt(characterID, 0),
  );
  return report ? { ...report } : null;
}

function buildDeathReportPayload(report) {
  if (!report) {
    return null;
  }
  return buildObjectEx1(DEATH_REPORT_CLASS, [
    report.shipID,
    report.solarSystemID,
    report.shipTypeID,
    report.shellTypeID,
    buildList([]),
    buildList([]),
    buildPythonDatetimePayload(report.deathTimeMs),
    report.finalBlow || null,
    report.finalShipTypeID || null,
    null,
    report.deathStatusEffect,
  ]);
}

function recordPendingCloneDeath(
  characterID,
  pending: Record<string, any> = {},
) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const deathSystemID = toPositiveInt(
    pending.deathSystemID ?? pending.solarSystemID,
    0,
  );
  if (numericCharacterID <= 0 || deathSystemID <= 0) {
    return null;
  }
  const normalized = {
    characterID: numericCharacterID,
    deathSystemID,
    fallbackStationID: toPositiveInt(
      pending.fallbackStationID,
      DEFAULT_FALLBACK_STATION_ID,
    ),
    reason: pending.reason === "hull" ? "hull" : "vitality",
    readyAtMs: Math.max(Date.now(), toFiniteNumber(pending.readyAtMs, Date.now())),
    recordedAtMs: Date.now(),
  };
  pendingCloneDeathsByCharacterID.set(numericCharacterID, normalized);
  return { ...normalized };
}

function getPendingCloneDeath(characterID) {
  const pending = pendingCloneDeathsByCharacterID.get(
    toPositiveInt(characterID, 0),
  );
  return pending ? { ...pending } : null;
}

function buildFittingPayload(
  shipTypeID = CREATION_SHIP_TYPE_ID,
  shellTypeID = DEFAULT_SHELL_TYPE_ID,
) {
  return buildObjectEx1(FITTING_CLASS, [
    toPositiveInt(shipTypeID, CREATION_SHIP_TYPE_ID),
    toPositiveInt(shellTypeID, DEFAULT_SHELL_TYPE_ID),
    buildList([]),
    buildList([]),
  ]);
}

function buildLocationPayload(location) {
  const keyClass = location.kind === "death"
    ? DEATH_LOCATION_KEY_CLASS
    : REFUGE_LOCATION_KEY_CLASS;
  const keyArgs = location.kind === "death"
    ? [location.solarSystemID]
    : [location.solarSystemID, location.locationID];
  return buildObjectEx1(LOCATION_CLASS, [
    buildObjectEx1(keyClass, keyArgs),
    location.solarSystemID,
    buildFittingPayload(location.shipTypeID, location.shellTypeID),
  ]);
}

function resolveFallbackStation(pending, dependencies: Record<string, any> = {}) {
  const getStationByID = dependencies.getStationByID || worldData.getStationByID;
  const stationID = toPositiveInt(
    pending && pending.fallbackStationID,
    DEFAULT_FALLBACK_STATION_ID,
  );
  const station = getStationByID(stationID);
  if (!station) {
    return null;
  }
  const solarSystemID = toPositiveInt(
    station.solarSystemID ?? station.solarSystemId,
    0,
  );
  return solarSystemID > 0
    ? {
        kind: "station",
        locationID: stationID,
        solarSystemID,
        shipTypeID: CREATION_SHIP_TYPE_ID,
        shellTypeID: DEFAULT_SHELL_TYPE_ID,
      }
    : null;
}

function listEligibleCloneAssemblies(
  characterID,
  dependencies: Record<string, any> = {},
) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  const getAllItems = dependencies.getAllItems || itemStore.getAllItems;
  const readConstructionState = dependencies.readConstructionState ||
    deploymentRuntime.readConstructionState;
  const isActivationPending = dependencies.isAssemblyActivationPending ||
    deploymentRuntime.isAssemblyActivationPending;
  const getSmartHangarDefinition = dependencies.getSmartHangarDefinition ||
    berthingRuntime.getSmartHangarDefinition;
  const smartHangarAcceptsShip = dependencies.smartHangarAcceptsShip ||
    berthingRuntime.smartHangarAcceptsShip;
  const creationShip = dependencies.creationShip ||
    resolveShipByTypeID(CREATION_SHIP_TYPE_ID) || {
      typeID: CREATION_SHIP_TYPE_ID,
      groupID: 0,
    };

  return Object.values<any>(getAllItems())
    .map((item) => {
      if (
        !item ||
        toPositiveInt(item.locationID, 0) <= 0 ||
        Number(item.flagID) !== 0 ||
        !item.spaceState
      ) {
        return null;
      }
      const state = readConstructionState(item);
      if (
        !state ||
        Number(state.assemblyStatus) !== deploymentRuntime.ASSEMBLY_STATUS_ONLINE ||
        isActivationPending(item)
      ) {
        return null;
      }
      const typeID = toPositiveInt(item.typeID, 0);
      const definition = getSmartHangarDefinition(typeID);
      const isRefuge = typeID === REFUGE_TYPE_ID;
      if (!definition && !isRefuge) {
        return null;
      }
      if (definition && !definition.allowUserAdd) {
        return null;
      }
      if (
        toPositiveInt(item.ownerID, 0) !== numericCharacterID &&
        !(definition && definition.allowFreeForAll)
      ) {
        return null;
      }
      if (
        definition &&
        typeof smartHangarAcceptsShip === "function" &&
        !smartHangarAcceptsShip(definition, creationShip)
      ) {
        return null;
      }
      const solarSystemID = toPositiveInt(
        item.spaceState.systemID,
        toPositiveInt(state.solarSystemID, toPositiveInt(item.locationID, 0)),
      );
      if (solarSystemID <= 0 || solarSystemID !== toPositiveInt(item.locationID, 0)) {
        return null;
      }
      return {
        kind: "assembly",
        locationID: toPositiveInt(item.itemID, 0),
        solarSystemID,
        // A clone assembled by a Refuge uses the distinct Refuge Ship hull
        // from the SDE. Deployed smart hangars continue to assemble the
        // standard Creation hull. Both types are initialized by itemStore's
        // shared Creation-template grant path before entering space.
        shipTypeID: isRefuge
          ? REFUGE_SHIP_TYPE_ID
          : CREATION_SHIP_TYPE_ID,
        shellTypeID: DEFAULT_SHELL_TYPE_ID,
        item,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.solarSystemID - right.solarSystemID ||
      left.locationID - right.locationID
    ));
}

function resolveSelectableCloneLocations(
  characterID,
  dependencies: Record<string, any> = {},
) {
  const pending = dependencies.pending || getPendingCloneDeath(characterID);
  if (!pending) {
    return [];
  }
  const assemblies = listEligibleCloneAssemblies(characterID, dependencies);
  if (assemblies.length > 0) {
    return assemblies;
  }
  const station = resolveFallbackStation(pending, dependencies);
  return station ? [station] : [];
}

function buildAvailableLocationsPayload(
  characterID,
  dependencies: Record<string, any> = {},
) {
  const pending = dependencies.pending || getPendingCloneDeath(characterID);
  if (!pending) {
    return buildList([]);
  }
  const report = dependencies.report || getLastDeathReport(characterID);
  const locations: any[] = [];
  if (report) {
    locations.push({
      kind: "death",
      locationID: 0,
      solarSystemID: report.solarSystemID,
      shipTypeID: report.shipTypeID,
      shellTypeID: report.shellTypeID,
    });
  }
  locations.push(...resolveSelectableCloneLocations(characterID, {
    ...dependencies,
    pending,
  }));
  return buildList(locations.map(buildLocationPayload));
}

function parseLocationKey(rawValue) {
  const value = unwrapMarshalValue(rawValue);
  const directSolarSystemID = toPositiveInt(value, 0);
  if (directSolarSystemID > 0) {
    return { solarSystemID: directSolarSystemID, locationID: 0 };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const header = Array.isArray(value.header) ? value.header : [];
  const rawClassName = Array.isArray(header[0])
    ? header[0][0]
    : header[0];
  const className = String(
    rawClassName || value.className || value.__class__ || "",
  );
  const keyArgs = Array.isArray(header[1])
    ? header[1]
    : Array.isArray(value.args)
      ? value.args
      : [];
  const state = [
    !Array.isArray(header[1]) ? header[1] : null,
    header[2],
    value.state,
    value,
  ].find((candidate) => (
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
  )) || {};
  if (
    className &&
    !className.endsWith("RefugeLocationKey")
  ) {
    return null;
  }
  const solarSystemID = toPositiveInt(
    keyArgs[0] ?? state.solarsystem_id ?? state.solar_system_id ??
      state.solarSystemID,
    0,
  );
  const locationID = toPositiveInt(
    keyArgs[1] ?? state.assembly_id ?? state.location_id ?? state.locationID,
    0,
  );
  return solarSystemID > 0
    ? { solarSystemID, locationID }
    : null;
}

function parseLocationKeys(rawValue) {
  const value = unwrapMarshalValue(rawValue);
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .map((candidate) => parseLocationKey(candidate))
    .filter(Boolean);
}

function summarizeLocationKeyInput(value) {
  try {
    return JSON.stringify(value, (_key, entry) => (
      Buffer.isBuffer(entry) ? `<Buffer length=${entry.length}>` : entry
    )).slice(0, 1_000);
  } catch (_error) {
    return String(value);
  }
}

function buildAssemblySpawnState(item) {
  const state = item && item.spaceState || {};
  const direction = normalizeVector(state.direction, { x: 1, y: 0, z: 0 });
  const position = cloneVector(state.position);
  const clearance = Math.max(
    CLONE_SPAWN_CLEARANCE_METERS,
    toFiniteNumber(item && item.spaceRadius, 0) + CLONE_SPAWN_CLEARANCE_METERS,
  );
  const spawnPosition = {
    x: position.x + direction.x * clearance,
    y: position.y + direction.y * clearance,
    z: position.z + direction.z * clearance,
  };
  return {
    anchorID: toPositiveInt(item && item.itemID, 0),
    anchorType: "clone-refuge",
    position: spawnPosition,
    direction,
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: spawnPosition,
  };
}

function buildStationSpawnState(station) {
  const direction = normalizeVector(
    cloneVector(station && station.position),
    { x: 1, y: 0, z: 0 },
  );
  const position = cloneVector(station && station.position);
  const stationRadius = Math.max(
    toFiniteNumber(station && station.radius, 15_000),
    0,
  );
  const offset = stationRadius + STATION_CLONE_SPAWN_CLEARANCE_METERS;
  const spawnPosition = {
    x: position.x + direction.x * offset,
    y: position.y + direction.y * offset,
    z: position.z + direction.z * offset,
  };
  return {
    anchorID: toPositiveInt(station && station.stationID, 0),
    anchorType: "station-clone-fallback",
    position: spawnPosition,
    direction,
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: spawnPosition,
  };
}

function clearCharacterActiveShip(characterID) {
  return clearCharacterActiveShipForCloneSelection(characterID);
}

function spawnAtAssembly(session, location) {
  const characterID = toPositiveInt(session && session.characterID, 0);
  const pending = getPendingCloneDeath(characterID);
  const fallbackStationID = toPositiveInt(
    pending && pending.fallbackStationID,
    DEFAULT_FALLBACK_STATION_ID,
  );
  const spawnShipTypeID = toPositiveInt(
    location && location.shipTypeID,
    CREATION_SHIP_TYPE_ID,
  );
  const creationShip = resolveShipByTypeID(spawnShipTypeID) || {
    typeID: spawnShipTypeID,
    name: spawnShipTypeID === REFUGE_SHIP_TYPE_ID
      ? "Refuge Ship"
      : "Creation",
  };
  const createResult = itemStore.createShipItemForCharacter(
    characterID,
    fallbackStationID,
    creationShip,
  );
  if (!createResult.success || !createResult.data) {
    return createResult;
  }
  const shipItem = createResult.data;
  const activateResult = itemStore.setActiveShipForCharacter(
    characterID,
    shipItem.itemID,
  );
  if (!activateResult.success) {
    itemStore.removeInventoryItem(shipItem.itemID, { removeContents: true });
    return activateResult;
  }

  const transitions = require(path.join(__dirname, "../../space/transitions"));
  const jumpResult = transitions.jumpSessionToSolarSystem(
    session,
    location.solarSystemID,
    {
      countsTowardJumpGoal: false,
      spawnStateOverride: buildAssemblySpawnState(location.item),
    },
  );
  if (!jumpResult.success) {
    itemStore.removeInventoryItem(shipItem.itemID, { removeContents: true });
    clearCharacterActiveShip(characterID);
    return jumpResult;
  }
  return {
    success: true,
    data: {
      ...jumpResult.data,
      cloneLocation: location,
      createdShip: shipItem,
    },
  };
}

function spawnAtStation(session, location) {
  const characterID = toPositiveInt(session && session.characterID, 0);
  const station = worldData.getStationByID(location.locationID);
  if (!station) {
    return { success: false, errorMsg: "STATION_NOT_FOUND" };
  }
  const shipTypeID = toPositiveInt(
    location && location.shipTypeID,
    CREATION_SHIP_TYPE_ID,
  );
  const creationShip = resolveShipByTypeID(shipTypeID) || {
    typeID: shipTypeID,
    name: "Creation",
  };
  const createResult = itemStore.createShipItemForCharacter(
    characterID,
    station.stationID,
    creationShip,
  );
  if (!createResult.success || !createResult.data) {
    return createResult;
  }
  const shipItem = createResult.data;
  const activateResult = itemStore.setActiveShipForCharacter(
    characterID,
    shipItem.itemID,
  );
  if (!activateResult.success) {
    itemStore.removeInventoryItem(shipItem.itemID, { removeContents: true });
    return activateResult;
  }

  // CloneSelectionView only implements an AwakeTransition to Space. Docking
  // here makes the client attempt clone_selection -> hangar, for which no
  // transition exists. Use the station as a safe space anchor instead.
  const transitions = require(path.join(__dirname, "../../space/transitions"));
  const jumpResult = transitions.jumpSessionToSolarSystem(
    session,
    location.solarSystemID,
    {
      countsTowardJumpGoal: false,
      spawnStateOverride: buildStationSpawnState(station),
    },
  );
  if (!jumpResult.success) {
    itemStore.removeInventoryItem(shipItem.itemID, { removeContents: true });
    clearCharacterActiveShip(characterID);
    return jumpResult;
  }
  return {
    success: true,
    data: {
      ...jumpResult.data,
      cloneLocation: location,
      createdShip: shipItem,
    },
  };
}

function confirmCloneDeathTransition(session) {
  const shipDestruction = require(path.join(__dirname, "../../space/shipDestruction"));
  const confirmation = typeof shipDestruction.confirmCloneSelectionTransition === "function"
    ? shipDestruction.confirmCloneSelectionTransition(session)
    : { success: true };
  return confirmation || {
    success: false,
    errorMsg: "CLONE_DEATH_CONFIRMATION_FAILED",
  };
}

function spawnCharacterAtLocation(session, rawLocationKey) {
  const characterID = toPositiveInt(session && session.characterID, 0);
  const pending = getPendingCloneDeath(characterID);
  if (!pending || Date.now() < pending.readyAtMs) {
    return { success: false, errorMsg: "CLONE_SELECTION_NOT_READY" };
  }
  const requestedLocations = parseLocationKeys(rawLocationKey);
  if (requestedLocations.length === 0) {
    log.warn(
      `[LocationSelection] Invalid clone location key char=${characterID} ` +
        `payload=${summarizeLocationKeyInput(rawLocationKey)}`,
    );
    return { success: false, errorMsg: "INVALID_CLONE_LOCATION" };
  }
  const availableLocations = resolveSelectableCloneLocations(characterID);
  const location = requestedLocations
    .map((requested) => availableLocations.find((candidate) => (
      candidate.solarSystemID === requested.solarSystemID &&
      (
        requested.locationID <= 0 ||
        candidate.locationID === requested.locationID
      )
    )) || (() => {
      // A station card is only shown when no refuge or deployed hangar is
      // available. Keep an already-presented fallback valid if an assembly
      // comes online while the clone-selection UI is open.
      const station = resolveFallbackStation(pending);
      return station &&
        station.solarSystemID === requested.solarSystemID &&
        (
          requested.locationID <= 0 ||
          station.locationID === requested.locationID
        )
        ? station
        : null;
    })())
    .find(Boolean);
  if (!location) {
    log.warn(
      `[LocationSelection] Clone location unavailable char=${characterID} ` +
        `requested=${JSON.stringify(requestedLocations)} ` +
        `available=${JSON.stringify(availableLocations.map((candidate) => ({
          kind: candidate.kind,
          solarSystemID: candidate.solarSystemID,
          locationID: candidate.locationID,
        })))}`,
    );
    return { success: false, errorMsg: "CLONE_LOCATION_UNAVAILABLE" };
  }

  // Selecting a concrete respawn destination is the first unambiguous
  // server-observable player action. Loading clone locations is not sufficient:
  // the client also does that when DeathMessageIntegration throws before the
  // blue report installs its hold-to-confirm handler.
  const confirmation = confirmCloneDeathTransition(session);
  if (confirmation.success !== true) {
    return confirmation;
  }

  const result = location.kind === "station"
    ? spawnAtStation(session, location)
    : spawnAtAssembly(session, location);
  if (!result || result.success !== true) {
    return result || { success: false, errorMsg: "CLONE_SPAWN_FAILED" };
  }
  pendingCloneDeathsByCharacterID.delete(characterID);
  log.info(
    `[LocationSelection] Respawned char=${characterID} kind=${location.kind} ` +
      `location=${location.locationID} system=${location.solarSystemID}`,
  );
  return result;
}

function resetDeathReports(characterID = null) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID > 0) {
    pendingCloneDeathsByCharacterID.delete(numericCharacterID);
    return lastDeathReportsByCharacterID.delete(numericCharacterID);
  }
  lastDeathReportsByCharacterID.clear();
  pendingCloneDeathsByCharacterID.clear();
  return true;
}

class LocationSelectionMgrService extends BaseService {
  constructor() {
    super("locationSelectionMgr");
  }

  Handle_get_locations(_args, session) {
    const characterID = toPositiveInt(
      session && (session.characterID || session.charid),
      0,
    );
    const pending = getPendingCloneDeath(characterID);
    if (pending && Date.now() < pending.readyAtMs) {
      throw new Error("CLONE_SELECTION_NOT_READY");
    }

    // This RPC is also reached when the client fails to construct its blue
    // death-report panel. It must remain read-only so a UI/marshal failure does
    // not destroy the preserved ship or otherwise finalize clone death.
    return buildAvailableLocationsPayload(
      characterID,
    );
  }

  Handle_spawn_character_in_ship_at_solarsystem(args, session) {
    const result = spawnCharacterAtLocation(
      session,
      Array.isArray(args) ? args[0] : null,
    );
    if (!result || result.success !== true) {
      throw new Error(result && result.errorMsg || "CLONE_SPAWN_FAILED");
    }
    return null;
  }

  Handle_get_last_death_report(_args, session) {
    return buildDeathReportPayload(
      getLastDeathReport(
        session && (session.characterID || session.charid),
      ),
    );
  }
}

module.exports = LocationSelectionMgrService;
module.exports.CREATION_SHIP_TYPE_ID = CREATION_SHIP_TYPE_ID;
module.exports.REFUGE_SHIP_TYPE_ID = REFUGE_SHIP_TYPE_ID;
module.exports.DEATH_REPORT_CLASS = DEATH_REPORT_CLASS;
module.exports.buildAvailableLocationsPayload = buildAvailableLocationsPayload;
module.exports.buildDeathReportPayload = buildDeathReportPayload;
module.exports.buildLocationPayload = buildLocationPayload;
module.exports.buildStationSpawnState = buildStationSpawnState;
module.exports.clearCharacterActiveShip = clearCharacterActiveShip;
module.exports.getLastDeathReport = getLastDeathReport;
module.exports.getPendingCloneDeath = getPendingCloneDeath;
module.exports.listEligibleCloneAssemblies = listEligibleCloneAssemblies;
module.exports.parseLocationKey = parseLocationKey;
module.exports.parseLocationKeys = parseLocationKeys;
module.exports.recordCloneDeathReport = recordCloneDeathReport;
module.exports.recordEnvironmentalDeathReport = recordEnvironmentalDeathReport;
module.exports.recordPendingCloneDeath = recordPendingCloneDeath;
module.exports.resetDeathReports = resetDeathReports;
module.exports.resolveSelectableCloneLocations = resolveSelectableCloneLocations;
module.exports.spawnAtStation = spawnAtStation;
module.exports.spawnCharacterAtLocation = spawnCharacterAtLocation;
