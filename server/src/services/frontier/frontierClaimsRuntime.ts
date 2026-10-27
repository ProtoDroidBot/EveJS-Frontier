"use strict";

const { buildObjectEx1, buildList } = require("../_shared/serviceHelpers");
const TABLE = "frontierClaims";
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const fail = errorMsg => ({ success: false as const, errorMsg });
const PREFIX = "frontier.lagrange_occupancy.common.data_classes.";
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");

function isClaimableAssembly(item, deployment, policy = {}) {
  const state = deployment.readConstructionState(item);
  const configured = (policy as any).claimableAssemblyTypeIDs;
  return Boolean(item && state && Number(item.flagID) === 0 &&
    Number(state.assemblyTypeID) === Number(item.typeID) &&
    Number(state.solarSystemID) === Number(item.locationID) &&
    state.assemblyStatus !== deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION &&
    (!Array.isArray(configured) || configured.includes(Number(item.typeID))) &&
    deployment.listAssemblyDefinitions().some(definition => Number(definition.assemblyTypeID) === Number(item.typeID)));
}

function canClaimAtPointInScene(scene, session, item, anchor) {
  const ship = scene?.getShipEntityForSession?.(session);
  const entity = scene?.getEntity?.(item.itemID) || scene?.dynamicEntities?.get(item.itemID);
  const position = anchor?.position || anchor?.center;
  // Canonical Lagrange points are public world locations. A pocket entity at
  // matching coordinates cannot reserve a point outside its interaction scope.
  if (!ship || !entity || !position || (entity.session && entity.session !== session) ||
    !canEntitiesInteractLocally(ship, entity) || !canEntitiesInteractLocally(entity, anchor)) return false;
  if (![ship.position, entity.position, position].every(value => value && [value.x, value.y, value.z].every(Number.isFinite))) return false;
  return Math.hypot(entity.position.x - position.x, entity.position.y - position.y, entity.position.z - position.z) <= 80000 &&
    Math.hypot(ship.position.x - entity.position.x, ship.position.y - entity.position.y, ship.position.z - entity.position.z) <= 80000;
}

function marshalPoint(point) {
  return buildObjectEx1(`${PREFIX}LagrangePoint`, [point.solar_system_id, point.planet_id, point.lagrange_point_id]);
}
function marshalOccupant(row) {
  return row ? buildObjectEx1(`${PREFIX}Occupant`, [marshalPoint(row.lagrange_point),
    buildObjectEx1(`${PREFIX}OccupantGroup`, [row.group]), buildObjectEx1(`${PREFIX}OccupantType`, [row.type]), row.item_id, row.owner_id]) : null;
}

function createFrontierClaimsRuntime(options: Record<string, any>) {
  const repo = options.repo, now = options.now || Date.now;
  function read(key) {
    repo.ensureTable(TABLE);
    const result = repo.read(TABLE, key ? `/${key}` : "/");
    return result?.success ? clone(result.data) : null;
  }
  function write(key, row) {
    try {
      const ensured = repo.ensureTable(TABLE);
      if (ensured?.success === false) return fail("CLAIM_STORE_UNAVAILABLE");
      const result = repo.commitAtomicRowWrites([repo.prepareAtomicRowWrite(TABLE, key, row)]);
      return result?.success ? { success: true as const, data: row } : fail(result?.errorMsg || "CLAIM_WRITE_FAILED");
    }
    catch (_) { return fail("CLAIM_WRITE_FAILED"); }
  }
  function character(session) { return Number(session?.characterID || session?.charid); }
  function pointKey(point) {
    if (!point || ![point.solar_system_id, point.planet_id, point.lagrange_point_id].every(positive)) return null;
    return `l:${point.solar_system_id}:${point.planet_id}:${point.lagrange_point_id}`;
  }
  function getOccupant(point) {
    const key = pointKey(point); if (!key) return null;
    const row = read(key);
    if (!row || row.status !== "active" || !options.resolvePoint(row.lagrange_point)) return null;
    // Destruction/ownership changes revoke visibility immediately, even before
    // a scene lifecycle sweep gets to the durable claim receipt.
    const item = options.findItem(row.item_id);
    if (!item || Number(item.ownerID) !== row.owner_id || Number(item.locationID) !== row.lagrange_point.solar_system_id || !options.isClaimableAssembly(item)) return null;
    return row;
  }
  function addOccupant(session, input) {
    const id = character(session), point = input?.lagrange_point, key = pointKey(point);
    if (!positive(id) || !key || !options.resolvePoint(point)) return fail("INVALID_LAGRANGE_POINT_TYPE");
    if (Number(session?._space?.systemID || session?.solarsystemid2) !== Number(point.solar_system_id)) return fail("LAGRANGE_POINT_NOT_IN_SYSTEM");
    if (input.group !== "Player" || input.type !== "Base" || Number(input.owner_id) !== id || !positive(input.item_id)) return fail("INVALID_OCCUPANT_TYPE");
    const item = options.findItem(Number(input.item_id));
    if (!item || Number(item.ownerID) !== id || Number(item.locationID) !== Number(point.solar_system_id) || !options.isClaimableAssembly(item)) return fail("CLAIM_ITEM_NOT_OWNED");
    if (!options.canClaimAtPoint(session, item, point)) return fail("CLAIM_OUT_OF_RANGE");
    const previous = getOccupant(point);
    if (previous) return previous.item_id === Number(input.item_id) && previous.owner_id === id
      ? { success: true as const, duplicate: true, data: previous } : fail("ALREADY_CLAIMED");
    if (listOccupants().some(row => row.item_id === Number(input.item_id))) return fail("ASSEMBLY_ALREADY_CLAIMED");
    const row = { kind: "occupancy", status: "active", lagrange_point: {
      solar_system_id: Number(point.solar_system_id), planet_id: Number(point.planet_id), lagrange_point_id: Number(point.lagrange_point_id),
    }, group: "Player", type: "Base", item_id: Number(input.item_id), owner_id: id, updatedAtMs: now() };
    const result = write(key, row);
    if (result.success) options.publish?.(point.solar_system_id, "OnLagrangePointClaimed", [marshalOccupant(row)]);
    return result;
  }
  function removeOccupant(session, point) {
    const key = pointKey(point), row = key && read(key);
    if (!row || row.status !== "active") return { success: true as const, duplicate: true };
    if (row.owner_id !== character(session)) return fail("CLAIM_ACCESS_DENIED");
    const result = write(key, { ...row, status: "revoked", updatedAtMs: now() });
    if (result.success) options.publish?.(row.lagrange_point.solar_system_id, "OnLagrangePointUnclaimed", [marshalPoint(row.lagrange_point)]);
    return result;
  }
  function listOccupants(filter = null) {
    return Object.values<any>(read(null) || {}).filter(row => row.kind === "occupancy" && row.status === "active")
      .map(row => getOccupant(row.lagrange_point)).filter(row => row && (!filter || filter(row)));
  }
  function reconcileClaims() {
    for (const row of Object.values<any>(read(null) || {})) {
      if (row.kind !== "occupancy" || row.status !== "active" || getOccupant(row.lagrange_point)) continue;
      const result = write(pointKey(row.lagrange_point), { ...row, status: "revoked", updatedAtMs: now() });
      if (result.success) options.publish?.(row.lagrange_point.solar_system_id, "OnLagrangePointUnclaimed", [marshalPoint(row.lagrange_point)]);
    }
  }
  // Pack grants originate in operator policy or a trusted backend, never in
  // client-supplied claims. Revocation persists and overrides configured grants.
  function setPackEntitlement(characterID, packID, granted, source) {
    if (!positive(characterID) || !Number.isInteger(packID) || packID < 1 || packID > 11 || typeof granted !== "boolean" || typeof source !== "string" || !source.trim()) return fail("INVALID_PACK_ENTITLEMENT");
    return write(`p:${characterID}:${packID}`, { kind: "pack", characterID: Number(characterID), packID, granted, source, updatedAtMs: now() });
  }
  function getClaimedPacks(session) {
    const id = character(session); if (!positive(id)) return [];
    const configured = options.policy?.().packEntitlements?.[id] || [];
    const packs = new Set<number>(configured.filter(value => Number.isInteger(value) && value >= 1 && value <= 11));
    for (const row of Object.values<any>(read(null) || {})) if (row.kind === "pack" && row.characterID === id) {
      if (row.granted) packs.add(row.packID); else packs.delete(row.packID);
    }
    return [...packs].sort((a, b) => a - b);
  }
  function canBuild(session, typeID) {
    const required = options.policy?.().buildingPackRequirements?.[typeID];
    return required == null || getClaimedPacks(session).includes(Number(required));
  }
  return { addOccupant, removeOccupant, getOccupant, listOccupants, reconcileClaims, setPackEntitlement, getClaimedPacks, canBuild };
}

let production;
function getFrontierClaimsRuntime() {
  if (production) return production;
  const { createTableRepository } = require("../../gameStore/tableRepository");
  const items = require("../inventory/itemStore");
  const world = () => require("./explorationWorld").getConfiguredExplorationWorld();
  function resolvePoint(point) {
    const planet = world().systems.get(Number(point.solar_system_id))?.planets?.find(row => row.id === Number(point.planet_id));
    return planet?.lagrangePoints?.find(row => row.id === Number(point.lagrange_point_id)) || null;
  }
  production = createFrontierClaimsRuntime({
    repo: createTableRepository("service:frontier-claims", { strict: true }), findItem: items.findItemById,
    policy: () => require("../../config").frontierClaimsPolicy || {}, resolvePoint,
    isClaimableAssembly: item => isClaimableAssembly(item, require("./deploymentRuntime"), require("../../config").frontierClaimsPolicy || {}),
    canClaimAtPoint(session, item, point) {
      return canClaimAtPointInScene(require("../../space/runtime").getSceneForSession(session), session, item, resolvePoint(point));
    },
    publish(systemID, name, args) {
      for (const session of require("../chat/sessionRegistry").getSessions()) if (Number(session.solarsystemid2) === Number(systemID)) {
        try { session.sendNotification(name, "charid", args); } catch (_) { /* query is authoritative on reconnect */ }
      }
    },
  });
  return production;
}
module.exports = { createFrontierClaimsRuntime, getFrontierClaimsRuntime, marshalPoint, marshalOccupant, buildList, isClaimableAssembly, canClaimAtPointInScene };
