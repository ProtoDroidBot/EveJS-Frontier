"use strict";

import { createHash } from "node:crypto";

const nativeNpcStore = require("./nativeNpcStore");
const persistence = require("./npcRuntimePersistence");
const npcFitting = require("./npcFittingService");
const { getControllerByEntityID } = require("./npcRegistry");
const {
  STATUS,
  eventInbox,
  registerNpcJobHandler,
} = require("./npcBehaviorTreeRuntime");

const SUPPORT_JOB_TYPE = "support.respond";
const DEFAULT_INCIDENT_TTL_MS = 120_000;
const DEFAULT_GROUP_COOLDOWN_MS = 60_000;
const DEFAULT_RESPONSE_RADIUS_METERS = 250_000;
const DEFAULT_MISSING_THREAT_GRACE_MS = 5_000;
const MAX_RESPONDERS = 64;
const ACTIVE_JOB_STATUSES = ["queued", "running", "suspended"];

function cloneValue<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value: unknown, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function finiteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePosition(value: any) {
  return {
    x: finiteNumber(value && value.x, 0),
    y: finiteNumber(value && value.y, 0),
    z: finiteNumber(value && value.z, 0),
  };
}

function distanceBetween(left: any, right: any) {
  const a = normalizePosition(left);
  const b = normalizePosition(right);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalizeRoles(value: any, fallback: string[] = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source
    .map((role) => String(role || "").trim().toLowerCase())
    .filter((role) => /^[a-z][a-z0-9_-]{0,63}$/u.test(role)))];
}

function resolveFactionKey(entityRecord: any) {
  return String(
    entityRecord && (
      entityRecord.npcFactionIdentityKey ||
      entityRecord.factionKey ||
      (entityRecord.warFactionID
        ? `${positiveInt(entityRecord.warFactionID, 0)}-${String(entityRecord.npcFactionKey || "none").trim().toLowerCase() || "none"}`
        : "")
    ) || "",
  ).trim().toLowerCase();
}

function stableIncidentDeduplicationID(input: Record<string, any>) {
  return createHash("sha256").update(JSON.stringify([
    String(input.factionKey || ""),
    positiveInt(input.requestingNpcCharacterID, 0),
    positiveInt(input.threatTargetID, 0),
    positiveInt(input.systemID, 0),
    String(input.supportGroupID || ""),
  ])).digest("hex");
}

function resolveDefaultAuthorization(requester: any) {
  const factionKey = resolveFactionKey(requester);
  const npcCharacterID = positiveInt(requester && requester.npcCharacterID, 0);
  if (!factionKey || factionKey === "0-none" || !npcCharacterID) {
    return { success: false, errorMsg: "NPC_SUPPORT_FACTION_IDENTITY_REQUIRED" };
  }
  return {
    success: true,
    data: {
      authorized: true,
      source: "npc-faction-identity",
      factionKey,
      npcCharacterID,
      incarnation: positiveInt(requester.npcIncarnation, 0),
      // Public object metadata may be retained for audit. No transponder code,
      // salt, wallet seed, receipt token, or other secret enters this record.
      commitmentID: requester.npcSuiTransponderCommitmentID || null,
    },
  };
}

function resolveResponderRoles(entityRecord: any) {
  const roles = new Set<string>();
  try {
    for (const equipment of npcFitting.listNpcEquipment(entityRecord.entityID)) {
      const role = String(equipment && equipment.semanticRole || "").trim().toLowerCase();
      if (!role || equipment.usable !== true) continue;
      roles.add(role);
      if (role === "weapon") roles.add("combat");
      if (role === "remote_repair") roles.add("logistics");
      if (role === "hostile_utility") roles.add("tackle");
      if (role === "scanner") roles.add("scout");
      if (role === "jump_drive") roles.add("travel");
    }
  } catch (_error) {
    for (const moduleRecord of nativeNpcStore.listNativeModulesForEntity(entityRecord.entityID)) {
      const role = String(
        moduleRecord.semanticRole || npcFitting.classifyNpcEquipment(moduleRecord) || "",
      ).trim().toLowerCase();
      if (!role || moduleRecord.moduleState && moduleRecord.moduleState.online === false) continue;
      roles.add(role);
      if (role === "weapon") roles.add("combat");
      if (role === "remote_repair") roles.add("logistics");
      if (role === "hostile_utility") roles.add("tackle");
      if (role === "scanner") roles.add("scout");
      if (role === "jump_drive") roles.add("travel");
    }
  }
  const authoredRole = String(entityRecord.behaviorRole || "").trim().toLowerCase();
  if (authoredRole) roles.add(authoredRole);
  return [...roles].sort();
}

function isCapableForRequiredRoles(roles: string[], requiredRoles: string[]) {
  return requiredRoles.length === 0 || requiredRoles.includes("any") ||
    requiredRoles.some((required) => roles.includes(required));
}

type SupportCoordinatorDependencies = {
  nativeStore?: any;
  persistence?: any;
  getController?: (entityID: number) => any;
  authorizeRequester?: (requester: any, input: Record<string, any>) => any;
  resolveRoles?: (entityRecord: any) => string[];
  spawnReserve?: (incident: any, count: number, runtime: Record<string, any>) => any;
};

class NpcSupportCoordinator {
  dependencies: Record<string, any>;

  constructor(dependencies: SupportCoordinatorDependencies = {}) {
    this.dependencies = {
      nativeStore: dependencies.nativeStore || nativeNpcStore,
      persistence: dependencies.persistence || persistence,
      getController: dependencies.getController || getControllerByEntityID,
      authorizeRequester: dependencies.authorizeRequester || resolveDefaultAuthorization,
      resolveRoles: dependencies.resolveRoles || resolveResponderRoles,
      spawnReserve: dependencies.spawnReserve || null,
    };
  }

  resolveRuntimeEntity(scene: any, entityRecord: any) {
    return scene && typeof scene.getEntityByID === "function"
      ? scene.getEntityByID(positiveInt(entityRecord && entityRecord.entityID, 0))
      : null;
  }

  buildCandidates(incident: any, runtime: Record<string, any> = {}) {
    const requiredRoles = normalizeRoles(incident.requiredRoles, ["combat"]);
    const responseRadiusMeters = Math.max(
      0,
      finiteNumber(incident.policy && incident.policy.responseRadiusMeters, DEFAULT_RESPONSE_RADIUS_METERS),
    );
    const assignedCharacterIDs = new Set(
      (incident.responderAssignments || [])
        .filter((assignment) => ["assigned", "engaging"].includes(String(assignment.status)))
        .map((assignment) => assignment.npcCharacterID),
    );
    const scene = runtime.scene || null;
    const candidates: any[] = [];
    for (const entityRecord of this.dependencies.nativeStore.listNativeEntities()) {
      const npcCharacterID = positiveInt(entityRecord && entityRecord.npcCharacterID, 0);
      const incarnation = positiveInt(entityRecord && entityRecord.npcIncarnation, 0);
      const entityID = positiveInt(entityRecord && entityRecord.entityID, 0);
      if (!npcCharacterID || !incarnation || !entityID || entityRecord.transient === true ||
          npcCharacterID === incident.requestingNpcCharacterID ||
          assignedCharacterIDs.has(npcCharacterID) ||
          resolveFactionKey(entityRecord) !== incident.factionKey ||
          this.dependencies.persistence.isNpcEntityQuarantined(entityID)) {
        continue;
      }
      const roles = normalizeRoles(this.dependencies.resolveRoles(entityRecord));
      if (!isCapableForRequiredRoles(roles, requiredRoles)) continue;
      const responderSystemID = positiveInt(entityRecord.systemID, 0);
      const sameSystem = responderSystemID === incident.systemID;
      const liveEntity = sameSystem ? this.resolveRuntimeEntity(scene, entityRecord) : null;
      const responderPosition = liveEntity && liveEntity.position || entityRecord.position;
      const distanceMeters = sameSystem
        ? distanceBetween(responderPosition, incident.position)
        : Number.POSITIVE_INFINITY;
      const activeJob = this.dependencies.persistence.getActiveNpcJob(npcCharacterID, incarnation);
      let dispatchTier = "cross-system";
      let tier = 2;
      if (sameSystem && distanceMeters <= responseRadiusMeters) {
        dispatchTier = "nearby";
        tier = 0;
      } else if (sameSystem && !activeJob) {
        dispatchTier = "same-system-reserve";
        tier = 1;
      } else if (sameSystem) {
        dispatchTier = "same-system";
        tier = 1;
      } else {
        if (incident.policy && incident.policy.allowCrossSystemResponders === false) continue;
        const canTravel = roles.includes("jump_drive") || roles.includes("travel") ||
          runtime.canTravel && runtime.canTravel(entityRecord, incident) === true;
        if (!canTravel) continue;
      }
      candidates.push({
        entityRecord,
        roles,
        activeJob,
        dispatchTier,
        tier,
        distanceMeters,
      });
    }
    return candidates.sort((left, right) =>
      left.tier - right.tier ||
      left.distanceMeters - right.distanceMeters ||
      Number(Boolean(left.activeJob)) - Number(Boolean(right.activeJob)) ||
      left.entityRecord.entityID - right.entityRecord.entityID);
  }

  wakeAssignedResponder(assignment: any, incident: any, runtime: Record<string, any> = {}) {
    const controller = this.dependencies.getController(assignment.responderEntityID);
    if (controller) {
      if (positiveInt(controller.systemID, 0) === incident.systemID && incident.threatTargetID) {
        controller.preferredTargetID = incident.threatTargetID;
        controller.lastAggressorID = incident.threatTargetID;
        controller.lastAggressedAtMs = finiteNumber(runtime.nowMs, Date.now());
        if (String(controller.runtimeKind || "").trim() === "nativeAmbient") {
          controller.runtimeKind = "nativeCombat";
        }
      }
      controller.nextThinkAtMs = 0;
    }
    eventInbox.publish(
      assignment.npcCharacterID,
      "support-assigned",
      {
        incidentID: incident.incidentID,
        requesterEntityID: incident.requesterEntityID,
        threatTargetID: incident.threatTargetID,
        systemID: incident.systemID,
      },
      { eventID: `support:${incident.incidentID}:${assignment.npcCharacterID}` },
    );
  }

  assignAvailableResponders(incidentInput: any, runtime: Record<string, any> = {}) {
    let incident = this.dependencies.persistence.getNpcSupportIncident(incidentInput.incidentID) || incidentInput;
    const assignments: any[] = [];
    for (const candidate of this.buildCandidates(incident, runtime)) {
      if ((incident.responderAssignments || []).filter((assignment) =>
        ["assigned", "engaging"].includes(String(assignment.status)),
      ).length >= incident.maximumResponderCount) break;
      const record = candidate.entityRecord;
      const result = this.dependencies.persistence.assignNpcSupportResponder(incident.incidentID, {
        npcCharacterID: record.npcCharacterID,
        incarnation: record.npcIncarnation,
        responderEntityID: record.entityID,
        responderSystemID: record.systemID,
        factionKey: incident.factionKey,
        roles: candidate.roles,
        dispatchTier: candidate.dispatchTier,
        nowMs: runtime.nowMs,
      });
      if (!result || result.success !== true || !result.data) continue;
      assignments.push(result.data);
      this.wakeAssignedResponder(result.data, incident, runtime);
      incident = this.dependencies.persistence.getNpcSupportIncident(incident.incidentID) || incident;
    }
    return { incident, assignments };
  }

  spawnReserveResponders(incident: any, count: number, runtime: Record<string, any> = {}) {
    if (count <= 0 || incident.policy && incident.policy.allowReserveSpawn !== true) return [];
    if (typeof this.dependencies.spawnReserve === "function") {
      const result = this.dependencies.spawnReserve(incident, count, runtime);
      return Array.isArray(result) ? result : result && result.data || [];
    }
    const scene = runtime.scene;
    if (!scene) return [];
    const nativeNpcService = require("./nativeNpcService");
    const threatEntity = typeof scene.getEntityByID === "function"
      ? scene.getEntityByID(positiveInt(incident.threatTargetID, 0))
      : null;
    const spawnOptions = {
      transient: false,
      operatorKind: "npc-support-coordinator",
      preferredTargetID: positiveInt(incident.threatTargetID, 0),
      runtimeKind: "nativeCombat",
      npcIdentitySlot: `support:${incident.incidentID}`,
      skipInitialBehaviorTick: true,
      spawnDistanceMeters: Math.max(5_000, finiteNumber(incident.policy.reserveSpawnDistanceMeters, 35_000)),
      selectionKind: "support-reserve",
      selectionID: incident.incidentID,
      selectionName: "Faction Support Reserve",
      anchorKind: "ship",
      anchorName: String(threatEntity && threatEntity.itemName || "Distress target"),
      anchorID: positiveInt(incident.threatTargetID, 0),
    };
    if (Array.isArray(runtime.reserveDefinitions) && runtime.reserveDefinitions.length > 0) {
      const result = nativeNpcService.spawnNativeDefinitionsInContext(
        {
          systemID: incident.systemID,
          scene,
          anchorEntity: threatEntity,
          preferredTargetID: incident.threatTargetID,
          anchorKind: "ship",
          anchorLabel: spawnOptions.anchorName,
        },
        {
          data: {
            selectionKind: "support-reserve",
            selectionID: incident.incidentID,
            selectionName: "Faction Support Reserve",
            definitions: cloneValue(runtime.reserveDefinitions.slice(0, count)),
          },
          suggestions: [],
        },
        spawnOptions,
      );
      return result && result.success && result.data && Array.isArray(result.data.spawned)
        ? result.data.spawned
        : [];
    }
    const profileID = String(incident.policy.reserveProfileID || "").trim();
    if (!profileID) return [];
    const spawned: any[] = [];
    for (let index = 0; index < count; index += 1) {
      const result = nativeNpcService.spawnNativeNpcEntityInSystem(incident.systemID, {
        ...spawnOptions,
        profileQuery: profileID,
        npcIdentitySlot: `${spawnOptions.npcIdentitySlot}:member:${index}`,
      });
      if (result && result.success && result.data) spawned.push(result.data);
    }
    return spawned;
  }

  dispatchIncident(incidentInput: any, runtime: Record<string, any> = {}) {
    let dispatch = this.assignAvailableResponders(incidentInput, runtime);
    let incident = dispatch.incident;
    const assignments = [...dispatch.assignments];
    const maximumReserveSpawn = Math.max(
      0,
      Math.min(
        incident.maximumResponderCount,
        positiveInt(incident.policy && incident.policy.maximumReserveSpawn, incident.maximumResponderCount),
      ),
    );
    const remaining = Math.max(
      0,
      incident.maximumResponderCount - (incident.responderAssignments || []).filter((assignment) =>
        ["assigned", "engaging"].includes(String(assignment.status)),
      ).length,
    );
    const reserveCount = Math.min(remaining, maximumReserveSpawn);
    const spawned = this.spawnReserveResponders(incident, reserveCount, runtime);
    if (spawned.length > 0) {
      dispatch = this.assignAvailableResponders(incident, runtime);
      incident = dispatch.incident;
      assignments.push(...dispatch.assignments);
    }
    return {
      incident,
      assignments,
      spawnedCount: spawned.length,
    };
  }

  requestSupport(input: Record<string, any>) {
    const requesterEntityID = positiveInt(input && input.requesterEntityID, 0);
    const requester = this.dependencies.nativeStore.getNativeEntity(requesterEntityID);
    if (!requester || requester.transient === true ||
        !positiveInt(requester.npcCharacterID, 0) || !positiveInt(requester.npcIncarnation, 0)) {
      return { success: false, errorMsg: "NPC_SUPPORT_DURABLE_REQUESTER_REQUIRED" };
    }
    const authorization = this.dependencies.authorizeRequester(requester, input);
    if (!authorization || authorization.success !== true || !authorization.data ||
        authorization.data.authorized !== true) {
      return {
        success: false,
        errorMsg: authorization && authorization.errorMsg || "NPC_SUPPORT_AUTHORIZATION_REQUIRED",
      };
    }
    const factionKey = resolveFactionKey(requester);
    if (String(authorization.data.factionKey || "").trim().toLowerCase() !== factionKey) {
      return { success: false, errorMsg: "NPC_SUPPORT_AUTHORIZATION_FACTION_MISMATCH" };
    }
    const nowMs = Number.isFinite(Number(input.nowMs)) ? Math.max(0, Number(input.nowMs)) : Date.now();
    const systemID = positiveInt(input.systemID, positiveInt(requester.systemID, 0));
    const scene = input.scene || null;
    const liveRequester = this.resolveRuntimeEntity(scene, requester);
    const supportGroupID = String(input.supportGroupID || factionKey).trim().toLowerCase();
    const policy = {
      responseRadiusMeters: Math.max(0, finiteNumber(input.responseRadiusMeters, DEFAULT_RESPONSE_RADIUS_METERS)),
      allowCrossSystemResponders: input.allowCrossSystemResponders !== false,
      allowReserveSpawn: input.allowReserveSpawn === true,
      maximumReserveSpawn: Math.max(0, Math.min(MAX_RESPONDERS, positiveInt(input.maximumReserveSpawn, 0))),
      reserveProfileID: String(input.reserveProfileID || "").trim() || null,
      reserveSpawnDistanceMeters: Math.max(5_000, finiteNumber(input.reserveSpawnDistanceMeters, 35_000)),
    };
    const deduplicationID = String(input.deduplicationID || stableIncidentDeduplicationID({
      factionKey,
      requestingNpcCharacterID: requester.npcCharacterID,
      threatTargetID: input.threatTargetID,
      systemID,
      supportGroupID,
    })).trim().toLowerCase();
    const persisted = this.dependencies.persistence.createOrGetNpcSupportIncident({
      requestingNpcCharacterID: requester.npcCharacterID,
      requestingNpcIncarnation: requester.npcIncarnation,
      requesterEntityID,
      factionKey,
      threatTargetID: positiveInt(input.threatTargetID, 0) || null,
      threatOwnerID: positiveInt(input.threatOwnerID, 0) || null,
      severity: String(input.severity || "moderate").trim().toLowerCase(),
      requiredRoles: normalizeRoles(input.requiredRoles, ["combat"]),
      systemID,
      position: normalizePosition(input.position || liveRequester && liveRequester.position || requester.position),
      supportGroupID,
      authorization: authorization.data,
      policy,
      maximumResponderCount: Math.max(1, Math.min(MAX_RESPONDERS, positiveInt(input.maximumResponderCount, 3))),
      deduplicationID,
      ttlMs: Math.max(1_000, finiteNumber(input.ttlMs, DEFAULT_INCIDENT_TTL_MS)),
      cooldownMs: Math.max(1_000, finiteNumber(input.cooldownMs, DEFAULT_GROUP_COOLDOWN_MS)),
      nowMs,
    });
    if (!persisted || persisted.success !== true || !persisted.data) return persisted;
    const dispatched = this.dispatchIncident(persisted.data.incident, {
      scene,
      nowMs,
      reserveDefinitions: cloneValue(
        (Array.isArray(input.reserveDefinitions) ? input.reserveDefinitions : [])
          .filter(definition => definition?.profile &&
            require("../../config/npcFactionConfig").isNpcFactionSdeTypeAllowed(
              requester, "reinforcement",
              positiveInt(definition.profile.shipTypeID ?? definition.profile.typeID, 0),
            )),
      ),
      canTravel: input.canTravel,
    });
    return {
      success: true,
      data: {
        incident: dispatched.incident,
        created: persisted.data.created === true,
        assignments: dispatched.assignments,
        spawnedCount: dispatched.spawnedCount,
      },
    };
  }

  resolveIncident(incidentID: string, resolution = "resolved", nowMs = Date.now()) {
    const incident = this.dependencies.persistence.getNpcSupportIncident(incidentID);
    if (!incident) return { success: false, errorMsg: "NPC_SUPPORT_INCIDENT_NOT_FOUND" };
    if (incident.status !== "active") return { success: true, data: incident };
    return this.dependencies.persistence.updateNpcSupportIncident(incident.incidentID, {
      status: resolution === "cancelled" ? "cancelled" : "resolved",
      resolution: String(resolution || "resolved"),
    }, { expectedRevision: incident.recordRevision, nowMs });
  }
}

function tickNpcSupportJob(context: Record<string, any>) {
  const job = context.job;
  let incident = persistence.getNpcSupportIncident(job.payload && job.payload.incidentID);
  if (!incident) {
    persistence.settleNpcSupportAssignment(job.jobID, {
      outcome: "failed",
      error: "NPC_SUPPORT_INCIDENT_NOT_FOUND",
      nowMs: context.nowMs,
    });
    return { status: STATUS.FAILURE, step: "incident-missing", error: "NPC_SUPPORT_INCIDENT_NOT_FOUND" };
  }
  if (incident.status === "active" && context.nowMs >= Number(incident.expiresAtMs)) {
    persistence.updateNpcSupportIncident(incident.incidentID, {
      status: "expired",
      resolution: "expired",
    }, { expectedRevision: incident.recordRevision, nowMs: context.nowMs });
    incident = persistence.getNpcSupportIncident(incident.incidentID);
  }
  if (incident.status !== "active") {
    persistence.settleNpcSupportAssignment(job.jobID, {
      outcome: incident.status === "cancelled" ? "cancelled" : "completed",
      step: `incident-${incident.status}`,
      nowMs: context.nowMs,
    });
    return { status: STATUS.SUCCESS, step: `incident-${incident.status}` };
  }
  const currentSystemID = positiveInt(context.entity && context.entity.systemID, 0);
  if (currentSystemID !== positiveInt(incident.systemID, 0)) {
    return require("./npcTravelService").advanceNpcTravel(context, incident.systemID);
  }
  const threat = context.scene && typeof context.scene.getEntityByID === "function"
    ? context.scene.getEntityByID(positiveInt(incident.threatTargetID, 0))
    : null;
  if (!threat) {
    const missingSinceMs = positiveInt(job.checkpoint && job.checkpoint.threatMissingSinceMs, 0) || context.nowMs;
    const graceMs = Math.max(
      1_000,
      finiteNumber(incident.policy && incident.policy.missingThreatGraceMs, DEFAULT_MISSING_THREAT_GRACE_MS),
    );
    if (context.nowMs - missingSinceMs >= graceMs) {
      const latest = persistence.getNpcSupportIncident(incident.incidentID);
      if (latest && latest.status === "active") {
        persistence.updateNpcSupportIncident(latest.incidentID, {
          status: "resolved",
          resolution: "threat-unavailable",
        }, { expectedRevision: latest.recordRevision, nowMs: context.nowMs });
      }
      persistence.settleNpcSupportAssignment(job.jobID, {
        outcome: "completed",
        step: "threat-unavailable",
        nowMs: context.nowMs,
      });
      return { status: STATUS.SUCCESS, step: "threat-unavailable" };
    }
    return {
      status: STATUS.SUSPENDED,
      step: "locate-threat",
      checkpoint: { ...(job.checkpoint || {}), threatMissingSinceMs: missingSinceMs },
      nextWakeAtMs: context.nowMs + 1_000,
    };
  }
  context.controller.preferredTargetID = positiveInt(threat.itemID, 0);
  context.controller.lastAggressorID = positiveInt(threat.itemID, 0);
  context.controller.lastAggressedAtMs = context.nowMs;
  context.controller.nextThinkAtMs = 0;
  if (String(context.controller.runtimeKind || "").trim() === "nativeAmbient") {
    context.controller.runtimeKind = "nativeCombat";
  }
  return {
    status: STATUS.RUNNING,
    step: "engaging",
    checkpoint: {
      ...(job.checkpoint || {}),
      threatMissingSinceMs: 0,
      lastEngagedAtMs: context.nowMs,
      threatTargetID: positiveInt(threat.itemID, 0),
    },
    nextWakeAtMs: context.nowMs + 1_000,
  };
}

let handlersRegistered = false;
function registerNpcSupportJobHandlers() {
  if (handlersRegistered) return false;
  registerNpcJobHandler(SUPPORT_JOB_TYPE, tickNpcSupportJob);
  handlersRegistered = true;
  return true;
}

const defaultCoordinator = new NpcSupportCoordinator();

function requestNpcSupport(input: Record<string, any>) {
  return defaultCoordinator.requestSupport(input);
}

function resolveNpcSupportIncident(incidentID: string, resolution?: string, nowMs?: number) {
  return defaultCoordinator.resolveIncident(incidentID, resolution, nowMs);
}

module.exports = {
  SUPPORT_JOB_TYPE,
  NpcSupportCoordinator,
  defaultCoordinator,
  requestNpcSupport,
  resolveNpcSupportIncident,
  resolveResponderRoles,
  registerNpcSupportJobHandlers,
  tickNpcSupportJob,
  _testing: {
    stableIncidentDeduplicationID,
    resolveFactionKey,
    isCapableForRequiredRoles,
    distanceBetween,
  },
};
