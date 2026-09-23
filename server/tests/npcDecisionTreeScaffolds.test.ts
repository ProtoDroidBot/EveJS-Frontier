import assert from "node:assert/strict";
import test from "node:test";

const {
  NPC_DECISION_TREE_SCAFFOLDS,
  getNpcDecisionTreeBindings,
  createNpcDecisionTreeScaffold,
} = require("../src/space/npc/npcDecisionTreeScaffolds");

function bindingsFor(treeName: string, activeGuards: string[] = [], trace: string[] = []) {
  const required = getNpcDecisionTreeBindings(treeName);
  const enabled = new Set(activeGuards);
  return {
    guards: Object.fromEntries(required.guards.map((name: string) => [
      name, () => enabled.has(name),
    ])),
    actions: Object.fromEntries(required.actions.map((name: string) => [
      name, () => { trace.push(name); return { status: "success" }; },
    ])),
  };
}

test("decision scaffolds are opt-in and reject missing authoritative bindings", () => {
  assert.deepEqual(Object.keys(NPC_DECISION_TREE_SCAFFOLDS).sort(), [
    "factionEntity", "factionSiteResponse", "pilotDiscovery", "pilotPriority", "pilotResourceGathering",
    "pilotScouting", "pilotShipLifecycle", "pilotStranding", "pilotSystemTransit", "pilotWork",
  ]);
  assert.throws(() => createNpcDecisionTreeScaffold("pilotPriority", {}), /requires guard/);
  assert.throws(() => createNpcDecisionTreeScaffold("unknown", {}), /Unknown NPC decision tree/);
  const incomplete = bindingsFor("pilotPriority");
  delete incomplete.actions.handleEmergency;
  assert.throws(() => createNpcDecisionTreeScaffold("pilotPriority", incomplete), /requires action handleEmergency/);
});

test("pilot emergency wins over manual order and ordinary jobs", () => {
  const trace: string[] = [];
  const bindings = bindingsFor("pilotPriority", [
    "isCategorySixPilot", "immediateDanger", "authorizedManualOrder", "durableJobReady",
  ], trace);
  const tree = createNpcDecisionTreeScaffold("pilotPriority", bindings);
  assert.equal(tree.tick({}).status, "success");
  assert.deepEqual(trace, ["handleEmergency"]);
  assert.equal(createNpcDecisionTreeScaffold(
    "pilotPriority", bindingsFor("pilotPriority", ["immediateDanger"], trace),
  ).tick({}).status, "failure");
  assert.deepEqual(trace, ["handleEmergency"]);
});

test("site response requires a current faction site before reserving work", () => {
  const trace: string[] = [];
  const guards = ["isNewFactionSiteEvent", "siteResponseOpen", "siteUnderThreat"];
  const denied = createNpcDecisionTreeScaffold(
    "factionSiteResponse", bindingsFor("factionSiteResponse", guards, trace),
  );
  assert.equal(denied.tick({}).status, "failure");
  assert.deepEqual(trace, []);
  const accepted = createNpcDecisionTreeScaffold(
    "factionSiteResponse", bindingsFor("factionSiteResponse", [
      ...guards, "siteStillOwnedByFaction", "siteNeedsInfrastructure",
    ], trace),
  );
  assert.equal(accepted.tick({}).status, "success");
  assert.deepEqual(trace, ["reserveSiteResponse", "assignDefenders"]);
});

test("stranding never selects self-destruct from low fuel or expiry alone", () => {
  const trace: string[] = [];
  const baseline = ["isCategorySixPilot", "isActuallyStranded", "assistanceDeadlineExpired"];
  const waiting = createNpcDecisionTreeScaffold(
    "pilotStranding", bindingsFor("pilotStranding", baseline, trace),
  );
  assert.equal(waiting.tick({}).status, "success");
  assert.deepEqual(trace, ["holdAndReassess"]);
  trace.length = 0;
  const authorized = createNpcDecisionTreeScaffold(
    "pilotStranding", bindingsFor("pilotStranding", [
      ...baseline, "assistanceConfirmedUnavailable", "factionSelfDestructAuthorized",
    ], trace),
  );
  assert.equal(authorized.tick({}).status, "success");
  assert.deepEqual(trace, ["revalidateJournalAndSelfDestruct"]);
});

test("ship lifecycle and category-11 entity paths remain separate", () => {
  const pilotTrace: string[] = [];
  const pilot = createNpcDecisionTreeScaffold("pilotShipLifecycle", bindingsFor(
    "pilotShipLifecycle", ["isCategorySixPilot", "eligibleShipAvailable"], pilotTrace,
  ));
  assert.equal(pilot.tick({}).status, "success");
  assert.deepEqual(pilotTrace, ["journalBoardShip"]);
  const entityTrace: string[] = [];
  const entity = createNpcDecisionTreeScaffold("factionEntity", bindingsFor(
    "factionEntity", ["isDurableCategoryElevenEntityWithoutPilot", "entityJobReady"], entityTrace,
  ));
  assert.equal(entity.tick({}).status, "success");
  assert.deepEqual(entityTrace, ["tickEntityJob"]);
  assert.equal(createNpcDecisionTreeScaffold(
    "pilotShipLifecycle", bindingsFor("pilotShipLifecycle", ["eligibleShipAvailable"], pilotTrace),
  ).tick({}).status, "failure");
});

test("mining, compatible wreckage, and crude use distinct tools but a shared custody chain", () => {
  const base = ["isCategorySixPilot", "assignedResourceGatheringJob", "resourceJobWakeDue"];
  for (const [sourceGuard, toolGuard, extraction] of [
    ["sourceUsesAsteroidMiningLoop", "compatibleMiningToolAndChargeReady", "extractMiningSourceStep"],
    ["sourceIsCrudeRift", "crudeExtractorAndLensReady", "extractCrudeRiftStep"],
  ]) {
    const blocked: string[] = [];
    createNpcDecisionTreeScaffold("pilotResourceGathering", bindingsFor(
      "pilotResourceGathering", [...base, sourceGuard], blocked,
    )).tick({});
    assert.deepEqual(blocked, ["reserveResourceTarget", "suspendResourceForSourceOrTool"]);
    const ready: string[] = [];
    createNpcDecisionTreeScaffold("pilotResourceGathering", bindingsFor(
      "pilotResourceGathering", [...base, sourceGuard, toolGuard], ready,
    )).tick({});
    assert.deepEqual(ready, [
      "reserveResourceTarget", extraction, "checkpointResourceYieldAndCargo",
      "advanceResourceDeliveryToStorage", "releaseResourceForAuthorizedUse",
    ]);
  }
});

test("resource gathering never stores or offers yield before extraction completes", () => {
  const trace: string[] = [];
  const bindings = bindingsFor("pilotResourceGathering", [
    "isCategorySixPilot", "assignedResourceGatheringJob", "resourceJobWakeDue",
    "sourceUsesAsteroidMiningLoop", "compatibleMiningToolAndChargeReady",
  ], trace);
  bindings.actions.extractMiningSourceStep = () => {
    trace.push("extractMiningSourceStep");
    return { status: "running" };
  };
  const result = createNpcDecisionTreeScaffold("pilotResourceGathering", bindings).tick({});
  assert.equal(result.status, "running");
  assert.deepEqual(trace, ["reserveResourceTarget", "extractMiningSourceStep"]);
  const asleep: string[] = [];
  assert.equal(createNpcDecisionTreeScaffold("pilotResourceGathering", bindingsFor(
    "pilotResourceGathering", ["isCategorySixPilot", "assignedResourceGatheringJob"], asleep,
  )).tick({}).status, "failure");
  assert.deepEqual(asleep, []);
});

test("resource chain resumes after storage wait without re-extracting or duplicating cargo", () => {
  const base = [
    "isCategorySixPilot", "assignedResourceGatheringJob", "resourceJobWakeDue",
    "sourceIsCrudeRift", "crudeExtractorAndLensReady",
  ];
  const firstTrace: string[] = [];
  const first = bindingsFor("pilotResourceGathering", base, firstTrace);
  first.actions.advanceResourceDeliveryToStorage = () => {
    firstTrace.push("advanceResourceDeliveryToStorage");
    return { status: "suspended" };
  };
  assert.equal(createNpcDecisionTreeScaffold("pilotResourceGathering", first).tick({}).status, "suspended");
  assert.deepEqual(firstTrace, [
    "reserveResourceTarget", "extractCrudeRiftStep", "checkpointResourceYieldAndCargo",
    "advanceResourceDeliveryToStorage",
  ]);
  const resumedTrace: string[] = [];
  createNpcDecisionTreeScaffold("pilotResourceGathering", bindingsFor(
    "pilotResourceGathering", [
      "isCategorySixPilot", "assignedResourceGatheringJob", "resourceJobWakeDue",
      "resourceReservationCheckpointComplete", "resourceExtractionCheckpointComplete",
      "resourceCargoCheckpointComplete", "resourceDeliveryCheckpointComplete",
    ], resumedTrace,
  )).tick({});
  assert.deepEqual(resumedTrace, ["releaseResourceForAuthorizedUse"]);
});

test("structure deployment requires placement and construction materials before realization", () => {
  const base = ["isCategorySixPilot", "durableJobReady", "assignedStructureJob"];
  const blocked: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor("pilotWork", base, blocked)).tick({});
  assert.deepEqual(blocked, ["suspendStructureForPlacementOrTools"]);
  const permitted = [...base, "playerPlacementRulesSatisfied", "constructionToolAndAccessReady"];
  const pending: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor("pilotWork", permitted, pending)).tick({});
  assert.deepEqual(pending, ["journalConstructionSitePlacement", "requestOrHaulBuildMaterials"]);
  const fulfilled: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
    "pilotWork", [...permitted, "constructionMaterialsFulfilled"], fulfilled,
  )).tick({});
  assert.deepEqual(fulfilled, ["journalConstructionSitePlacement", "journalRealizeStructure"]);
});

test("manufacturing, hauling, refitting, and ship swaps use their own readiness gates", () => {
  const base = ["isCategorySixPilot", "durableJobReady"];
  for (const [jobGuard, readyGuard, blockedAction, readyAction] of [
    ["assignedManufacturingJob", "industryLaneInputsAndAccessReady", "suspendManufacturingForInputsOrAccess", "journalManufacturingJob"],
    ["assignedHaulJob", "cargoRouteAndCustodyValid", "replanHaul", "journalHaulCycle"],
    ["assignedRefitJob", "fittingTrustAndCompatibleItemsReady", "suspendRefitAndRequestItems", "journalShipRefit"],
    ["assignedShipSwapJob", "shipSwapAuthorized", "suspendShipSwap", "runPilotShipLifecycle"],
  ]) {
    const blocked: string[] = [];
    createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
      "pilotWork", [...base, jobGuard], blocked,
    )).tick({});
    assert.deepEqual(blocked, [blockedAction]);
    const ready: string[] = [];
    createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
      "pilotWork", [...base, jobGuard, readyGuard], ready,
    )).tick({});
    assert.deepEqual(ready, [readyAction]);
  }
});

test("ally refueling prefers a ready transfuser, then a physical fuel drop", () => {
  const base = ["isCategorySixPilot", "durableJobReady", "assignedAllyRefuelJob"];
  const denied: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor("pilotWork", base, denied)).tick({});
  assert.deepEqual(denied, ["suspendRefuelForTargetOrPermission"]);
  const target = [...base, "targetShipFriendlyAndNeedsFuel"];
  const noMethod: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor("pilotWork", target, noMethod)).tick({});
  assert.deepEqual(noMethod, ["suspendRefuelForToolsFuelOrAccess"]);
  const dropped: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
    "pilotWork", [...target, "fuelDropAndRecipientPickupAuthorized"], dropped,
  )).tick({});
  assert.deepEqual(dropped, ["journalFuelDropForPickup"]);
  const transferred: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
    "pilotWork", [...target, "fuelDropAndRecipientPickupAuthorized", "compatibleTransfuserLockedInRangeAndFueled"], transferred,
  )).tick({});
  assert.deepEqual(transferred, ["transferFuelWithTransfuser"]);
});

test("pilot priority delegates a ready specialist job and unknown jobs fail closed", () => {
  const trace: string[] = [];
  createNpcDecisionTreeScaffold("pilotPriority", bindingsFor(
    "pilotPriority", [
      "isCategorySixPilot", "durableJobReady", "assignedResourceGatheringJob",
    ], trace,
  )).tick({});
  assert.deepEqual(trace, ["runResourceGatheringTree"]);
  const unknown: string[] = [];
  createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
    "pilotWork", ["isCategorySixPilot", "durableJobReady"], unknown,
  )).tick({});
  assert.deepEqual(unknown, ["suspendUnclassifiedDurableJob"]);
});

test("scouting travels first, then surveys by resource, target, or general intent", () => {
  const base = ["isCategorySixPilot", "assignedScoutingJob", "scoutJobWakeDue"];
  const enRoute: string[] = [];
  createNpcDecisionTreeScaffold("pilotScouting", bindingsFor(
    "pilotScouting", [...base, "scoutDestinationDifferentSystem"], enRoute,
  )).tick({});
  assert.deepEqual(enRoute, ["runSystemTransitTree"]);
  const noSensors: string[] = [];
  createNpcDecisionTreeScaffold("pilotScouting", bindingsFor(
    "pilotScouting", [...base, "atAuthorizedScoutDestination", "scoutIntentResources"], noSensors,
  )).tick({});
  assert.deepEqual(noSensors, ["suspendScoutForSensorsOrIntent"]);
  for (const [intent, sensor, journal] of [
    ["scoutIntentResources", "resourceSurveySensorsReady", "journalResourceSurvey"],
    ["scoutIntentTargets", "targetSurveySensorsReady", "journalTargetSurvey"],
    ["scoutIntentGeneral", "generalSurveySensorsReady", "journalGeneralSurvey"],
  ]) {
    const observed: string[] = [];
    createNpcDecisionTreeScaffold("pilotScouting", bindingsFor(
      "pilotScouting", [...base, "atAuthorizedScoutDestination", intent, sensor], observed,
    )).tick({});
    assert.deepEqual(observed, [journal, "stageScoutIntelForFaction"]);
  }
  const resumed: string[] = [];
  createNpcDecisionTreeScaffold("pilotScouting", bindingsFor(
    "pilotScouting", [...base, "atAuthorizedScoutDestination", "scoutObservationCheckpointComplete"], resumed,
  )).tick({});
  assert.deepEqual(resumed, ["stageScoutIntelForFaction"]);
  const invalid: string[] = [];
  createNpcDecisionTreeScaffold("pilotScouting", bindingsFor(
    "pilotScouting", base, invalid,
  )).tick({});
  assert.deepEqual(invalid, ["suspendScoutForDestinationOrRoute"]);
});

test("unexpected warp discoveries are event-driven and staged without a scouting job", () => {
  const base = ["isCategorySixPilot", "unprocessedWarpDiscoveryEvent", "discoveryWakeDue"];
  const observed: string[] = [];
  createNpcDecisionTreeScaffold("pilotDiscovery", bindingsFor(
    "pilotDiscovery", [...base, "discoveryObservationSafe"], observed,
  )).tick({});
  assert.deepEqual(observed, [
    "checkpointUnexpectedDiscovery", "stageDiscoveryForFaction", "acknowledgeWarpDiscoveryEvent",
  ]);
  const unsafe: string[] = [];
  createNpcDecisionTreeScaffold("pilotDiscovery", bindingsFor(
    "pilotDiscovery", base, unsafe,
  )).tick({});
  assert.deepEqual(unsafe, ["deferDiscoveryUntilSafe"]);
  const priority: string[] = [];
  createNpcDecisionTreeScaffold("pilotPriority", bindingsFor(
    "pilotPriority", ["isCategorySixPilot", "unexpectedWarpDiscoveryPending"], priority,
  )).tick({});
  assert.deepEqual(priority, ["runOpportunisticDiscoveryTree"]);
});

test("all scaffold actions must return the shared Phase 0 status result", () => {
  const bindings = bindingsFor("pilotDiscovery", [
    "isCategorySixPilot", "unprocessedWarpDiscoveryEvent", "discoveryWakeDue", "discoveryObservationSafe",
  ]);
  bindings.actions.checkpointUnexpectedDiscovery = (() => true) as any;
  assert.throws(() => createNpcDecisionTreeScaffold("pilotDiscovery", bindings).tick({}),
    /must return a Phase 0 behavior result/);
});

test("transit uses the selected valid edge, including one-way catapults", () => {
  const base = ["isCategorySixPilot", "transitDestinationAuthorizedAndKnown", "transitJobWakeDue"];
  const methods = [
    ["selectedJumpDriveEdge", "jumpDrivePreflightReady", "advanceNpcViaJumpDrive"],
    ["selectedStargateEdge", "staticGateEdgeCurrentOrMaintainable", "advanceNpcViaStargate"],
    ["selectedSmartGateEdge", "smartGateLinkPowerAndAccessCurrent", "advanceNpcViaSmartGate"],
    ["selectedCatapultEdge", "catapultPowerAndDestinationCurrent", "advanceNpcViaCatapult"],
  ];
  for (const [selected, ready, advance] of methods) {
    const trace: string[] = [];
    createNpcDecisionTreeScaffold("pilotSystemTransit", bindingsFor(
      "pilotSystemTransit", [...base, selected, ready], trace,
    )).tick({});
    assert.deepEqual(trace, ["selectAndRevalidateBestRoute", advance]);
    const unavailable: string[] = [];
    createNpcDecisionTreeScaffold("pilotSystemTransit", bindingsFor(
      "pilotSystemTransit", [...base, selected], unavailable,
    )).tick({});
    assert.deepEqual(unavailable, ["selectAndRevalidateBestRoute", "suspendAndReplanTransit"]);
  }
});

test("transit rejects unauthorized destinations and skips route planning after arrival", () => {
  const denied: string[] = [];
  assert.equal(createNpcDecisionTreeScaffold("pilotSystemTransit", bindingsFor(
    "pilotSystemTransit", ["isCategorySixPilot", "selectedJumpDriveEdge", "jumpDrivePreflightReady"], denied,
  )).tick({}).status, "failure");
  assert.deepEqual(denied, []);
  const arrived: string[] = [];
  createNpcDecisionTreeScaffold("pilotSystemTransit", bindingsFor(
    "pilotSystemTransit", [
      "isCategorySixPilot", "transitDestinationAuthorizedAndKnown", "transitJobWakeDue",
      "alreadyInDestinationSystem",
    ], arrived,
  )).tick({});
  assert.deepEqual(arrived, ["completeTransitAssignment"]);
});

test("scouting and route planning do no work until a durable wake is due", () => {
  for (const [treeName, activeGuards] of [
    ["pilotScouting", ["isCategorySixPilot", "assignedScoutingJob", "atAuthorizedScoutDestination", "scoutIntentResources", "resourceSurveySensorsReady"]],
    ["pilotDiscovery", ["isCategorySixPilot", "unprocessedWarpDiscoveryEvent", "discoveryObservationSafe"]],
    ["pilotSystemTransit", ["isCategorySixPilot", "transitDestinationAuthorizedAndKnown", "selectedJumpDriveEdge", "jumpDrivePreflightReady"]],
  ] as [string, string[]][]) {
    const trace: string[] = [];
    assert.equal(createNpcDecisionTreeScaffold(treeName, bindingsFor(
      treeName, activeGuards, trace,
    )).tick({}).status, "failure");
    assert.deepEqual(trace, []);
  }
});

test("decision trees accept injected lightweight behavior primitives", () => {
  const runtime = require("../src/space/npc/npcBehaviorTreeRuntime");
  const compiled: string[] = [];
  const primitives = Object.fromEntries(
    ["selector", "sequence", "condition", "action"].map((name) => [
      name, (...args: any[]) => { compiled.push(name); return runtime[name](...args); },
    ]),
  );
  const trace: string[] = [];
  const tree = createNpcDecisionTreeScaffold("pilotScouting", bindingsFor(
    "pilotScouting", ["isCategorySixPilot", "assignedScoutingJob", "scoutJobWakeDue"], trace,
  ), primitives);
  assert.ok(compiled.includes("selector"));
  assert.equal(tree.tick({}).status, "success");
  assert.deepEqual(trace, ["suspendScoutForDestinationOrRoute"]);
});

test("pilot work delegates scouting and transit jobs before the unknown-job fallback", () => {
  const base = ["isCategorySixPilot", "durableJobReady"];
  for (const [job, action] of [
    ["assignedScoutingJob", "runScoutingTree"],
    ["assignedSystemTransitJob", "runSystemTransitTree"],
  ]) {
    const trace: string[] = [];
    createNpcDecisionTreeScaffold("pilotWork", bindingsFor(
      "pilotWork", [...base, job], trace,
    )).tick({});
    assert.deepEqual(trace, [action]);
  }
});
