"use strict";

/**
 * Proposed Phase 6 decisions, not registered with the live NPC behavior loop.
 * Callers must supply every authoritative guard and action explicitly. A tree
 * definition never grants trust, creates a pilot, moves inventory, or destroys
 * a ship by itself. Action names are stable adapter keys for future
 * authenticated on-chain command/receipt flows; no chain writes happen here.
 */

type DecisionNode = Readonly<{
  kind: "selector" | "sequence" | "guard" | "action";
  name: string;
  children?: readonly DecisionNode[];
}>;

type DecisionBindings = {
  guards: Record<string, (context: any) => boolean>;
  actions: Record<string, (context: any) => DecisionActionResult>;
};

type DecisionActionResult = {
  status: "success" | "failure" | "running" | "suspended";
  handled?: boolean;
  step?: string;
  nextWakeAtMs?: number;
  error?: string | null;
  checkpoint?: Record<string, any>;
};

const NPC_DECISION_STATUS = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure",
  RUNNING: "running",
  SUSPENDED: "suspended",
});

function requireDecisionActionResult(name: string, result: any): DecisionActionResult {
  const status = result && result.status;
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      (status !== NPC_DECISION_STATUS.SUCCESS &&
       status !== NPC_DECISION_STATUS.FAILURE &&
       status !== NPC_DECISION_STATUS.RUNNING &&
       status !== NPC_DECISION_STATUS.SUSPENDED)) {
    throw new Error(`NPC decision action ${name} must return a Phase 0 behavior result`);
  }
  return result;
}

type DecisionPrimitives = {
  selector: (name: string, children: any[]) => any;
  sequence: (name: string, children: any[]) => any;
  condition: (name: string, predicate: (context: any) => boolean) => any;
  action: (name: string, handler: (context: any) => any) => any;
};

function branch(kind: "selector" | "sequence", name: string, ...children: DecisionNode[]): DecisionNode {
  return Object.freeze({ kind, name, children: Object.freeze(children) });
}

function guard(name: string): DecisionNode {
  return Object.freeze({ kind: "guard", name });
}

function action(name: string): DecisionNode {
  return Object.freeze({ kind: "action", name });
}

function durableStep(name: string, completedGuard: string, actionName: string): DecisionNode {
  return branch("selector", name, guard(completedGuard), action(actionName));
}

const pilotWork = branch("sequence", "pilot-assigned-work",
  guard("isCategorySixPilot"),
  guard("durableJobReady"),
  branch("selector", "work-type",
    branch("sequence", "gather-resources",
      guard("assignedResourceGatheringJob"),
      action("runResourceGatheringTree"),
    ),
    branch("sequence", "deploy-structure",
      guard("assignedStructureJob"),
      branch("selector", "placement",
        branch("sequence", "site-placement-authorized",
          guard("playerPlacementRulesSatisfied"),
          guard("constructionToolAndAccessReady"),
          action("journalConstructionSitePlacement"),
          branch("selector", "site-fulfilment",
            branch("sequence", "realize-funded-site",
              guard("constructionMaterialsFulfilled"),
              action("journalRealizeStructure"),
            ),
            action("requestOrHaulBuildMaterials"),
          ),
        ),
        action("suspendStructureForPlacementOrTools"),
      ),
    ),
    branch("sequence", "manufacture",
      guard("assignedManufacturingJob"),
      branch("selector", "industry-readiness",
        branch("sequence", "run-authorized-lane",
          guard("industryLaneInputsAndAccessReady"),
          action("journalManufacturingJob"),
        ),
        action("suspendManufacturingForInputsOrAccess"),
      ),
    ),
    branch("sequence", "haul-resources",
      guard("assignedHaulJob"),
      branch("selector", "haul-readiness",
        branch("sequence", "move-custodied-cargo",
          guard("cargoRouteAndCustodyValid"),
          action("journalHaulCycle"),
        ),
        action("replanHaul"),
      ),
    ),
    branch("sequence", "refit-ship",
      guard("assignedRefitJob"),
      branch("selector", "fitting-readiness",
        branch("sequence", "fit-authorized-items",
          guard("fittingTrustAndCompatibleItemsReady"),
          action("journalShipRefit"),
        ),
        action("suspendRefitAndRequestItems"),
      ),
    ),
    branch("sequence", "swap-ship",
      guard("assignedShipSwapJob"),
      branch("selector", "swap-readiness",
        branch("sequence", "use-lifecycle-transition",
          guard("shipSwapAuthorized"),
          action("runPilotShipLifecycle"),
        ),
        action("suspendShipSwap"),
      ),
    ),
    branch("sequence", "refuel-another-ship",
      guard("assignedAllyRefuelJob"),
      branch("selector", "refuel-target",
        branch("sequence", "valid-friendly-target",
          guard("targetShipFriendlyAndNeedsFuel"),
          branch("selector", "fuel-delivery-method",
            branch("sequence", "creation-transfuser",
              guard("compatibleTransfuserLockedInRangeAndFueled"),
              action("transferFuelWithTransfuser"),
            ),
            branch("sequence", "drop-physical-fuel",
              guard("fuelDropAndRecipientPickupAuthorized"),
              action("journalFuelDropForPickup"),
            ),
            action("suspendRefuelForToolsFuelOrAccess"),
          ),
        ),
        action("suspendRefuelForTargetOrPermission"),
      ),
    ),
    branch("sequence", "scout-system",
      guard("assignedScoutingJob"),
      action("runScoutingTree"),
    ),
    branch("sequence", "transit-between-systems",
      guard("assignedSystemTransitJob"),
      action("runSystemTransitTree"),
    ),
    branch("sequence", "other-registered-job",
      guard("assignedOtherDurableJob"),
      action("tickOtherDurableJob"),
    ),
    action("suspendUnclassifiedDurableJob"),
  ),
);

const pilotResourceGathering = branch("sequence", "pilot-resource-gathering",
  guard("isCategorySixPilot"),
  guard("assignedResourceGatheringJob"),
  guard("resourceJobWakeDue"),
  branch("selector", "resource-progress",
    branch("sequence", "gather-store-and-offer",
      durableStep("reserve-source", "resourceReservationCheckpointComplete", "reserveResourceTarget"),
      branch("selector", "extract-or-resume",
        guard("resourceExtractionCheckpointComplete"),
        branch("selector", "resource-source-adapter",
          branch("sequence", "asteroid-or-compatible-wreckage",
            guard("sourceUsesAsteroidMiningLoop"),
            guard("compatibleMiningToolAndChargeReady"),
            action("extractMiningSourceStep"),
          ),
          branch("sequence", "crude-rift",
            guard("sourceIsCrudeRift"),
            guard("crudeExtractorAndLensReady"),
            action("extractCrudeRiftStep"),
          ),
        ),
      ),
      durableStep("checkpoint-cargo", "resourceCargoCheckpointComplete", "checkpointResourceYieldAndCargo"),
      durableStep("deliver-to-storage", "resourceDeliveryCheckpointComplete", "advanceResourceDeliveryToStorage"),
      durableStep("offer-for-use", "resourceOfferCheckpointComplete", "releaseResourceForAuthorizedUse"),
    ),
    action("suspendResourceForSourceOrTool"),
  ),
);

const pilotPriority = branch("sequence", "pilot-priority",
  guard("isCategorySixPilot"),
  branch("selector", "pilot-work",
    branch("sequence", "survive", guard("immediateDanger"), action("handleEmergency")),
    branch("sequence", "manual-order", guard("authorizedManualOrder"), action("executeManualOrder")),
    branch("sequence", "combat", guard("confirmedHostileThreat"), action("fightOrEvade")),
    branch("sequence", "stranded", guard("fuelStrandingRisk"), action("runStrandingTree")),
    branch("sequence", "site-assignment", guard("activeSiteAssignment"), action("continueSiteAssignment")),
    pilotWork,
    branch("sequence", "unexpected-warp-discovery",
      guard("unexpectedWarpDiscoveryPending"),
      action("runOpportunisticDiscoveryTree"),
    ),
    action("patrolOrIdle"),
  ),
);

const factionSiteResponse = branch("sequence", "faction-site-response",
  guard("isNewFactionSiteEvent"),
  guard("siteStillOwnedByFaction"),
  guard("siteResponseOpen"),
  action("reserveSiteResponse"),
  branch("selector", "site-role-priority",
    branch("sequence", "defend", guard("siteUnderThreat"), action("assignDefenders")),
    branch("sequence", "build", guard("siteNeedsInfrastructure"), action("assignBuilders")),
    branch("sequence", "work", guard("siteHasResourceWork"), action("assignWorkers")),
    action("recordNoAvailableSiteWork"),
  ),
);

const pilotShipLifecycle = branch("sequence", "pilot-ship-lifecycle",
  guard("isCategorySixPilot"),
  branch("selector", "ship-choice",
    branch("sequence", "approved-swap", guard("shipSwapAuthorized"), action("journalShipSwap")),
    branch("sequence", "already-boarded", guard("currentShipAndOccupancyValid"), action("continueBoarded")),
    branch("sequence", "board-existing", guard("eligibleShipAvailable"), action("journalBoardShip")),
    branch("sequence", "spawn-and-board", guard("shipSpawnAuthorized"), action("journalSpawnAndBoard")),
    action("waitForShipAssignment"),
  ),
);

const pilotStranding = branch("sequence", "pilot-stranding",
  guard("isCategorySixPilot"),
  guard("isActuallyStranded"),
  branch("selector", "stranding-response",
    branch("sequence", "recover-fuel", guard("fuelLocallyRecoverable"), action("recoverOrLoadFuel")),
    branch("sequence", "request-aid", guard("assistanceCanArriveInTime"), action("requestOrAwaitAssistance")),
    branch("sequence", "escape-ship", guard("safeBoardingEscapeAvailable"), action("journalEscapeBoarding")),
    branch("sequence", "last-resort-self-destruct",
      guard("assistanceDeadlineExpired"),
      guard("assistanceConfirmedUnavailable"),
      guard("factionSelfDestructAuthorized"),
      action("revalidateJournalAndSelfDestruct"),
    ),
    action("holdAndReassess"),
  ),
);

const pilotScouting = branch("sequence", "pilot-scouting",
  guard("isCategorySixPilot"),
  guard("assignedScoutingJob"),
  guard("scoutJobWakeDue"),
  branch("selector", "scout-progress",
    branch("sequence", "survey-destination-system",
      guard("atAuthorizedScoutDestination"),
      branch("selector", "survey-ready-or-suspend",
        branch("sequence", "survey-and-stage-intel",
          branch("selector", "survey-or-resume",
            guard("scoutObservationCheckpointComplete"),
            branch("selector", "scouting-intent",
              branch("sequence", "resources",
                guard("scoutIntentResources"),
                guard("resourceSurveySensorsReady"),
                action("journalResourceSurvey"),
              ),
              branch("sequence", "targets",
                guard("scoutIntentTargets"),
                guard("targetSurveySensorsReady"),
                action("journalTargetSurvey"),
              ),
              branch("sequence", "general",
                guard("scoutIntentGeneral"),
                guard("generalSurveySensorsReady"),
                action("journalGeneralSurvey"),
              ),
            ),
          ),
          durableStep("stage-faction-intel", "scoutIntelStagedCheckpointComplete", "stageScoutIntelForFaction"),
        ),
        action("suspendScoutForSensorsOrIntent"),
      ),
    ),
    branch("sequence", "travel-to-scout-destination",
      guard("scoutDestinationDifferentSystem"),
      action("runSystemTransitTree"),
    ),
    action("suspendScoutForDestinationOrRoute"),
  ),
);

const pilotDiscovery = branch("sequence", "pilot-opportunistic-discovery",
  guard("isCategorySixPilot"),
  guard("unprocessedWarpDiscoveryEvent"),
  guard("discoveryWakeDue"),
  branch("selector", "discovery-safety",
    branch("sequence", "observe-and-stage",
      guard("discoveryObservationSafe"),
      durableStep("record-discovery", "discoveryCheckpointComplete", "checkpointUnexpectedDiscovery"),
      durableStep("stage-discovery", "discoveryIntelStagedCheckpointComplete", "stageDiscoveryForFaction"),
      durableStep("ack-event", "discoveryEventAcknowledged", "acknowledgeWarpDiscoveryEvent"),
    ),
    action("deferDiscoveryUntilSafe"),
  ),
);

const pilotSystemTransit = branch("sequence", "pilot-system-transit",
  guard("isCategorySixPilot"),
  guard("transitDestinationAuthorizedAndKnown"),
  guard("transitJobWakeDue"),
  branch("selector", "transit-progress",
    branch("sequence", "already-arrived",
      guard("alreadyInDestinationSystem"),
      action("completeTransitAssignment"),
    ),
    branch("sequence", "route-next-edge",
      action("selectAndRevalidateBestRoute"),
      branch("selector", "available-transit-method",
        branch("sequence", "jump-drive",
          guard("selectedJumpDriveEdge"),
          guard("jumpDrivePreflightReady"),
          action("advanceNpcViaJumpDrive"),
        ),
        branch("sequence", "static-stargate",
          guard("selectedStargateEdge"),
          guard("staticGateEdgeCurrentOrMaintainable"),
          action("advanceNpcViaStargate"),
        ),
        branch("sequence", "smart-gate",
          guard("selectedSmartGateEdge"),
          guard("smartGateLinkPowerAndAccessCurrent"),
          action("advanceNpcViaSmartGate"),
        ),
        branch("sequence", "one-way-catapult",
          guard("selectedCatapultEdge"),
          guard("catapultPowerAndDestinationCurrent"),
          action("advanceNpcViaCatapult"),
        ),
        action("suspendAndReplanTransit"),
      ),
    ),
    action("suspendAndReplanTransit"),
  ),
);

const factionEntity = branch("sequence", "unpiloted-faction-entity",
  guard("isDurableCategoryElevenEntityWithoutPilot"),
  branch("selector", "entity-work",
    branch("sequence", "entity-emergency", guard("entityInImmediateDanger"), action("protectEntity")),
    branch("sequence", "entity-order", guard("authorizedEntityOrder"), action("executeEntityOrder")),
    branch("sequence", "entity-job", guard("entityJobReady"), action("tickEntityJob")),
    action("entityIdle"),
  ),
);

const NPC_DECISION_TREE_SCAFFOLDS: Readonly<Record<string, DecisionNode>> = Object.freeze({
  pilotPriority,
  pilotWork,
  pilotResourceGathering,
  factionSiteResponse,
  pilotShipLifecycle,
  pilotStranding,
  pilotScouting,
  pilotDiscovery,
  pilotSystemTransit,
  factionEntity,
});

function getNpcDecisionTreeBindings(treeName: string) {
  const root = NPC_DECISION_TREE_SCAFFOLDS[treeName];
  if (!root) throw new Error(`Unknown NPC decision tree ${treeName}`);
  const guards = new Set<string>();
  const actions = new Set<string>();
  function visit(node: DecisionNode) {
    if (node.kind === "guard") guards.add(node.name);
    if (node.kind === "action") actions.add(node.name);
    for (const child of node.children || []) visit(child);
  }
  visit(root);
  return { guards: [...guards].sort(), actions: [...actions].sort() };
}

function createNpcDecisionTreeScaffold(
  treeName: string,
  bindings: DecisionBindings,
  primitives?: DecisionPrimitives,
) {
  const root = NPC_DECISION_TREE_SCAFFOLDS[treeName];
  if (!root) throw new Error(`Unknown NPC decision tree ${treeName}`);
  const required = getNpcDecisionTreeBindings(treeName);
  for (const name of required.guards) {
    if (typeof bindings?.guards?.[name] !== "function") {
      throw new Error(`NPC decision tree ${treeName} requires guard ${name}`);
    }
  }
  for (const name of required.actions) {
    if (typeof bindings?.actions?.[name] !== "function") {
      throw new Error(`NPC decision tree ${treeName} requires action ${name}`);
    }
  }
  const runtimePrimitives: DecisionPrimitives = primitives || require("./npcBehaviorTreeRuntime");
  for (const name of ["selector", "sequence", "condition", "action"]) {
    if (typeof runtimePrimitives?.[name] !== "function") {
      throw new Error(`NPC decision tree ${treeName} requires primitive ${name}`);
    }
  }
  function compile(node: DecisionNode): any {
    if (node.kind === "selector") {
      return runtimePrimitives.selector(node.name, node.children.map(compile));
    }
    if (node.kind === "sequence") {
      return runtimePrimitives.sequence(node.name, node.children.map(compile));
    }
    if (node.kind === "guard") {
      // Only an explicit true from an authoritative resolver grants a branch.
      return runtimePrimitives.condition(node.name, (context: any) => bindings.guards[node.name](context) === true);
    }
    return runtimePrimitives.action(node.name, (context: any) =>
      requireDecisionActionResult(node.name, bindings.actions[node.name](context)));
  }
  return compile(root);
}

module.exports = {
  NPC_DECISION_STATUS,
  NPC_DECISION_TREE_SCAFFOLDS,
  getNpcDecisionTreeBindings,
  createNpcDecisionTreeScaffold,
};
