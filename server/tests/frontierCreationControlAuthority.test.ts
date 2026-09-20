"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const BeyonceService = require("../src/services/ship/beyonceService");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const {
  CREATION_APPROACH_RANGE_METERS,
  TYPE_CREATION_AUTOHELM,
  TYPE_CREATION_REPEATER,
  handleCreationControlStateChange,
  hasOnlineCreationControlModule,
  resolveCreationControlAuthority,
} = require("../src/services/frontier/creationControlAuthority");

function buildAuthorityState(
  onlineModuleTypeIDs: number[] = [],
  isCreation = true,
  poweredOff = false,
) {
  return {
    authorityResolved: true,
    isCreation,
    onlineModuleTypeIDs: new Set(onlineModuleTypeIDs),
    poweredOff,
  };
}

function createMovementHarness(authorityState) {
  const followCalls: any[] = [];
  const stopCalls: any[] = [];
  let nextTraceID = 1;
  let currentAuthorityState = authorityState;
  const entity: Record<string, any> = {
    itemID: 101,
    mode: "STOP",
    targetEntityID: null,
    followRange: 0,
    movementTrace: null,
  };
  const spaceRuntime = {
    getDockingDebugState() {
      return null;
    },
    followBall(session, targetID, range) {
      followCalls.push({ session, targetID, range });
      entity.mode = "FOLLOW";
      entity.targetEntityID = targetID;
      entity.followRange = range;
      entity.movementTrace = { id: nextTraceID++ };
      return true;
    },
    getShipEntityForSession() {
      return entity;
    },
    stop(session) {
      stopCalls.push({ session });
      entity.mode = "STOP";
      entity.targetEntityID = null;
      entity.followRange = 0;
      entity.movementTrace = { id: nextTraceID++ };
      return true;
    },
  };
  const service = new BeyonceService({
    spaceRuntime,
    resolveCreationControlAuthority: () => currentAuthorityState,
  });
  return {
    entity,
    followCalls,
    service,
    setAuthorityState(value) {
      currentAuthorityState = value;
    },
    spaceRuntime,
    stopCalls,
  };
}

test("Creation control authority uses persisted effective online state", () => {
  const session = {
    characterID: 140000005,
    _space: { shipID: 9988400000123 },
  };
  const shipItem = { itemID: 9988400000123, typeID: 95735 };
  const authorityState = resolveCreationControlAuthority(session, {
    findCharacterShip: () => shipItem,
    getActiveShipRecord: () => null,
    getCreationDogmaContext: () => ({
      success: true,
      data: {
        moduleItems: [
          {
            itemID: 101,
            typeID: TYPE_CREATION_REPEATER,
            moduleState: { online: false },
          },
          {
            itemID: 102,
            typeID: TYPE_CREATION_AUTOHELM,
            moduleState: { online: true },
          },
        ],
      },
    }),
  });

  assert.equal(authorityState.authorityResolved, true);
  assert.equal(authorityState.isCreation, true);
  assert.equal(
    hasOnlineCreationControlModule(authorityState, TYPE_CREATION_REPEATER),
    false,
  );
  assert.equal(
    hasOnlineCreationControlModule(authorityState, TYPE_CREATION_AUTOHELM),
    true,
  );
});

test("Creation control authority remains unresolved during partial session teardown", () => {
  const shipItem = {
    itemID: 9988400000123,
    typeID: 95735,
    customInfo: JSON.stringify({
      evejsFrontierCreation: {
        version: 1,
        templateTypeID: 95735,
        poweredOff: false,
        modules: [],
        interiorPlacements: [],
        hardpoints: [],
      },
    }),
  };

  const authorityState = resolveCreationControlAuthority(
    { _space: { shipID: shipItem.itemID } },
    { shipItem },
  );

  assert.equal(authorityState.authorityResolved, false);
  assert.equal(authorityState.isCreation, true);
  assert.equal(authorityState.onlineModuleTypeIDs.size, 0);
});

test("only an explicit non-Creation template result confirms regular-ship authority", () => {
  const session = {
    characterID: 140000005,
    _space: { shipID: 9988400000123 },
  };
  const shipItem = { itemID: 9988400000123, typeID: 587 };
  const confirmedRegular = resolveCreationControlAuthority(session, {
    shipItem,
    getCreationDogmaContext: () => ({
      success: false,
      errorMsg: "CREATION_TEMPLATE_NOT_FOUND",
    }),
  });
  const unknownFailure = resolveCreationControlAuthority(session, {
    shipItem,
    getCreationDogmaContext: () => ({
      success: false,
      errorMsg: "DATABASE_UNAVAILABLE",
    }),
  });

  assert.equal(confirmedRegular.authorityResolved, true);
  assert.equal(confirmedRegular.isCreation, false);
  assert.equal(unknownFailure.authorityResolved, false);
  assert.equal(unknownFailure.isCreation, false);
});

test("a Creation ship cannot issue automatic Approach without an online Autohelm", () => {
  const harness = createMovementHarness(buildAuthorityState());
  const session = { characterID: 140000005, _space: { shipID: 101 } };
  let caught = null;

  try {
    harness.service.Handle_CmdFollowBall(
      [202, CREATION_APPROACH_RANGE_METERS],
      session,
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.name, "MachoWrappedException");
  assert.equal(
    caught.machoErrorResponse.payload.header[1][0],
    "CustomNotify",
  );
  assert.equal(harness.followCalls.length, 0);
});

test("an online Autohelm authorizes automatic Approach for Creation ships", () => {
  const harness = createMovementHarness(
    buildAuthorityState([TYPE_CREATION_AUTOHELM]),
  );
  const session = { characterID: 140000005, _space: { shipID: 101 } };

  assert.equal(
    harness.service.Handle_CmdFollowBall(
      [202, CREATION_APPROACH_RANGE_METERS],
      session,
    ),
    null,
  );
  assert.deepEqual(harness.followCalls, [{
    session,
    targetID: 202,
    range: CREATION_APPROACH_RANGE_METERS,
  }]);
});

test("a powered-down Creation cannot use an otherwise-online Autohelm", () => {
  const harness = createMovementHarness(
    buildAuthorityState([TYPE_CREATION_AUTOHELM], true, true),
  );
  const session = { characterID: 140000005, _space: { shipID: 101 } };
  let caught = null;

  try {
    harness.service.Handle_CmdFollowBall(
      [202, CREATION_APPROACH_RANGE_METERS],
      session,
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.name, "MachoWrappedException");
  assert.equal(harness.followCalls.length, 0);
});

test("unresolved authority rejects automatic Approach before movement", () => {
  const harness = createMovementHarness({
    authorityResolved: false,
    isCreation: false,
    onlineModuleTypeIDs: new Set(),
  });
  const session = { characterID: 140000005, _space: { shipID: 101 } };
  let caught = null;

  try {
    harness.service.Handle_CmdFollowBall(
      [202, CREATION_APPROACH_RANGE_METERS],
      session,
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.name, "MachoWrappedException");
  assert.equal(
    caught.machoErrorResponse.payload.header[1][0],
    "CustomNotify",
  );
  assert.equal(harness.followCalls.length, 0);
});

test("distinguishable Keep At Range and non-Creation Approach do not require Autohelm", () => {
  const creationHarness = createMovementHarness(buildAuthorityState());
  const creationSession = { characterID: 140000005, _space: { shipID: 101 } };
  assert.equal(
    creationHarness.service.Handle_CmdFollowBall([202, 5_000], creationSession),
    null,
  );
  assert.equal(creationHarness.followCalls.length, 1);

  const regularHarness = createMovementHarness(buildAuthorityState([], false));
  const regularSession = { characterID: 140000006, _space: { shipID: 303 } };
  assert.equal(
    regularHarness.service.Handle_CmdFollowBall(
      [404, CREATION_APPROACH_RANGE_METERS],
      regularSession,
    ),
    null,
  );
  assert.equal(regularHarness.followCalls.length, 1);

  // Zero is not authored by ShipApproach in build 3502403. It remains a
  // manual-compatible follow request for older or custom clients.
  assert.equal(
    creationHarness.service.Handle_CmdFollowBall([203, 0], creationSession),
    null,
  );
  assert.equal(creationHarness.followCalls.length, 2);
});

for (const reason of [
  "module_online_state",
  "draft_commit",
  "power_state",
]) {
  test(`Autohelm ${reason} loss cancels its still-current Approach`, () => {
    const online = buildAuthorityState([TYPE_CREATION_AUTOHELM]);
    const harness = createMovementHarness(online);
    const session = { characterID: 140000005, _space: { shipID: 101 } };

    harness.service.Handle_CmdFollowBall(
      [202, CREATION_APPROACH_RANGE_METERS],
      session,
    );
    const movementTraceID = harness.entity.movementTrace.id;
    creationRuntime._notifyCreationStateChangedForTests({
      reason,
      session,
      spaceRuntime: harness.spaceRuntime,
      authorityState: buildAuthorityState(),
    });

    assert.equal(harness.stopCalls.length, 1);
    assert.equal(harness.entity.mode, "STOP");
    assert.notEqual(harness.entity.movementTrace.id, movementTraceID);
  });
}

test("Autohelm loss cancels the GOTO continuation of the same Approach trace", () => {
  const harness = createMovementHarness(
    buildAuthorityState([TYPE_CREATION_AUTOHELM]),
  );
  const session = { characterID: 140000005, _space: { shipID: 101 } };
  harness.service.Handle_CmdFollowBall(
    [202, CREATION_APPROACH_RANGE_METERS],
    session,
  );
  harness.entity.mode = "GOTO";

  const result = handleCreationControlStateChange({
    session,
    spaceRuntime: harness.spaceRuntime,
    authorityState: buildAuthorityState(),
  });

  assert.equal(result.canceled, true);
  assert.equal(harness.stopCalls.length, 1);
});

test("Autohelm loss does not cancel a later unrelated movement trace", () => {
  const harness = createMovementHarness(
    buildAuthorityState([TYPE_CREATION_AUTOHELM]),
  );
  const session = { characterID: 140000005, _space: { shipID: 101 } };
  harness.service.Handle_CmdFollowBall(
    [202, CREATION_APPROACH_RANGE_METERS],
    session,
  );
  harness.entity.mode = "GOTO";
  harness.entity.movementTrace = {
    id: harness.entity.movementTrace.id + 1,
  };

  const result = handleCreationControlStateChange({
    session,
    spaceRuntime: harness.spaceRuntime,
    authorityState: buildAuthorityState(),
  });

  assert.deepEqual(result, { canceled: false, reason: "SUPERSEDED" });
  assert.equal(harness.stopCalls.length, 0);
  assert.equal(harness.entity.mode, "GOTO");
});

test("Creation state listener failures are isolated from the durable publisher", (t) => {
  let laterListenerRan = false;
  const unsubscribeFailure = creationRuntime.subscribeCreationStateChanges(() => {
    throw new Error("observer failed after commit");
  });
  const unsubscribeLater = creationRuntime.subscribeCreationStateChanges(() => {
    laterListenerRan = true;
  });
  t.after(unsubscribeFailure);
  t.after(unsubscribeLater);

  assert.doesNotThrow(() =>
    creationRuntime._notifyCreationStateChangedForTests({
      reason: "power_state",
      session: {},
    }));
  assert.equal(laterListenerRan, true);
});
