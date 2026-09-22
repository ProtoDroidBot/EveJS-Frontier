"use strict";

const path = require("path");

const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const deploymentRuntime = require(path.join(__dirname, "../../services/frontier/deploymentRuntime"));
const energyRuntime = require(path.join(__dirname, "../../services/frontier/networkNodeEnergyRuntime"));
const fuelRuntime = require(path.join(__dirname, "../../services/frontier/networkNodeFuelRuntime"));
const requestRuntime = require(path.join(__dirname, "../../services/frontier/smartAssemblyRequestRuntime"));
const nativeNpcStore = require("./nativeNpcStore");
const persistence = require("./npcRuntimePersistence");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");
const constructionJobs = require("./npcConstructionJobService");
const { createNpcAssemblyActorContext } = require("./npcAssemblyActorContext");

const SIGNAL_TYPE = "network_node.resources";
const MAINTENANCE_JOB_TYPE = "network-node.maintenance";
const ACTIVE_STATUSES = ["queued", "running", "suspended"];
const RECONCILE_INTERVAL_MS = 2_000;
const PRIORITY_WEIGHT = Object.freeze({
  unspecified: 0,
  production: 1,
  logistics: 2,
  navigation: 3,
  defense: 4,
  maintenance: 5,
});

let registered = false;
let nextReconcileAtMs = 0;
let reconcilePromise: Promise<any> | null = null;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function metadataForAssemblyID(assemblyID) {
  return deploymentRuntime.readNpcConstructionMetadata(itemStore.findItemById(assemblyID));
}

function servicePriority(metadata) {
  const flags = Array.isArray(metadata?.servicePriorityFlags)
    ? metadata.servicePriorityFlags : [];
  return flags.reduce((weight, flag) => Math.max(
    weight,
    PRIORITY_WEIGHT[String(flag || "").trim().toLowerCase()] || 0,
  ), PRIORITY_WEIGHT.unspecified);
}

/** Lowest-priority, explicitly eligible services are selected first. */
function buildLoadSheddingPlan(status, options: Record<string, any> = {}) {
  const factionKey = String(options.factionKey || "").trim().toLowerCase();
  const protectedIDs = new Set(
    (Array.isArray(options.protectedAssemblyIDs) ? options.protectedAssemblyIDs : [])
      .map((value) => positiveInt(value, 0)).filter(Boolean),
  );
  const actualEnergyUsed = Math.max(0, Number(status?.power?.actualEnergyUsed) || 0);
  const energyProduction = Math.max(0, Number(status?.power?.energyProduction) || 0);
  const requestedEnergy = Math.max(0, Number(status?.error?.requestedEnergy) || 0);
  const flags = new Set(Array.isArray(status?.activeFlags) ? status.activeFlags : []);
  const explicitRelief = Number(options.requiredRelief);
  const requiredRelief = Math.max(0, Number.isFinite(explicitRelief)
    ? explicitRelief
    : flags.has("POWER_LIMIT_EXCEEDED") || status?.power?.overLimit === true ||
        actualEnergyUsed > energyProduction
      ? actualEnergyUsed + requestedEnergy - energyProduction
      : actualEnergyUsed - energyProduction * 0.8);
  const resolveMetadata = typeof options.resolveMetadata === "function"
    ? options.resolveMetadata : metadataForAssemblyID;
  const candidates = (Array.isArray(status?.connectedAssemblies)
    ? status.connectedAssemblies : []).flatMap((entry) => {
    const assemblyID = positiveInt(entry?.itemID, 0);
    const metadata = assemblyID ? resolveMetadata(assemblyID) : null;
    if (!assemblyID || protectedIDs.has(assemblyID) || Number(entry?.assemblyStatus) !== 2 ||
        !metadata || metadata.registeredForFaction !== true ||
        String(metadata.factionKey || "").toLowerCase() !== factionKey ||
        metadata.essentialService === true || metadata.loadSheddingEligible === false) return [];
    return [{
      assemblyID,
      energyRelief: Math.max(0, Number(entry.energyUsed) || Number(entry.energyRequired) || 0),
      priority: servicePriority(metadata),
      servicePriorityFlags: cloneValue(metadata.servicePriorityFlags || []),
    }];
  }).sort((left, right) => left.priority - right.priority ||
    right.energyRelief - left.energyRelief || left.assemblyID - right.assemblyID);
  const selected: any[] = [];
  let energyRelief = 0;
  for (const candidate of candidates) {
    if (energyRelief >= requiredRelief) break;
    selected.push(candidate);
    energyRelief += candidate.energyRelief;
  }
  return {
    requiredRelief,
    energyRelief,
    sufficient: energyRelief >= requiredRelief,
    candidates,
    selected,
  };
}

function jobTargetsNode(job, nodeID) {
  return positiveInt(job?.payload?.networkNodeID, 0) === nodeID ||
    positiveInt(job?.checkpoint?.placement?.networkNodeID, 0) === nodeID ||
    positiveInt(job?.target?.networkNodeID, 0) === nodeID;
}

function reconcileDependentJobs(nodeID, exactStatus) {
  const flags = new Set(Array.isArray(exactStatus?.activeFlags) ? exactStatus.activeFlags : []);
  const unavailable = flags.has("FUEL_EMPTY") || flags.has("POWER_USAGE_OFFLINE");
  const constrained = flags.has("POWER_LIMIT_EXCEEDED") || flags.has("POWER_USAGE_HIGH");
  let changed = 0;
  for (const job of persistence.listNpcJobs({ statuses: ACTIVE_STATUSES })) {
    if (job.jobType === MAINTENANCE_JOB_TYPE || !jobTargetsNode(job, nodeID)) continue;
    const gate = job.checkpoint?.networkNodeGate || null;
    if (job.status === "suspended" && !gate) continue;
    if (constrained && job.payload?.essentialService === true) continue;
    if (constrained && !constructionJobs.CONSTRUCTION_JOB_TYPES.includes(job.jobType) &&
        job.jobType !== "construction.template") continue;
    if (unavailable || constrained) {
      const reason = unavailable ? "NPC_NETWORK_NODE_UNAVAILABLE" : "NPC_NETWORK_NODE_CAPACITY_RESERVED";
      const step = unavailable ? "awaiting-network-node" : "awaiting-energy-capacity";
      if (job.status === "suspended" && job.step === step && job.lastError === reason) continue;
      persistence.updateNpcJob(job.jobID, {
        status: "suspended",
        step,
        lastError: reason,
        nextWakeAtMs: Date.now() + 5_000,
        checkpoint: {
          ...(job.checkpoint || {}),
          networkNodeGate: {
            nodeID,
            resumeStep: gate?.resumeStep || job.step,
            resumeStatus: gate?.resumeStatus || job.status,
            suspendedAtMs: Date.now(),
            reason,
          },
        },
      }, { expectedRevision: job.recordRevision });
      changed += 1;
    } else if (job.status === "suspended" && gate?.nodeID === nodeID &&
        ["awaiting-network-node", "awaiting-energy-capacity"].includes(job.step)) {
      const checkpoint = { ...(job.checkpoint || {}) };
      delete checkpoint.networkNodeGate;
      persistence.updateNpcJob(job.jobID, {
        status: gate.resumeStatus === "queued" ? "queued" : "running",
        step: gate.resumeStep || "network-node-restored",
        checkpoint,
        lastError: null,
        nextWakeAtMs: 0,
      }, { expectedRevision: job.recordRevision });
      changed += 1;
    }
  }
  return changed;
}

function findActiveFactionNpc(factionKey, systemID, preferredCharacterID = 0, assemblyID = 0) {
  const candidates = nativeNpcStore.listNativeEntities()
    .filter((entity) => entity.transient !== true &&
      positiveInt(entity.systemID, 0) === positiveInt(systemID, 0))
    .flatMap((entity) => {
      try {
        const actor = createNpcAssemblyActorContext(entity);
        return actor.factionKey === factionKey ? [{ entity, actor }] : [];
      } catch { return []; }
    })
    .sort((left, right) => (
      Number(right.actor.actorID === preferredCharacterID) - Number(left.actor.actorID === preferredCharacterID) ||
      left.actor.actorID - right.actor.actorID
    ));
  return candidates.find(({ actor, entity }) =>
    !persistence.getActiveNpcJob(actor.actorID, positiveInt(entity.npcIncarnation, 0)) &&
    (!assemblyID || deploymentRuntime.getNpcAssemblyControlLifecycle(actor, assemblyID).success)
  ) || null;
}

function unresolvedMaintenanceKind(status) {
  const flags = new Set(Array.isArray(status?.activeFlags) ? status.activeFlags : []);
  if (flags.has("FUEL_EMPTY") || flags.has("FUEL_LOW")) return "fuel";
  if (flags.has("POWER_LIMIT_EXCEEDED") || flags.has("POWER_USAGE_HIGH")) return "load-shedding";
  return null;
}

function ensureMaintenanceJob(node, metadata, exactStatus, revision = 0) {
  const kind = unresolvedMaintenanceKind(exactStatus);
  if (!kind) return null;
  const existing = persistence.listNpcJobs({ statuses: ACTIVE_STATUSES }).find((job) =>
    job.jobType === MAINTENANCE_JOB_TYPE && positiveInt(job.payload?.networkNodeID, 0) === node.itemID &&
    job.payload?.maintenanceKind === kind);
  if (existing) return existing;
  const selected = findActiveFactionNpc(
    metadata.factionKey,
    node.locationID,
    positiveInt(node.ownerID, 0),
    node.itemID,
  );
  if (!selected) return null;
  const plan = kind === "load-shedding"
    ? buildLoadSheddingPlan(exactStatus, { factionKey: metadata.factionKey }) : null;
  return persistence.createNpcJob({
    npcCharacterID: selected.actor.actorID,
    incarnation: positiveInt(selected.entity.npcIncarnation, 1),
    jobType: MAINTENANCE_JOB_TYPE,
    idempotencyKey: `${MAINTENANCE_JOB_TYPE}:${node.itemID}:${kind}:${Math.max(0, revision)}`,
    target: { networkNodeID: node.itemID },
    payload: {
      networkNodeID: node.itemID,
      factionKey: metadata.factionKey,
      maintenanceKind: kind,
      observedRevision: Math.max(0, revision),
      loadSheddingPlan: plan,
    },
  }).data;
}

async function reconcileNetworkNode(node) {
  const metadata = deploymentRuntime.readNpcConstructionMetadata(node);
  if (!metadata || metadata.registeredForFaction !== true || !metadata.factionKey) return null;
  const observerID = `faction:${metadata.factionKey}:command:${positiveInt(metadata.commandNodeID, node.itemID)}`;
  let observedStatus = null;
  let observedRevision = 0;
  const reconciled = await persistence.reconcileNpcAssemblySignalJournal({
    observerID,
    assemblyID: node.itemID,
    signalType: SIGNAL_TYPE,
    listSignals: requestRuntime.listSignals,
    getOperationalStatus: requestRuntime.getAssemblyOperationalStatus,
    planObservation: async (observation) => {
      if (positiveInt(observation?.revision, 0) >= observedRevision) {
        observedRevision = positiveInt(observation?.revision, 0);
        observedStatus = cloneValue(observation?.status || null);
      }
      return null;
    },
  });
  if (!reconciled.success) return reconciled;
  const exact = energyRuntime.getNetworkNodeEnergyStatus(node.ownerID, node.itemID);
  if (!exact.success) return exact;
  const exactStatus = {
    ...exact.data.resourceSignals,
    connectedAssemblies: cloneValue(exact.data.connectedAssemblies || []),
  };
  const observedFlags = new Set(Array.isArray(observedStatus?.activeFlags)
    ? observedStatus.activeFlags : []);
  const actionableObservedStatus = observedFlags.has("POWER_LIMIT_EXCEEDED")
    ? {
        ...exactStatus,
        activeFlags: [...new Set([
          ...(exactStatus.activeFlags || []),
          "POWER_LIMIT_EXCEEDED",
        ])],
        error: cloneValue(observedStatus.error || null),
      }
    : exactStatus;
  reconcileDependentJobs(node.itemID, actionableObservedStatus);
  // Publish the canonical band after consuming the journal. This clears a
  // one-shot rejected-activation signal only after its durable job exists.
  energyRuntime.publishNetworkNodeOperationalStatus(node.itemID);
  const current = requestRuntime.getAssemblyOperationalStatus(node.itemID, { signalType: SIGNAL_TYPE });
  ensureMaintenanceJob(
    node,
    metadata,
    actionableObservedStatus,
    Math.max(observedRevision, current.data?.revision || 0),
  );
  return { success: true, data: exact.data };
}

async function reconcileNpcNetworkNodes(options: Record<string, any> = {}) {
  const systemID = positiveInt(options.systemID, 0);
  const nodes = deploymentRuntime.listAssemblies()
    .filter((record) => Number(record.assemblyTypeID) === Number(fuelRuntime.NETWORK_NODE_TYPE_ID))
    .filter((record) => !systemID || positiveInt(record.solarSystemID, 0) === systemID)
    .map((record) => itemStore.findItemById(record.itemID))
    .filter(Boolean)
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
  const results: any[] = [];
  for (const node of nodes) results.push(await reconcileNetworkNode(node));
  return { success: true, data: { count: nodes.length, results } };
}

function scheduleNpcNetworkNodeReconciliation(systemID, nowMs = Date.now()) {
  if (reconcilePromise || nowMs < nextReconcileAtMs) return false;
  nextReconcileAtMs = nowMs + RECONCILE_INTERVAL_MS;
  reconcilePromise = reconcileNpcNetworkNodes({ systemID })
    .catch(() => null)
    .finally(() => { reconcilePromise = null; });
  return true;
}

function maintenanceResult(status, step, checkpoint, nowMs, error = null, delayMs = 5_000) {
  return { status, step, checkpoint, error, nextWakeAtMs: nowMs + delayMs };
}

function tickNetworkNodeMaintenanceJob(context) {
  const { job, entity, nowMs } = context;
  const payload = job.payload || {};
  const checkpoint = { ...(job.checkpoint || {}) };
  let actor;
  try { actor = createNpcAssemblyActorContext(entity); } catch (error) {
    return maintenanceResult(behaviorRuntime.STATUS.SUSPENDED, "identity-recovery", checkpoint, nowMs, error.code || error.message);
  }
  const nodeID = positiveInt(payload.networkNodeID, 0);
  const exact = energyRuntime.getNetworkNodeEnergyStatus(
    positiveInt(itemStore.findItemById(nodeID)?.ownerID, 0), nodeID,
  );
  if (!exact.success) return maintenanceResult(
    behaviorRuntime.STATUS.SUSPENDED, "node-recovery", checkpoint, nowMs, exact.errorMsg,
  );
  if (payload.maintenanceKind === "fuel") {
    if (!exact.data.resourceSignals.fuel.low) {
      return { status: behaviorRuntime.STATUS.SUCCESS, step: "fuel-restored", checkpoint };
    }
    let requestedFuel = Math.max(1, positiveInt(payload.fuel?.quantity, 1));
    let plan = constructionJobs._testing.planFuelItems(
      entity, actor, { ...(payload.fuel || {}), quantity: requestedFuel },
    );
    if (plan.success && !payload.fuel?.quantity) {
      const typeID = positiveInt(plan.data[0]?.typeID, 0);
      const unitVolume = Math.max(0, Number(
        itemStore.getInventoryItemUnitVolume({ typeID }),
      ) || 0);
      if (unitVolume > 0) {
        const capacity = Math.max(0, Number(exact.data.resourceSignals.fuel.capacityVolume) || 0);
        const used = Math.max(0, Number(exact.data.resourceSignals.fuel.usedVolume) || 0);
        requestedFuel = Math.max(1, Math.ceil((capacity * 0.5 - used) / unitVolume));
        const refill = constructionJobs._testing.planFuelItems(
          entity, actor, { ...(payload.fuel || {}), quantity: requestedFuel },
        );
        if (refill.success) plan = refill;
      }
    }
    if (!plan.success) return maintenanceResult(
      behaviorRuntime.STATUS.SUSPENDED, "awaiting-fuel", checkpoint, nowMs, "NETWORK_NODE_FUEL_REQUIRED",
    );
    const reservedKeys: string[] = [];
    for (const entry of plan.data) {
      const resourceKey = `network-node-fuel:${entry.itemID}`;
      const reserved = persistence.acquireNpcJobReservation(job.jobID, {
        resourceKey,
        kind: "network-node-fuel",
        target: { itemID: entry.itemID, networkNodeID: nodeID, quantity: entry.quantity },
        ttlMs: 120_000,
        nowMs,
      });
      if (!reserved.success) {
        for (const key of reservedKeys) persistence.releaseNpcJobReservation(job.jobID, key);
        return maintenanceResult(
          behaviorRuntime.STATUS.SUSPENDED, "reserve-fuel", checkpoint, nowMs, reserved.errorMsg,
        );
      }
      reservedKeys.push(resourceKey);
    }
    const fueled = fuelRuntime.depositNpcNetworkNodeFuel(actor, nodeID, plan.data, {
      operationKey: `${MAINTENANCE_JOB_TYPE}:${job.jobID}:fuel`,
    });
    if (!fueled.success) return maintenanceResult(
      behaviorRuntime.STATUS.SUSPENDED, "fuel-retry", checkpoint, nowMs, fueled.errorMsg,
    );
    for (const key of reservedKeys) persistence.releaseNpcJobReservation(job.jobID, key);
    checkpoint.fuelReceipt = cloneValue(fueled.data);
    return { status: behaviorRuntime.STATUS.SUCCESS, step: "fuel-restored", checkpoint };
  }
  if (!checkpoint.loadSheddingApproval) return maintenanceResult(
    behaviorRuntime.STATUS.SUSPENDED,
    "awaiting-load-shedding-approval",
    { ...checkpoint, proposedPlan: cloneValue(payload.loadSheddingPlan) },
    nowMs,
    "NPC_LOAD_SHEDDING_APPROVAL_REQUIRED",
    60_000,
  );
  for (const assemblyID of checkpoint.loadSheddingApproval.assemblyIDs) {
    const changed = deploymentRuntime.requestNpcAssemblyState(
      actor, assemblyID, deploymentRuntime.ASSEMBLY_STATUS_OFFLINE, null,
    );
    if (!changed.success) return maintenanceResult(
      behaviorRuntime.STATUS.SUSPENDED, "load-shedding-retry", checkpoint, nowMs, changed.errorMsg,
    );
  }
  checkpoint.shedAssemblyIDs = cloneValue(checkpoint.loadSheddingApproval.assemblyIDs);
  return { status: behaviorRuntime.STATUS.SUCCESS, step: "load-shedding-complete", checkpoint };
}

function approveNpcNetworkNodeLoadShedding(jobID, input: Record<string, any> = {}) {
  const job = persistence.getNpcJob(jobID);
  if (!job || job.jobType !== MAINTENANCE_JOB_TYPE ||
      job.payload?.maintenanceKind !== "load-shedding" || job.status !== "suspended" ||
      job.step !== "awaiting-load-shedding-approval") {
    return { success: false, errorMsg: "NPC_LOAD_SHEDDING_REQUEST_NOT_FOUND" };
  }
  const recommended = new Set(
    (job.payload.loadSheddingPlan?.candidates || []).map((entry) => positiveInt(entry.assemblyID, 0)),
  );
  const assemblyIDs = [...new Set(
    (Array.isArray(input.assemblyIDs) ? input.assemblyIDs : []).map((value) => positiveInt(value, 0)).filter(Boolean),
  )];
  const reason = String(input.reason || "").trim();
  if (!reason || reason.length > 512 || assemblyIDs.length === 0 ||
      assemblyIDs.some((assemblyID) => !recommended.has(assemblyID))) {
    return { success: false, errorMsg: "NPC_LOAD_SHEDDING_APPROVAL_INVALID" };
  }
  return persistence.updateNpcJob(job.jobID, {
    status: "running",
    step: "execute-load-shedding",
    nextWakeAtMs: 0,
    lastError: null,
    checkpoint: {
      ...(job.checkpoint || {}),
      loadSheddingApproval: { assemblyIDs, reason, approvedAtMs: Date.now() },
    },
  }, { expectedRevision: job.recordRevision });
}

function registerNpcNetworkNodeMaintenanceJobHandler() {
  if (registered) return;
  behaviorRuntime.registerNpcJobHandler(MAINTENANCE_JOB_TYPE, tickNetworkNodeMaintenanceJob);
  registered = true;
}

module.exports = {
  SIGNAL_TYPE,
  MAINTENANCE_JOB_TYPE,
  buildLoadSheddingPlan,
  reconcileDependentJobs,
  reconcileNpcNetworkNodes,
  scheduleNpcNetworkNodeReconciliation,
  tickNetworkNodeMaintenanceJob,
  approveNpcNetworkNodeLoadShedding,
  registerNpcNetworkNodeMaintenanceJobHandler,
  _testing: {
    servicePriority,
    unresolvedMaintenanceKind,
    resetScheduler() {
      nextReconcileAtMs = 0;
      reconcilePromise = null;
    },
  },
};
