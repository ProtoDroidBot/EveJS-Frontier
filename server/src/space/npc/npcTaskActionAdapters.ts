"use strict";

/**
 * Opt-in Phase 6 bindings. Each mutation port performs one authoritative,
 * idempotent operation; this module never registers a live job handler.
 */
const nativeNpcStore = require("./nativeNpcStore");
const { getNpcPilotIdentityStore } = require("./npcPilotIdentityStore");
const { createNpcDecisionTreeScaffold } = require("./npcDecisionTreeScaffolds");
const { normalizeSuiAddress } = require("@mysten/sui/utils");

function positive(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function suspend(step: string, context: any, error: string, delayMs = 5_000) {
  return {
    status: "suspended",
    step,
    error,
    nextWakeAtMs: Math.max(0, Number(context?.nowMs) || Date.now()) + delayMs,
  };
}

function running(step: string, context: any, delayMs = 250) {
  return {
    status: "running",
    step,
    nextWakeAtMs: Math.max(0, Number(context?.nowMs) || Date.now()) + delayMs,
  };
}

function isResult(value: any) {
  return value && typeof value === "object" &&
    ["success", "failure", "running", "suspended"].includes(value.status);
}

function stepOutcome(value: any, step: string, context: any) {
  if (isResult(value)) return value;
  if (value?.success === true) return running(step, context);
  return suspend(step, context, String(value?.errorMsg || "NPC_TASK_STEP_NOT_COMMITTED"));
}

function mutationOutcome(value: any, step: string, context: any) {
  const result = stepOutcome(value, step, context);
  return result.status === "success" ? running(step, context) : result;
}

function createNpcTaskActionAdapters(ports: Record<string, any> = {}) {
  const entities = ports.nativeStore || nativeNpcStore;
  const pilots = ports.pilotStore || getNpcPilotIdentityStore();
  const capability = ports.capability || {};
  const plans = ports.plans || {};
  const fitting = ports.fitting || {};
  const navigation = ports.navigation || {};
  const ships = ports.ships || {};
  const support = ports.support || {};
  const dappControl = ports.dappControl || {};

  function actor(context: any) {
    const entityID = positive(context?.entity?.itemID || context?.entity?.entityID);
    const record = entityID && entities.getNativeEntity(entityID);
    const job = context?.job;
    if (!record || positive(record.categoryID) !== 6 || record.transient === true ||
        !job || positive(record.npcCharacterID) !== positive(job.npcCharacterID) ||
        positive(record.npcIncarnation) !== positive(job.incarnation)) return null;
    const pilot = pilots.get(positive(record.npcCharacterID));
    if (!pilot || positive(pilot.activeEntityID) !== entityID ||
        positive(pilot.incarnation) !== positive(record.npcIncarnation)) return null;
    return { entityID, record, pilot };
  }

  function factionWallet(current: any) {
    if (current?.pilot?.sui?.status !== "confirmed") return null;
    const raw = current.pilot.sui.walletAddress || current.pilot.sui.identity?.walletAddress;
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(raw)) return null;
    return normalizeSuiAddress(raw);
  }

  /** The dApp gateway must durably queue/reconcile this intent before returning confirmed. */
  function commandGate(context: any, actionName: string, stepID: string) {
    const current = actor(context);
    const walletAddress = factionWallet(current);
    const chainId = String(current?.pilot?.sui?.chainId || "");
    if (!current || !walletAddress || !String(current.pilot.factionKey || "") ||
        !/^[0-9a-f]{8}$/.test(chainId) ||
        typeof dappControl.ensureCommand !== "function") {
      return suspend("faction-command", context, "NPC_FACTION_DAPP_CONTROL_REQUIRED");
    }
    const intent = {
      intentID: `npc-task:${context.job.jobID}:${context.job.incarnation}:${actionName}:${stepID}`,
      jobID: String(context.job.jobID),
      incarnation: positive(context.job.incarnation),
      npcCharacterID: positive(current.pilot.characterID),
      factionKey: String(current.pilot.factionKey),
      chainId,
      walletAddress,
      action: actionName,
      stepID,
    };
    const result = dappControl.ensureCommand(context, intent);
    if (result?.status !== "confirmed") {
      return suspend("faction-command", context,
        String(result?.error || "NPC_FACTION_COMMAND_PENDING"), 1_000);
    }
    const receipt = result.receipt;
    const sender = typeof receipt?.senderAddress === "string" &&
      /^0x[0-9a-fA-F]{1,64}$/.test(receipt.senderAddress)
      ? normalizeSuiAddress(receipt.senderAddress) : null;
    const gasOwner = typeof receipt?.gasOwnerAddress === "string" &&
      /^0x[0-9a-fA-F]{1,64}$/.test(receipt.gasOwnerAddress)
      ? normalizeSuiAddress(receipt.gasOwnerAddress) : null;
    if (!receipt || receipt.intentID !== intent.intentID ||
        receipt.factionKey !== intent.factionKey ||
        receipt.chainId !== intent.chainId ||
        receipt.jobID !== intent.jobID ||
        positive(receipt.incarnation) !== intent.incarnation ||
        positive(receipt.npcCharacterID) !== intent.npcCharacterID ||
        receipt.action !== intent.action || receipt.stepID !== intent.stepID ||
        !String(receipt.transactionDigest || "").trim() ||
        sender !== walletAddress || gasOwner !== walletAddress ||
        receipt.sponsorAddress != null || receipt.sponsored === true ||
        ports.adminAddress && gasOwner === normalizeSuiAddress(ports.adminAddress)) {
      return suspend("faction-command", context, "NPC_FACTION_PAID_RECEIPT_REQUIRED");
    }
    return null;
  }

  function target(context: any) {
    const entityID = positive(context?.job?.payload?.targetEntityID);
    if (!entityID || !actor(context)) return null;
    const record = entities.getNativeEntity(entityID);
    if (!record || record.transient === true || ![6, 11].includes(positive(record.categoryID))) return null;
    if (positive(record.categoryID) === 6) {
      const targetPilot = pilots.get(positive(record.npcCharacterID));
      if (!targetPilot || positive(targetPilot.activeEntityID) !== entityID ||
          positive(targetPilot.incarnation) !== positive(record.npcIncarnation)) return null;
    }
    return { entityID, record };
  }

  function plan(context: any) {
    const selected = context?.job?.checkpoint?.taskCapabilityPlan;
    const current = actor(context);
    if (!current || !selected || !["refit", "swap", "support-fit"].includes(selected.kind) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(String(selected.planID || "")) ||
        String(selected.jobID || "") !== String(context.job.jobID || "") ||
        positive(selected.npcCharacterID) !== positive(current.pilot.characterID) ||
        positive(selected.incarnation) !== positive(context.job.incarnation) ||
        selected.kind !== "swap" && positive(selected.actorEntityID) !== current.entityID ||
        selected.kind === "swap" && ![
          positive(selected.actorEntityID), positive(selected.replacementEntityID),
        ].includes(current.entityID) ||
        selected.kind === "support-fit" &&
          positive(selected.targetEntityID) !== positive(context.job.payload?.targetEntityID) ||
        plans.isCurrent?.(context, current, selected) !== true) return null;
    return selected;
  }

  function selectPlan(context: any) {
    const current = actor(context);
    if (!current || !context?.job?.payload?.taskRequirement) {
      return suspend("task-plan", context, "NPC_TASK_ACTOR_OR_REQUIREMENT_INVALID");
    }
    if (plan(context)) return { status: "success" };
    const candidate = typeof plans.select === "function" ? plans.select(context, current) : null;
    if (!candidate || !["refit", "swap"].includes(candidate.kind) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(String(candidate.planID || ""))) {
      return suspend("task-plan", context, "NPC_TASK_EQUIPMENT_OR_HULL_UNAVAILABLE");
    }
    const selected = {
      ...candidate,
      jobID: String(context.job.jobID),
      npcCharacterID: positive(current.pilot.characterID),
      incarnation: positive(context.job.incarnation),
      actorEntityID: current.entityID,
    };
    const nextCheckpoint = { ...(context.job.checkpoint || {}), taskCapabilityPlan: selected };
    try {
      const write = typeof plans.save === "function"
        ? plans.save(context, nextCheckpoint)
        : context.persistence?.updateNpcJob(context.job.jobID, { checkpoint: nextCheckpoint }, {
          expectedRevision: context.job.recordRevision,
        });
      if (write?.success !== true || !write.data) {
        return suspend("task-plan", context, String(write?.errorMsg || "NPC_TASK_PLAN_NOT_DURABLE"));
      }
      context.job = write.data;
      return { status: "success" };
    } catch (error: any) {
      return suspend("task-plan", context, String(error?.message || "NPC_TASK_PLAN_NOT_DURABLE"));
    }
  }

  function service(context: any, subject: any) {
    const selected = plan(context);
    if (!selected || !subject || typeof fitting.resolveService !== "function" ||
        typeof fitting.authorizeService !== "function") return null;
    const destination = fitting.resolveService(context, actor(context), subject, selected);
    return destination && fitting.authorizeService(context, actor(context), subject,
      selected, destination) === true ? destination : null;
  }

  function fitState(context: any, subject: any) {
    const selected = plan(context);
    if (!selected || !subject || typeof fitting.getState !== "function") return "unknown";
    return fitting.getState(context, subject, selected);
  }

  function nextChange(context: any, subject: any) {
    const selected = plan(context);
    if (!selected || !subject || typeof fitting.nextChange !== "function") return null;
    return fitting.nextChange(context, subject, selected) || null;
  }

  function fitPreflight(context: any, subject: any) {
    const selected = plan(context);
    const destination = service(context, subject);
    return Boolean(selected && destination && typeof fitting.validate === "function" &&
      (subject.entityID === actor(context)?.entityID ||
        support.authorize?.(context, actor(context), subject, selected) === true) &&
      fitting.validate(context, actor(context), subject, selected, destination) === true);
  }

  function advanceToService(context: any, subject: any) {
    const destination = service(context, subject);
    if (!destination || typeof navigation.advanceToService !== "function") {
      return suspend("travel-fitting-service", context, "NPC_FITTING_SERVICE_UNAVAILABLE");
    }
    const result = stepOutcome(
      navigation.advanceToService(context, actor(context), subject, destination),
      "travel-fitting-service", context,
    );
    return result.status === "success" &&
      fitting.atService?.(context, actor(context), subject, destination) !== true
      ? running("travel-fitting-service", context) : result;
  }

  function applyOneFitChange(context: any, subject: any, prefix: string) {
    const selected = plan(context);
    const change = nextChange(context, subject);
    const destination = service(context, subject);
    if (!selected || !change || !String(change.stepID || "").trim() ||
        !fitPreflight(context, subject) ||
        typeof fitting.atService !== "function" ||
        fitting.atService(context, actor(context), subject, destination) !== true ||
        typeof fitting.applyOneChange !== "function") {
      return suspend("fit-one-change", context, "NPC_TASK_FIT_PREFLIGHT_FAILED");
    }
    const key = `${prefix}:${context.job.jobID}:${context.job.incarnation}:${selected.planID}:${change.stepID}`;
    const gate = commandGate(context, prefix, `${selected.planID}:${change.stepID}`);
    if (gate) return gate;
    return mutationOutcome(fitting.applyOneChange(context, actor(context), subject, selected, change, key),
      "fit-one-change", context);
  }

  function finishFit(context: any, subject: any, prefix: string) {
    const selected = plan(context);
    if (!selected || fitState(context, subject) !== "changes-committed" ||
        nextChange(context, subject) ||
        capability.canPerform?.(context, subject.entityID, context.job.payload.taskRequirement) !== true ||
        typeof fitting.complete !== "function") {
      return suspend("finish-fit", context, "NPC_TASK_FIT_NOT_READY");
    }
    const key = `${prefix}:${context.job.jobID}:${context.job.incarnation}:${selected.planID}:complete`;
    const gate = commandGate(context, `${prefix}.complete`, selected.planID);
    if (gate) return gate;
    return mutationOutcome(fitting.complete(context, actor(context), subject, selected, key),
      "finish-fit", context);
  }

  function swapState(context: any) {
    const selected = plan(context);
    return selected && typeof ships.getState === "function"
      ? ships.getState(context, actor(context), selected) : "unknown";
  }

  function replacement(context: any) {
    const selected = plan(context);
    return selected?.kind === "swap" && positive(selected.replacementEntityID)
      ? entities.getNativeEntity(positive(selected.replacementEntityID)) : null;
  }

  function wait(step: string, error: string) {
    return (context: any) => suspend(step, context, error);
  }

  const bindings: { guards: Record<string, (context: any) => boolean>;
    actions: Record<string, (context: any) => any> } = {
    guards: {
      isCategorySixPilot: (ctx) => Boolean(actor(ctx)),
      assignedTaskNeedsCapability: (ctx) => Boolean(ctx?.job?.payload?.taskRequirement),
      taskPreparationWakeDue: (ctx) => Number(ctx?.nowMs) >= Number(ctx?.job?.nextWakeAtMs || 0),
      currentShipCanPerformAssignedTask: (ctx) => Boolean(actor(ctx) &&
        capability.canPerform?.(ctx, actor(ctx).entityID, ctx.job.payload?.taskRequirement) === true),
      taskCapabilityPlanSettled: (ctx) => {
        if (!ctx?.job?.checkpoint?.taskCapabilityPlan) return true;
        const selected = plan(ctx);
        return selected?.kind === "refit" && fitState(ctx, actor(ctx)) === "complete" ||
          selected?.kind === "swap" && swapState(ctx) === "complete";
      },
      selectedRefitPlan: (ctx) => plan(ctx)?.kind === "refit",
      selectedShipSwapPlan: (ctx) => plan(ctx)?.kind === "swap",
      taskRefitCheckpointComplete: (ctx) => fitState(ctx, actor(ctx)) === "complete",
      taskRefitCheckpointPending: (ctx) => fitState(ctx, actor(ctx)) === "pending" ||
        fitState(ctx, actor(ctx)) === "changes-committed",
      authorizedFittingServiceAvailable: (ctx) => Boolean(service(ctx, actor(ctx))),
      currentlyAtAuthorizedFittingService: (ctx) => Boolean(service(ctx, actor(ctx)) &&
        fitting.atService?.(ctx, actor(ctx), actor(ctx), service(ctx, actor(ctx))) === true),
      taskFitItemsAndPolicyCurrent: (ctx) => fitPreflight(ctx, actor(ctx)),
      taskFitChangePending: (ctx) => Boolean(nextChange(ctx, actor(ctx))),
      taskFitChangesCommitted: (ctx) => fitState(ctx, actor(ctx)) === "changes-committed" &&
        !nextChange(ctx, actor(ctx)),
      taskShipSwapCheckpointComplete: (ctx) => swapState(ctx) === "complete",
      taskShipSwapCheckpointPending: (ctx) => swapState(ctx) === "pending",
      replacementShipAuthorizedAndStillEligible: (ctx) => Boolean(replacement(ctx) &&
        ships.validate?.(ctx, actor(ctx), replacement(ctx), plan(ctx)) === true),
      currentlyAtReplacementShip: (ctx) => Boolean(replacement(ctx) &&
        ships.atReplacement?.(ctx, actor(ctx), replacement(ctx), plan(ctx)) === true),
      assignedNpcFittingSupportJob: (ctx) => ctx?.job?.jobType === "npc.fit-support",
      npcFittingSupportWakeDue: (ctx) => Number(ctx?.nowMs) >= Number(ctx?.job?.nextWakeAtMs || 0),
      npcFittingSupportCheckpointComplete: (ctx) => fitState(ctx, target(ctx)) === "complete",
      npcFittingSupportCheckpointPending: (ctx) => ["pending", "changes-committed"]
        .includes(fitState(ctx, target(ctx))),
      targetNpcFittingPrincipalValid: (ctx) => Boolean(target(ctx)),
      npcToNpcFittingAuthorityCurrent: (ctx) => Boolean(target(ctx) &&
        support.authorize?.(ctx, actor(ctx), target(ctx), plan(ctx)) === true),
      authorizedSharedFittingServiceAvailable: (ctx) => Boolean(service(ctx, target(ctx))),
      actorAndTargetAtFittingService: (ctx) => Boolean(service(ctx, target(ctx)) &&
        fitting.atService?.(ctx, actor(ctx), target(ctx), service(ctx, target(ctx))) === true),
      targetFitItemsAndPolicyCurrent: (ctx) => fitPreflight(ctx, target(ctx)),
      targetFitChangePending: (ctx) => Boolean(nextChange(ctx, target(ctx))),
      targetFitChangesCommitted: (ctx) => fitState(ctx, target(ctx)) === "changes-committed" &&
        !nextChange(ctx, target(ctx)),
      targetNpcFitMeetsRequestedCapability: (ctx) => Boolean(target(ctx) &&
        capability.canPerform?.(ctx, target(ctx).entityID, ctx.job.payload?.taskRequirement) === true),
    },
    actions: {
      completeTaskReadiness: () => ({ status: "success" }),
      checkpointTaskCapabilityPlan: selectPlan,
      suspendTaskForEquipmentOrHull: wait("task-plan", "NPC_TASK_EQUIPMENT_OR_HULL_UNAVAILABLE"),
      advanceToFittingService: (ctx) => advanceToService(ctx, actor(ctx)),
      journalApplyNextTaskFitChange: (ctx) => applyOneFitChange(ctx, actor(ctx), "npc-self-fit"),
      journalCompleteTaskFit: (ctx) => finishFit(ctx, actor(ctx), "npc-self-fit"),
      suspendRefitForServiceItemsOrPolicy: wait("task-refit", "NPC_TASK_REFIT_BLOCKED"),
      advanceToReplacementShip: (ctx) => {
        const next = replacement(ctx);
        if (!next || ships.validate?.(ctx, actor(ctx), next, plan(ctx)) !== true ||
            typeof navigation.advanceToShip !== "function") {
          return suspend("travel-replacement-ship", ctx, "NPC_REPLACEMENT_SHIP_UNAVAILABLE");
        }
        const result = stepOutcome(navigation.advanceToShip(ctx, actor(ctx), next),
          "travel-replacement-ship", ctx);
        return result.status === "success" &&
          ships.atReplacement?.(ctx, actor(ctx), next, plan(ctx)) !== true
          ? running("travel-replacement-ship", ctx) : result;
      },
      journalTaskShipSwap: (ctx) => {
        const selected = plan(ctx);
        const next = replacement(ctx);
        if (!selected || !next || ships.validate?.(ctx, actor(ctx), next, selected) !== true ||
            ships.atReplacement?.(ctx, actor(ctx), next, selected) !== true ||
            typeof ships.commitSwap !== "function") {
          return suspend("task-swap", ctx, "NPC_TASK_SWAP_PREFLIGHT_FAILED");
        }
        const key = `npc-task-swap:${ctx.job.jobID}:${ctx.job.incarnation}:${selected.planID}`;
        const gate = commandGate(ctx, "npc-task-swap", selected.planID);
        if (gate) return gate;
        return mutationOutcome(ships.commitSwap(ctx, actor(ctx), next, selected, key), "task-swap", ctx);
      },
      suspendSwapForHullAccessOrTravel: wait("task-swap", "NPC_TASK_SWAP_BLOCKED"),
      advanceActorOrTargetToFittingService: (ctx) => advanceToService(ctx, target(ctx)),
      journalApplyNextTargetFitChange: (ctx) => applyOneFitChange(ctx, target(ctx), "npc-support-fit"),
      journalCompleteTargetFit: (ctx) => finishFit(ctx, target(ctx), "npc-support-fit"),
      suspendNpcFittingSupport: wait("npc-fitting-support", "NPC_FITTING_SUPPORT_BLOCKED"),
    },
  };

  const compiled = new Map<string, any>();
  function tick(treeName: string, context: any) {
    if (!["pilotTaskPreparation", "pilotTaskRefit", "pilotTaskShipSwap", "pilotNpcFittingSupport"]
      .includes(treeName)) throw new Error(`Unsupported NPC task action tree ${treeName}`);
    if (!actor(context)) return { status: "failure", error: "NPC_TASK_ACTOR_INVALID" };
    const gate = commandGate(context, "job.execute", "job");
    if (gate) return gate;
    let tree = compiled.get(treeName);
    if (!tree) {
      tree = createNpcDecisionTreeScaffold(treeName, bindings);
      compiled.set(treeName, tree);
    }
    return tree.tick(context);
  }
  bindings.actions.runTaskRefitTree = (ctx) => tick("pilotTaskRefit", ctx);
  bindings.actions.runTaskShipSwapTree = (ctx) => tick("pilotTaskShipSwap", ctx);

  return { bindings, tick };
}

module.exports = { createNpcTaskActionAdapters };
