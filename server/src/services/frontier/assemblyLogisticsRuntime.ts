"use strict";

const crypto = require("node:crypto");

const REQUEST_TYPE = "logistics.transfer";
const MAX_TRANSFER_DISTANCE = 5000;
const UINT32_MAX = 0xffffffff;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RETRYABLE = new Set([
  "ASSEMBLY_OFFLINE", "ASSEMBLY_ACTIVATING", "INSUFFICIENT_ITEMS",
  "INSUFFICIENT_SOURCE_ITEMS", "STORAGE_CAPACITY_EXCEEDED", "LOGISTICS_CAPACITY_EXCEEDED",
  "ASSEMBLY_STATE_PENDING", "ASSEMBLY_STATE_UNAVAILABLE", "LOGISTICS_CHAIN_PENDING",
  "WRITE_ERROR", "FLUSH_ERROR", "PERSISTENCE_FLUSH_ERROR", "LOGISTICS_PERSIST_FAILED",
  "STORAGE_TYPE_QUANTITY_EXCEEDED", "CAPACITY_EXCEEDED", "TYPE_QUANTITY_EXCEEDED",
]);

function fail(errorMsg, retryable = RETRYABLE.has(errorMsg)) {
  return { success: false as const, errorMsg, retryable };
}
function positive(value, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max ? value : 0;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]),
  );
  return value;
}

// Source in the request protocol is the REQUESTER. Its target is the SUPPLIER.
// Never take inventory owners, flags, endpoints, authority or range from payload.
function normalizeRequest(request) {
  const payload = request?.payload;
  const actor = request?.logistics?.actor;
  if (request?.requestType !== REQUEST_TYPE || !UUID.test(String(request?.requestID || "")) ||
      !positive(request?.sourceAssemblyID) || !positive(request?.targetAssemblyID) ||
      request.sourceAssemblyID === request.targetAssemblyID || !positive(request?.ownerID) ||
      request?.logistics?.version !== 1 || !["player", "npc"].includes(actor?.kind) ||
      !positive(actor?.actorID) || !payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).some(key => !["typeID", "quantity", "supplierLaneID", "requesterLaneID"].includes(key)) ||
      !positive(payload.typeID, UINT32_MAX) || !positive(payload.quantity, UINT32_MAX)) {
    return fail("LOGISTICS_REQUEST_INVALID");
  }
  const supplierLaneID = payload.supplierLaneID ?? 1;
  const requesterLaneID = payload.requesterLaneID ?? 1;
  if (!positive(supplierLaneID, 16) || !positive(requesterLaneID, 16)) return fail("INVALID_JOB_LANE");
  const command = {
    version: 1, requestID: request.requestID, ownerID: request.ownerID,
    requesterID: request.sourceAssemblyID, supplierID: request.targetAssemblyID,
    actor: { kind: actor.kind, actorID: actor.actorID },
    typeID: payload.typeID, quantity: payload.quantity, supplierLaneID, requesterLaneID,
  };
  return { success: true as const, data: command,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(stable(command))).digest("hex") };
}

function defaultDependencies() {
  return {
    itemStore: require("../inventory/itemStore"),
    deployment: require("./deploymentRuntime"),
    access: require("./assemblyAccessRuntime"),
    storage: require("./smartStorageUnitRuntime"),
    turret: require("./smartTurretInventoryRuntime"),
    field: require("./fieldStorageInventoryRuntime"),
    blueprints: require("./industryBlueprints"),
    industry: require("./industryRuntime"),
    chain: require("./assemblyLogisticsChain"),
    now: Date.now,
    notify: publishChanges,
  };
}

function publishChanges(result) {
  const itemStore = require("../inventory/itemStore");
  const sessions = require("../chat/sessionRegistry").getSessions();
  const { emitItemsChangedForSession } = require("../character/characterState");
  const warn = error => require("../../utils/logger").warn(`[AssemblyLogistics] Inventory notification failed: ${error.message}`);
  for (const session of sessions) {
    if (Number(session.characterID || session.charid) !== result.destinationOwnerID) continue;
    // Split stacks have distinct previous values; a shared batch change
    // dictionary would corrupt the client's remainder/new-stack cache.
    for (const change of result.changes || []) {
      const item = change.removed
        ? itemStore.buildRemovedItemNotificationState(change.previousData || change.item) : change.item;
      if (!item) continue;
      try { emitItemsChangedForSession(session, item, change.previousData || {}); }
      catch (error) { warn(error); }
    }
  }
  for (const side of ["source", "destination"]) {
    try {
      const id = result[`${side}LocationID`], kind = result.context?.[`${side}Kind`];
      const ownerID = result[`${side}OwnerID`];
      if (kind === "industry") {
        const industry = require("./industryRuntime");
        const notices = require("./industryNotifications");
        const facility = itemStore.findItemById(id);
        const lane = industry.industryEscrowLaneForFlag(result[`${side}FlagID`]);
        if (!facility || !lane) continue;
        if (lane.laneID === 1) notices.publishIndustryItemsChanged({ characterID: ownerID }, id,
          lane.side, industry.getFacilityItems(facility, lane.laneID)[lane.side]);
        notices.publishIndustryJobLaneChanged(null, facility, { laneID: lane.laneID, type: "items_changed" });
      } else if (kind === "storage_unit") {
        const { getStorageUnitProtoTypes } = require("../../_secondary/express/gatewayServices/assemblyStorageUnitProto");
        const { encodePayload } = require("../../_secondary/express/gatewayServices/gatewayServiceHelpers");
        const { publishGatewayNotice } = require("../../_secondary/express/publicGatewayLocal");
        const name = side === "source" ? "InventoryItemWithdrawnNotice" : "InventoryItemDepositedNotice";
        for (const move of result.moves || []) {
          const item = result.changes?.find(change => change.item?.itemID === move.movedItemID)?.item;
          publishGatewayNotice(`eve_public.assembly.storageunit.api.${name}`,
            encodePayload(getStorageUnitProtoTypes()[name], {
              storage_unit: { sequential: id }, character: { sequential: ownerID },
              item: { identifier: { sequential: side === "source" ? move.sourceItemID : move.movedItemID },
                attributes: { identifier: { sequential: result.typeID }, quantity: move.quantity,
                  volume: itemStore.getInventoryItemUnitVolume(item) * move.quantity } },
            }), { character: ownerID });
        }
      }
    } catch (error) { warn(error); }
  }
}

function createAssemblyLogisticsRuntime(overrides: Record<string, any> = {}) {
  // Injected unit tests never need to initialize a live game store.
  const deps = overrides.dependencies || defaultDependencies();

  function endpoint(id, command, receiving, requireOnline) {
    const record = deps.deployment.getAssemblyRecord(id);
    const item = deps.itemStore.findItemById(id);
    if (!record || !item || record.itemID !== id || Number(item.typeID) !== record.assemblyTypeID) {
      return fail("ASSEMBLY_NOT_FOUND");
    }
    if (record.ownerID !== command.ownerID || Number(item.ownerID) !== command.ownerID) {
      return fail("LOGISTICS_OWNER_MISMATCH");
    }
    if (record.assemblyStatus === 5) return fail("ASSEMBLY_UNDER_CONSTRUCTION");
    if (requireOnline && record.assemblyStatus !== 2) return fail("ASSEMBLY_OFFLINE");
    if (requireOnline && Number(record.activationCompleteAtMs) > deps.now()) return fail("ASSEMBLY_ACTIVATING");
    const capabilities = receiving ? ["operate", "inventory.deposit"] : ["inventory.withdraw"];
    const access = deps.access.resolveAccess(command.actor, id, capabilities);
    if (!access?.success) return fail(access?.errorMsg || "ASSEMBLY_ACCESS_DENIED");
    const laneID = receiving ? command.requesterLaneID : command.supplierLaneID;
    let kind, flagID, capacity, maxTypeQuantity = UINT32_MAX, range = MAX_TRANSFER_DISTANCE;
    const storage = deps.storage.getStorageComponent(item.typeID);
    const field = deps.field.getFieldStorageComponent(item.typeID);
    if (storage) {
      kind = "storage_unit"; flagID = 66; capacity = Number(storage.storageCapacity);
    } else if (field) {
      if ((receiving && !field.allowUserAdd) || (!receiving && !field.allowUserTake)) return fail("ASSEMBLY_ACCESS_DENIED");
      kind = "field_storage"; flagID = 0;
      capacity = Number(item.capacity ?? deps.itemStore.getItemMetadata(item.typeID)?.capacity);
      range = Math.min(range, Number(field.accessRange));
    } else if (deps.turret.getTurretComponent(item.typeID)) {
      kind = "turret"; flagID = 0;
      capacity = Number(item.capacity ?? deps.itemStore.getItemMetadata(item.typeID)?.capacity);
    } else if (deps.blueprints.isIndustryFacilityType(item.typeID)) {
      // A generic inventory grant must not bypass Industry's independent lane policy.
      // Autonomous Industry currently operates the assembly owner's own lanes.
      if (command.actor.actorID !== record.ownerID) return fail("JOB_LANE_ACCESS_DENIED");
      const blueprint = deps.blueprints.getSelectedBlueprint(item, laneID);
      if (!blueprint) return fail("BLUEPRINT_NOT_LOADED");
      const slot = (receiving ? blueprint.inputs : blueprint.outputs)?.[command.typeID];
      if (!slot || !positive(slot.max_storable_quantity)) return fail("INVALID_INPUT_TYPE");
      kind = "industry";
      flagID = receiving ? deps.industry.industryInputFlagForLane(laneID) : deps.industry.industryOutputFlagForLane(laneID);
      maxTypeQuantity = Math.min(UINT32_MAX, slot.max_storable_quantity);
      // Industry capacity is authored per type/blueprint, not a generic cargo volume.
    } else return fail("LOGISTICS_INVENTORY_UNSUPPORTED");
    if (kind !== "industry" && (!Number.isFinite(capacity) || capacity <= 0)) return fail("INVALID_INVENTORY");
    if (!Number.isFinite(range) || range <= 0) return fail("LOGISTICS_RANGE_INVALID");
    if (kind !== "industry" && laneID !== 1) return fail("INVALID_JOB_LANE");
    return { success: true as const, data: { record, item, kind, flagID, capacity, maxTypeQuantity, range } };
  }

  function authorize(request, requireOnline = true) {
    const normalized = normalizeRequest(request);
    if (normalized.success === false) return normalized;
    const command = normalized.data;
    const source = endpoint(command.supplierID, command, false, requireOnline);
    if (source.success === false) return source;
    const destination = endpoint(command.requesterID, command, true, requireOnline);
    if (destination.success === false) return destination;
    const left = source.data.record, right = destination.data.record;
    if (!positive(left.solarSystemID) || left.solarSystemID !== right.solarSystemID ||
        Number(source.data.item.locationID) !== left.solarSystemID ||
        Number(destination.data.item.locationID) !== right.solarSystemID) return fail("ASSEMBLY_NOT_IN_CURRENT_SYSTEM");
    const vectors = [left.position, right.position];
    if (vectors.some(v => !v || [v.x, v.y, v.z].some(n => typeof n !== "number" || !Number.isFinite(n)))) {
      return fail("LOGISTICS_POSITION_UNAVAILABLE");
    }
    const distance = Math.hypot(left.position.x - right.position.x,
      left.position.y - right.position.y, left.position.z - right.position.z);
    if (distance > Math.min(source.data.range, destination.data.range)) return fail("ASSEMBLY_OUT_OF_RANGE");
    return { success: true as const, data: { command, source: source.data, destination: destination.data },
      fingerprint: normalized.fingerprint };
  }

  async function finishReceipt(request, receipt) {
    const normalized = normalizeRequest(request);
    if (normalized.success === false) return normalized;
    if (receipt.operationFingerprint !== normalized.fingerprint) return fail("LOGISTICS_IDEMPOTENCY_CONFLICT");
    const saved = receipt.result;
    if (!saved?.context || saved.quantity !== normalized.data.quantity ||
        saved.typeID !== normalized.data.typeID || saved.sourceLocationID !== normalized.data.supplierID ||
        saved.destinationLocationID !== normalized.data.requesterID) return fail("LOGISTICS_RECEIPT_INVALID");
    const synchronized = await deps.chain.syncAssemblyLogisticsTransfer(saved.context);
    if (!["synced", "disabled"].includes(synchronized?.status)) {
      return { ...fail("LOGISTICS_CHAIN_PENDING", true), gameCommitted: true };
    }
    // Stable terminal value: retries must not change an attested outcome.
    return { success: true as const, data: {
      operationID: normalized.data.requestID, typeID: saved.typeID, quantity: saved.quantity,
      supplierAssemblyID: saved.sourceLocationID, requesterAssemblyID: saved.destinationLocationID,
      gameCommitted: true,
    } };
  }

  async function getCommittedResult(request) {
    const receipt = deps.itemStore.findAssemblyLogisticsReceipt(request?.requestID, request?.sourceAssemblyID);
    return receipt ? finishReceipt(request, receipt) : null;
  }

  async function execute(request, options: Record<string, any> = {}) {
    const replay = await getCommittedResult(request);
    if (replay) return replay;
    const initial = authorize(request, false);
    if (initial.success === false) return initial;
    const plan = initial.data;
    const context = {
      sourceAssemblyID: plan.command.supplierID, destinationAssemblyID: plan.command.requesterID,
      sourceOwnerID: plan.command.ownerID, destinationOwnerID: plan.command.ownerID,
      sourceKind: plan.source.kind, destinationKind: plan.destination.kind,
      sourceCreateOnChain: plan.source.record.createOnChain, destinationCreateOnChain: plan.destination.record.createOnChain,
    };
    try {
      const committed = await deps.chain.runWithAssemblyLogisticsAuthority(context, () => {
        // The async chain refresh may outlive the claim or a permission grant.
        // Recheck everything in the same synchronous turn as the item-table write.
        if (typeof options.assertClaim !== "function") return fail("LOGISTICS_CLAIM_REQUIRED");
        const claim = options.assertClaim();
        if (!claim?.success) return fail(claim?.errorMsg || "LOGISTICS_CLAIM_INVALID", true);
        const current = authorize(request, true);
        if (current.success === false) return current;
        if (current.data.source.kind !== context.sourceKind || current.data.destination.kind !== context.destinationKind ||
            current.data.source.record.createOnChain !== context.sourceCreateOnChain ||
            current.data.destination.record.createOnChain !== context.destinationCreateOnChain) return fail("LOGISTICS_ENDPOINT_CHANGED");
        return deps.itemStore.transferAssemblyItemType({
          operationID: request.requestID, operationFingerprint: current.fingerprint,
          sourceOwnerID: plan.command.ownerID, sourceLocationID: plan.command.supplierID,
          sourceFlagID: current.data.source.flagID,
          destinationOwnerID: plan.command.ownerID, destinationLocationID: plan.command.requesterID,
          destinationFlagID: current.data.destination.flagID,
          typeID: plan.command.typeID, quantity: plan.command.quantity,
          ...(current.data.destination.capacity !== undefined ? { destinationCapacity: current.data.destination.capacity } : {}),
          maxTypeQuantity: current.data.destination.maxTypeQuantity,
          receiptContext: context, committedAtMs: deps.now(),
        });
      });
      if (!committed?.success) return fail(committed?.errorMsg || "LOGISTICS_TRANSFER_FAILED", committed?.retryable ?? RETRYABLE.has(committed?.errorMsg));
      if (!committed.replayed) {
        try { deps.notify(committed.data); } catch (_) { /* Commit is durable; presentation cannot undo it. */ }
      }
      return await getCommittedResult(request) || fail("LOGISTICS_RECEIPT_INVALID");
    } catch (error) {
      // A commit may precede a chain/transport error. Always look for its receipt
      // on the next pass; never infer that inventory needs to be moved again.
      return fail(error?.code || "ASSEMBLY_STATE_UNAVAILABLE", true);
    }
  }
  return { execute, getCommittedResult, authorizeRequest: (request) => authorize(request, false) };
}

let singleton;
function getRuntime() { return singleton ||= createAssemblyLogisticsRuntime(); }

/** Trusted assembly runtimes can enqueue supply work without a player session. */
function requestAssemblyItems(requesterID, supplierID, typeID, quantity, options: Record<string, any> = {}) {
  const deployment = require("./deploymentRuntime");
  const assembly = deployment.getAssemblyRecord(requesterID);
  if (!assembly) return fail("ASSEMBLY_NOT_FOUND");
  const { NPC_CHARACTER_ID_MIN, NPC_CHARACTER_ID_MAX } = require("../_shared/npcIdentityConstants");
  const identity = options.actor || {
    kind: assembly.ownerID >= NPC_CHARACTER_ID_MIN && assembly.ownerID <= NPC_CHARACTER_ID_MAX ? "npc" : "player",
    actorID: assembly.ownerID,
  };
  // Persist identity only. Access resolution reloads current tribe/faction and
  // grants; session hints must not become durable authority or queue metadata.
  const actor = { kind: identity.kind, actorID: identity.actorID };
  const requestID = options.requestID || crypto.randomUUID();
  const payload = { typeID, quantity,
    ...(options.supplierLaneID !== undefined ? { supplierLaneID: options.supplierLaneID } : {}),
    ...(options.requesterLaneID !== undefined ? { requesterLaneID: options.requesterLaneID } : {}),
  };
  const allowed = getRuntime().authorizeRequest({
    requestID, requestType: REQUEST_TYPE, sourceAssemblyID: requesterID, targetAssemblyID: supplierID,
    ownerID: assembly.ownerID, payload, logistics: { version: 1, actor },
  });
  if (!allowed.success) return allowed;
  return require("./smartAssemblyRequestRuntime").createRequest(requesterID, supplierID, REQUEST_TYPE, {
    requestID, ownerID: assembly.ownerID, payload, priority: options.priority,
    priorityFlags: options.priorityFlags ?? 8, expiresInMs: options.expiresInMs,
    allowCrossOwner: false, _logisticsActor: actor,
  });
}

module.exports = {
  REQUEST_TYPE, MAX_TRANSFER_DISTANCE, createAssemblyLogisticsRuntime, requestAssemblyItems,
  execute: (request, options) => getRuntime().execute(request, options),
  getCommittedResult: request => getRuntime().getCommittedResult(request),
  authorizeRequest: request => getRuntime().authorizeRequest(request),
  _testing: { normalizeRequest, publishChanges },
};
