"use strict";

const path = require("path");

const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const templateRuntime = require(path.join(
  __dirname,
  "../../services/frontier/smartAssemblyConstructionTemplateRuntime",
));
const nativeNpcStore = require("./nativeNpcStore");
const persistence = require("./npcRuntimePersistence");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");
const construction = require("./npcConstructionJobService");
const npcIndustry = require("./npcIndustryJobService");
const { createNpcAssemblyActorContext } = require("./npcAssemblyActorContext");

const JOB_TYPE = "construction.template";
let handlerRegistered = false;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function running(step, checkpoint, nowMs, delayMs = 250, extra: Record<string, any> = {}) {
  return {
    status: behaviorRuntime.STATUS.RUNNING,
    step,
    checkpoint,
    nextWakeAtMs: Math.max(0, Number(nowMs) || 0) + Math.max(50, delayMs),
    ...extra,
  };
}

function suspended(step, checkpoint, nowMs, error, delayMs = 5_000) {
  return {
    status: behaviorRuntime.STATUS.SUSPENDED,
    step,
    checkpoint,
    error,
    nextWakeAtMs: Math.max(0, Number(nowMs) || 0) + Math.max(250, delayMs),
  };
}

function updateChildJobFromTick(child, result) {
  const latest = persistence.getNpcJob(child.jobID) || child;
  if (["completed", "failed", "cancelled"].includes(latest.status)) return latest;
  const normalized = behaviorRuntime.normalizeResult(result);
  const patch = normalized.status === behaviorRuntime.STATUS.SUCCESS
    ? {
        status: "completed",
        step: normalized.step || "completed",
        checkpoint: normalized.checkpoint || latest.checkpoint,
        lastError: null,
      }
    : normalized.status === behaviorRuntime.STATUS.FAILURE
      ? {
          status: "failed",
          step: normalized.step || "failed",
          checkpoint: normalized.checkpoint || latest.checkpoint,
          lastError: normalized.error || "NPC_CONSTRUCTION_TEMPLATE_CHILD_FAILED",
        }
      : {
          status: normalized.status === behaviorRuntime.STATUS.SUSPENDED ? "suspended" : "running",
          step: normalized.step || latest.step,
          checkpoint: normalized.checkpoint || latest.checkpoint,
          nextWakeAtMs: normalized.nextWakeAtMs || 0,
          lastError: normalized.error || null,
        };
  return persistence.updateNpcJob(latest.jobID, patch, {
    expectedRevision: latest.recordRevision,
  }).data;
}

function tickChildConstructionJob(context, child) {
  let active = child;
  if (active.status === "queued") {
    active = persistence.claimNpcJob(active.jobID, {
      expectedRevision: active.recordRevision,
      claimedBy: `template:${context.job.jobID}`,
    }).data;
  }
  const result = construction.tickNpcConstructionJob({
    ...context,
    job: active,
  });
  return {
    result,
    job: updateChildJobFromTick(active, result),
  };
}

function normalizeCheckpoint(job) {
  const checkpoint = cloneValue(job && job.checkpoint || {});
  if (!checkpoint.nodeStates || typeof checkpoint.nodeStates !== "object") {
    checkpoint.nodeStates = Object.fromEntries(
      (job.payload && job.payload.executionOrder || []).map((nodeID) => [nodeID, {
        nodeID,
        status: "pending",
        childJobID: null,
        assemblyItemID: 0,
        errorMsg: null,
      }]),
    );
  }
  return checkpoint;
}

function findNetworkNodeID(payload, checkpoint, node) {
  if (node.assemblyTypeID === 88_092) return null;
  for (const nodeID of payload.executionOrder || []) {
    const candidate = (payload.compiledNodes || []).find((entry) => entry.nodeID === nodeID);
    const state = checkpoint.nodeStates[nodeID];
    if (candidate && candidate.assemblyTypeID === 88_092 && state?.status === "completed") {
      return positiveInt(state.assemblyItemID, 0) || null;
    }
  }
  return positiveInt(payload.networkNodeID, 0) || null;
}

function applyNpcInitialInventory(entity, payload, node, state) {
  const entries = node.loadout && Array.isArray(node.loadout.initialInventory)
    ? node.loadout.initialInventory
    : [];
  if (entries.length === 0 || state.inventoryApplied === true) {
    state.inventoryApplied = true;
    return { success: true };
  }
  const actorID = positiveInt(entity.npcCharacterID, 0);
  const sources = Array.isArray(payload.materialSources) && payload.materialSources.length > 0
    ? payload.materialSources
    : [
        { ownerID: actorID, locationID: entity.entityID || entity.itemID, flagID: itemStore.ITEM_FLAGS.CARGO_HOLD },
        { ownerID: positiveInt(entity.ownerID, 0), locationID: entity.entityID || entity.itemID, flagID: itemStore.ITEM_FLAGS.CARGO_HOLD },
      ];
  for (const entry of entries) {
    let remaining = positiveInt(entry.quantity, 0);
    for (const source of sources) {
      if (remaining <= 0) break;
      const ownerID = positiveInt(source.ownerID, 0);
      const locationID = positiveInt(source.locationID, 0);
      if (!ownerID || !locationID) continue;
      const available = itemStore.listContainerItems(ownerID, locationID, source.flagID)
        .filter((item) => positiveInt(item.typeID, 0) === positiveInt(entry.typeID, 0))
        .reduce((sum, item) => sum + (Number(item.singleton) === 1
          ? 1
          : positiveInt(item.stacksize ?? item.quantity, 0)), 0);
      const quantity = Math.min(remaining, available);
      if (quantity <= 0) continue;
      const moved = itemStore.moveItemTypeFromCharacterLocation(
        ownerID,
        locationID,
        source.flagID,
        state.assemblyItemID,
        0,
        entry.typeID,
        quantity,
      );
      if (!moved.success) return moved;
      remaining -= quantity;
    }
    if (remaining > 0) {
      return { success: false, errorMsg: "NPC_CONSTRUCTION_TEMPLATE_LOADOUT_REQUIRED" };
    }
  }
  state.inventoryApplied = true;
  return { success: true };
}

function tickNpcConstructionTemplateJob(context) {
  const { job, entity, nowMs } = context;
  const payload = job.payload || {};
  const checkpoint = normalizeCheckpoint(job);
  if (entity.transient === true || positiveInt(entity.npcCharacterID, 0) !== job.npcCharacterID ||
      positiveInt(entity.npcIncarnation, 0) !== job.incarnation) {
    return {
      status: behaviorRuntime.STATUS.FAILURE,
      step: "invalid-assignment",
      checkpoint,
      error: "NPC_CONSTRUCTION_TEMPLATE_ASSIGNMENT_INVALID",
    };
  }
  if (positiveInt(payload.systemID, 0) !== positiveInt(entity.systemID, 0)) {
    return suspended("awaiting-system", checkpoint, nowMs, "NPC_CONSTRUCTION_WRONG_SYSTEM");
  }
  const nodes = new Map((payload.compiledNodes || []).map((node) => [node.nodeID, node]));
  for (const nodeID of payload.executionOrder || []) {
    const node: any = nodes.get(nodeID);
    const state = checkpoint.nodeStates[nodeID];
    if (!node || !state || state.status === "completed") continue;
    if ((node.dependsOn || []).some((dependency) =>
      checkpoint.nodeStates[dependency]?.status !== "completed")) {
      state.status = "waiting-dependencies";
      continue;
    }
    if (!state.childJobID) {
      const directPlacement = require("../../services/frontier/deploymentRuntime")
        .isPortableAssemblyType(node.assemblyTypeID);
      const fuel = Object.fromEntries(
        (node.loadout && node.loadout.initialFuel || [])
          .map((entry) => [String(entry.typeID), entry.quantity]),
      );
      const created = construction.createNpcConstructionJob({
        entityID: entity.entityID || entity.itemID,
        assemblyTypeID: node.assemblyTypeID,
        allowConcurrent: true,
        idempotencyKey: `construction-template:${job.jobID}:${nodeID}`,
        systemID: payload.systemID,
        position: node.position,
        rotation: node.rotation,
        networkNodeID: findNetworkNodeID(payload, checkpoint, node),
        materialSources: payload.materialSources,
        materialItemIDs: payload.materialItemIDs,
        fuel,
        commandNodeID: payload.commandNodeID,
        activate: node.loadout?.desiredStatus === "online",
        placementMode: directPlacement
          ? "directAssembly"
          : "constructionSite",
        target: { templateJobID: job.jobID, templateNodeID: nodeID },
      });
      if (!created.success) {
        state.status = created.errorMsg === "TOO_MANY_CONSTRUCTION_SITES"
          ? "queued-site-capacity"
          : "blocked";
        state.errorMsg = created.errorMsg;
        return suspended("create-child", checkpoint, nowMs, created.errorMsg);
      }
      state.childJobID = created.data.jobID;
      state.status = "running";
      return running("run-child", checkpoint, nowMs, 50);
    }
    let child = persistence.getNpcJob(state.childJobID);
    if (!child) {
      state.status = "blocked";
      state.errorMsg = "NPC_CONSTRUCTION_TEMPLATE_CHILD_NOT_FOUND";
      return suspended("recover-child", checkpoint, nowMs, state.errorMsg);
    }
    if (!["completed", "failed", "cancelled"].includes(child.status)) {
      const ticked = tickChildConstructionJob(context, child);
      child = ticked.job;
      state.status = child.status === "suspended" && child.lastError === "TOO_MANY_CONSTRUCTION_SITES"
        ? "queued-site-capacity"
        : child.status;
      state.errorMsg = child.lastError || null;
      return child.status === "failed"
        ? suspended("child-failed", checkpoint, nowMs, child.lastError || "NPC_CONSTRUCTION_TEMPLATE_CHILD_FAILED")
        : running("run-child", checkpoint, nowMs, Math.max(100, (child.nextWakeAtMs || nowMs) - nowMs));
    }
    if (child.status !== "completed") {
      state.status = "blocked";
      state.errorMsg = child.lastError || "NPC_CONSTRUCTION_TEMPLATE_CHILD_FAILED";
      return suspended("child-failed", checkpoint, nowMs, state.errorMsg, 30_000);
    }
    state.assemblyItemID = positiveInt(
      child.checkpoint && (child.checkpoint.assemblyItemID || child.checkpoint.completedAssembly?.itemID),
      0,
    );
    const loaded = applyNpcInitialInventory(entity, payload, node, state);
    if (!loaded.success) {
      state.status = "awaiting-loadout";
      state.errorMsg = loaded.errorMsg;
      return suspended("awaiting-loadout", checkpoint, nowMs, loaded.errorMsg);
    }
    const industryLanes = Array.isArray(node.loadout?.industryLanes)
      ? node.loadout.industryLanes : [];
    if (industryLanes.length > 0 && !state.industryJobID) {
      const industryJob = npcIndustry.createNpcIndustryJob({
        entityID: entity.entityID || entity.itemID,
        facilityID: state.assemblyItemID,
        lanes: industryLanes,
        allowConcurrent: true,
        collectOutputs: node.loadout?.collectIndustryOutputs !== false,
        idempotencyKey: `construction-template-industry:${job.jobID}:${nodeID}`,
        systemID: payload.systemID,
        target: { templateJobID: job.jobID, templateNodeID: nodeID },
      });
      if (!industryJob.success) {
        state.status = "awaiting-industry";
        state.errorMsg = industryJob.errorMsg;
        return suspended("create-industry-job", checkpoint, nowMs, industryJob.errorMsg);
      }
      state.industryJobID = industryJob.data.jobID;
      state.industryStatus = industryJob.data.status;
    }
    state.status = "completed";
    state.errorMsg = null;
    state.completedAtMs = Date.now();
    return running("next-node", checkpoint, nowMs, 50);
  }
  checkpoint.completedAtMs = Date.now();
  return { status: behaviorRuntime.STATUS.SUCCESS, step: "completed", checkpoint };
}

function createNpcConstructionTemplateJob(input: Record<string, any>) {
  try {
    const entityID = positiveInt(input && input.entityID, 0);
    const entity = nativeNpcStore.getNativeEntity(entityID);
    if (!entity || entity.transient === true) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const actor = createNpcAssemblyActorContext(entity);
    const principal = input.principal && typeof input.principal === "object"
      ? input.principal
      : { kind: "faction", id: actor.factionKey };
    if (!["faction", "npc"].includes(String(principal.kind || "").toLowerCase())) {
      return { success: false, errorMsg: "NPC_CONSTRUCTION_TEMPLATE_PRINCIPAL_INVALID" };
    }
    const geometry = templateRuntime.compileConstructionTemplateGeometry(
      principal,
      input.templateID,
      input.anchor || { position: entity.position, rotation: { yaw: 0, pitch: 0, roll: 0 } },
    );
    if (!geometry.success) return geometry;
    return persistence.createNpcJob({
      npcCharacterID: actor.actorID,
      incarnation: positiveInt(entity.npcIncarnation, 0),
      jobType: JOB_TYPE,
      idempotencyKey: input.idempotencyKey,
      target: cloneValue(input.target || { templateID: geometry.data.templateID }),
      payload: {
        ...cloneValue(input.payload || {}),
        templateID: geometry.data.templateID,
        templateRevision: geometry.data.templateRevision,
        compositionHash: geometry.data.compositionHash,
        principal: cloneValue(principal),
        anchor: geometry.data.anchor,
        executionOrder: geometry.data.executionOrder,
        compiledNodes: geometry.data.nodes,
        systemID: positiveInt(input.systemID, actor.solarSystemID),
        networkNodeID: positiveInt(input.networkNodeID, 0) || null,
        materialSources: cloneValue(input.materialSources || null),
        materialItemIDs: cloneValue(input.materialItemIDs || null),
        commandNodeID: positiveInt(input.commandNodeID, 0) || null,
      },
    });
  } catch (error) {
    return {
      success: false,
      errorMsg: error.code || error.message || "NPC_CONSTRUCTION_TEMPLATE_JOB_CREATE_FAILED",
    };
  }
}

function registerNpcConstructionTemplateJobHandler() {
  if (handlerRegistered) return;
  behaviorRuntime.registerNpcJobHandler(JOB_TYPE, tickNpcConstructionTemplateJob);
  handlerRegistered = true;
}

module.exports = {
  JOB_TYPE,
  createNpcConstructionTemplateJob,
  registerNpcConstructionTemplateJobHandler,
  tickNpcConstructionTemplateJob,
  _testing: {
    normalizeCheckpoint,
    updateChildJobFromTick,
  },
};
