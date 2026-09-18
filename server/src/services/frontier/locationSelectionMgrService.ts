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
  updateCharacterRecord,
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
const DEFAULT_FALLBACK_STATION_ID = 60003760;
const CLONE_SPAWN_CLEARANCE_METERS = 1_000;

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

function buildPythonDatetimePickle(date) {
  const normalizedDate = date instanceof Date && Number.isFinite(date.getTime())
    ? date
    : new Date();
  const year = normalizedDate.getUTCFullYear();
  const month = normalizedDate.getUTCMonth() + 1;
  const day = normalizedDate.getUTCDate();
  const hour = normalizedDate.getUTCHours();
  const minute = normalizedDate.getUTCMinutes();
  const second = normalizedDate.getUTCSeconds();
  const microsecond = normalizedDate.getUTCMilliseconds() * 1000;
  const datetimeBytes = Buffer.from([
    (year >> 8) & 0xff,
    year & 0xff,
    month & 0xff,
    day & 0xff,
    hour & 0xff,
    minute & 0xff,
    second & 0xff,
    (microsecond >> 16) & 0xff,
    (microsecond >> 8) & 0xff,
    microsecond & 0xff,
  ]);
  const datetimeUnicodeBytes = Buffer.from(
    datetimeBytes.toString("latin1"),
    "utf8",
  );
  const datetimeLength = Buffer.alloc(4);
  datetimeLength.writeUInt32LE(datetimeUnicodeBytes.length, 0);
  const encodingLength = Buffer.alloc(4);
  encodingLength.writeUInt32LE(6, 0);

  return Buffer.concat([
    Buffer.from([0x80, 0x02]),
    Buffer.from("cdatetime\ndatetime\nq\0c_codecs\nencode\nq\x01X", "latin1"),
    datetimeLength,
    datetimeUnicodeBytes,
    Buffer.from("q\x02X", "latin1"),
    encodingLength,
    Buffer.from("latin1q\x03", "latin1"),
    Buffer.from([0x86]),
    Buffer.from("q\x04Rq\x05", "latin1"),
    Buffer.from([0x85]),
    Buffer.from("q\x06Rq\x07.", "latin1"),
  ]);
}

function buildPythonDatetimePayload(milliseconds) {
  const date = new Date(Number(milliseconds));
  return {
    type: "cpicked",
    data: buildPythonDatetimePickle(date),
  };
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
    null,
    null,
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
        shipTypeID: CREATION_SHIP_TYPE_ID,
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
  if (!value || typeof value !== "object") {
    return null;
  }
  const header = Array.isArray(value.header) ? value.header : [];
  const className = String(header[0] || value.className || "");
  const keyArgs = Array.isArray(header[1])
    ? header[1]
    : Array.isArray(value.args)
      ? value.args
      : [];
  if (!className.endsWith("RefugeLocationKey") || keyArgs.length < 2) {
    return null;
  }
  const solarSystemID = toPositiveInt(keyArgs[0], 0);
  const locationID = toPositiveInt(keyArgs[1], 0);
  return solarSystemID > 0 && locationID > 0
    ? { solarSystemID, locationID }
    : null;
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

function clearCharacterActiveShip(characterID) {
  return updateCharacterRecord(characterID, (record) => ({
    ...record,
    shipID: 0,
    shipTypeID: 0,
    shipName: "",
  }));
}

function spawnAtAssembly(session, location) {
  const characterID = toPositiveInt(session && session.characterID, 0);
  const pending = getPendingCloneDeath(characterID);
  const fallbackStationID = toPositiveInt(
    pending && pending.fallbackStationID,
    DEFAULT_FALLBACK_STATION_ID,
  );
  const creationShip = resolveShipByTypeID(CREATION_SHIP_TYPE_ID) || {
    typeID: CREATION_SHIP_TYPE_ID,
    name: "Creation",
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
  const transitions = require(path.join(__dirname, "../../space/transitions"));
  return transitions.rebuildDockedSessionAtStation(session, location.locationID, {
    emitNotifications: true,
    logSelection: true,
    boardNewbieShip: true,
    newbieShipLogLabel: "CloneSelectionStationFallback",
  });
}

function spawnCharacterAtLocation(session, rawLocationKey) {
  const characterID = toPositiveInt(session && session.characterID, 0);
  const pending = getPendingCloneDeath(characterID);
  if (!pending || Date.now() < pending.readyAtMs) {
    return { success: false, errorMsg: "CLONE_SELECTION_NOT_READY" };
  }
  const requested = parseLocationKey(rawLocationKey);
  if (!requested) {
    return { success: false, errorMsg: "INVALID_CLONE_LOCATION" };
  }
  const location = resolveSelectableCloneLocations(characterID)
    .find((candidate) => (
      candidate.solarSystemID === requested.solarSystemID &&
      candidate.locationID === requested.locationID
    )) || (() => {
      // A station card is only shown when no refuge or deployed hangar is
      // available. Keep an already-presented fallback valid if an assembly
      // comes online while the clone-selection UI is open.
      const station = resolveFallbackStation(pending);
      return station &&
        station.solarSystemID === requested.solarSystemID &&
        station.locationID === requested.locationID
        ? station
        : null;
    })();
  if (!location) {
    return { success: false, errorMsg: "CLONE_LOCATION_UNAVAILABLE" };
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
    return buildAvailableLocationsPayload(
      session && (session.characterID || session.charid),
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
module.exports.DEATH_REPORT_CLASS = DEATH_REPORT_CLASS;
module.exports.buildAvailableLocationsPayload = buildAvailableLocationsPayload;
module.exports.buildDeathReportPayload = buildDeathReportPayload;
module.exports.buildLocationPayload = buildLocationPayload;
module.exports.clearCharacterActiveShip = clearCharacterActiveShip;
module.exports.getLastDeathReport = getLastDeathReport;
module.exports.getPendingCloneDeath = getPendingCloneDeath;
module.exports.listEligibleCloneAssemblies = listEligibleCloneAssemblies;
module.exports.parseLocationKey = parseLocationKey;
module.exports.recordCloneDeathReport = recordCloneDeathReport;
module.exports.recordEnvironmentalDeathReport = recordEnvironmentalDeathReport;
module.exports.recordPendingCloneDeath = recordPendingCloneDeath;
module.exports.resetDeathReports = resetDeathReports;
module.exports.resolveSelectableCloneLocations = resolveSelectableCloneLocations;
module.exports.spawnCharacterAtLocation = spawnCharacterAtLocation;
