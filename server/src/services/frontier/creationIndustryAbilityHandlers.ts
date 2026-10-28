"use strict";

/**
 * Creation-hosted Industry ability bridge (client build 3502403).
 *
 * Emergency Printer and Material Processor tabs call creation.activate_ability
 * with the fitted module item as facility_id.  Unlike deployed Industry
 * assemblies, that module has no independent ball: its Creation ship is the
 * live-space host.  industryRuntime accepts this explicit creationHost option
 * only after revalidating ownership, persisted fitting membership, active ship
 * and system on every operation.
 */

const path = require("path");

const {
  ABILITY_INDUSTRY_DEPOSIT_INPUT,
  ABILITY_INDUSTRY_DISCONTINUE_PRODUCTION,
  ABILITY_INDUSTRY_LOAD_BLUEPRINT,
  ABILITY_INDUSTRY_START_PRODUCTION,
  ABILITY_INDUSTRY_WITHDRAW_INPUT,
  ABILITY_INDUSTRY_WITHDRAW_OUTPUT,
  ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_INPUT,
  ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_OUTPUT,
  registerCreationAbilityHandler,
  resolveCreationAbilityHandler,
} = require(path.join(__dirname, "./creationAbilityRuntime"));
const industryRuntime = require(path.join(__dirname, "./industryRuntime"));
const industryBlueprints = require(path.join(__dirname, "./industryBlueprints"));
const industryNotifications = require(path.join(__dirname, "./industryNotifications"));
const {
  settleIndustryProduction,
  trackIndustryProduction,
} = require(path.join(__dirname, "./industryProductionWorker"));
const {
  buildDict,
  buildFiletimeLong,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const INDUSTRY_BEHAVIOR = "industry";
const FILETIME_UNITS_PER_MILLISECOND = 10000n;
const FILETIME_UNIX_EPOCH = 116444736000000000n;

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function hostedOptions(context) {
  return {
    creationHost: {
      creationID: positiveInteger(context?.creationItem?.itemID),
      moduleItemID: positiveInteger(context?.moduleItemID),
      characterID: positiveInteger(context?.characterID),
    },
  };
}

function hostedProductionOptions(context) {
  return {
    ...context.industryOptions,
    laneID: positiveInteger(context?.kwargs?.lane_id) || 1,
  };
}

function resolveDependencies(context) {
  const overrides = context?.dependencies || {};
  return {
    industryRuntime: overrides.industryRuntime || industryRuntime,
    industryBlueprints: overrides.industryBlueprints || industryBlueprints,
    industryNotifications: overrides.industryNotifications || industryNotifications,
    settleIndustryProduction: overrides.settleIndustryProduction || settleIndustryProduction,
    trackIndustryProduction: overrides.trackIndustryProduction || trackIndustryProduction,
    jettisonItemQuantitiesFromSourceForSession:
      overrides.jettisonItemQuantitiesFromSourceForSession ||
      require(path.join(
        __dirname,
        "../ship/jettisonRuntime",
      )).jettisonItemQuantitiesFromSourceForSession,
  };
}

function validateIndustryContext(context) {
  if (context?.behaviorName !== INDUSTRY_BEHAVIOR) {
    return { success: false as const, errorMsg: "INDUSTRY_MODULE_REQUIRED" };
  }
  const options = hostedOptions(context);
  const deps = resolveDependencies(context);
  const access = deps.industryRuntime.validateFacility(
    context.session,
    context.moduleItemID,
    options,
  );
  if (!access?.success) return access || { success: false as const, errorMsg: "FACILITY_NOT_FOUND" };
  context.industryOptions = options;
  context.industryDependencies = deps;
  context.industryFacility = access.data.facility;
  return { success: true as const };
}

function quantityDict(totals) {
  return buildDict(Object.entries(totals || {}).map(([typeID, quantity]) => [
    Number(typeID),
    Number(quantity),
  ]));
}

function blueprintDict(blueprint) {
  if (!blueprint) return null;
  return buildDict([
    ["blueprint_id", blueprint.blueprint_id],
    ["run_time", blueprint.run_time],
    ...["inputs", "outputs"].map(side => [side, buildDict(
      Object.entries<any>(blueprint[side] || {}).map(([typeID, slot]) => [
        Number(typeID),
        buildDict(Object.entries(slot || {})),
      ]),
    )]),
  ]);
}

function blueTime(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return null;
  return buildFiletimeLong(
    BigInt(milliseconds) * FILETIME_UNITS_PER_MILLISECOND + FILETIME_UNIX_EPOCH,
  );
}

function productionData(production) {
  if (!production) return {};
  const running = production.state === "RUNNING" || production.state === "DISCONTINUING";
  return {
    state: production.state,
    start_time: running ? blueTime(production.runStartedAtMs) : null,
    end_time: running ? blueTime(production.runEndAtMs) : null,
  };
}

function settle(context) {
  const result = context.industryDependencies.settleIndustryProduction(
    context.moduleItemID,
    context.session,
    context.industryOptions,
  );
  return result?.success === false ? result : { success: true as const };
}

function finishTransfer(context, result, movedKey) {
  if (result instanceof Promise) {
    return result.then(current => finishTransfer(context, current, movedKey));
  }
  if (!result?.success) return result || { success: false as const, errorMsg: "INDUSTRY_TRANSFER_FAILED" };
  try {
    require(path.join(__dirname, "./industryService")).publishIndustryTransferResult(
      context.session,
      result,
    );
  } catch (_) {
    // Inventory already committed; a presentation failure must not invite a
    // retry that duplicates a transfer.
  }
  return {
    success: true as const,
    data: {
      [movedKey]: quantityDict(result.data.items),
      jettisoned: buildDict([]),
    },
  };
}

function finishProduction(context, result) {
  if (!result?.success) return result || { success: false as const, errorMsg: "INDUSTRY_PRODUCTION_FAILED" };
  try {
    context.industryDependencies.industryNotifications.publishIndustryProductionResult(
      result,
      context.session,
    );
  } catch (_) {
    // The job transition is durable even when a disconnected notice stream
    // cannot be updated immediately.
  }
  if (result.data?.facility) {
    context.industryDependencies.trackIndustryProduction(result.data.facility);
  }
  return { success: true as const, data: productionData(result.data?.production) };
}

function withdrawToJettison(context, side) {
  if (!context.session?._space || context.session?.stationid || context.session?.stationid2) {
    return { success: false as const, errorMsg: "SHIP_NOT_IN_SPACE" };
  }
  const settled = settle(context);
  if (!settled.success) return settled;
  const prepared = context.industryDependencies.industryRuntime.prepareJettisonWithdrawal(
    context.session,
    context.moduleItemID,
    context.kwargs.items,
    side,
    context.industryOptions,
  );
  if (!prepared?.success) {
    return prepared || { success: false as const, errorMsg: "INDUSTRY_TRANSFER_FAILED" };
  }
  const jettisoned = context.industryDependencies
    .jettisonItemQuantitiesFromSourceForSession(
      context.session,
      prepared.data.moves,
      {
        sourceLocationID: context.moduleItemID,
        allowedSourceFlagIDs: [prepared.data.sourceFlagID],
      },
    );
  return jettisoned instanceof Promise
    ? jettisoned.then(current => finishJettison(context, prepared, current))
    : finishJettison(context, prepared, jettisoned);
}

function finishJettison(context, prepared, jettisoned) {
  if (!jettisoned?.success || !positiveInteger(jettisoned.containerID)) {
    return { success: false as const, errorMsg: jettisoned?.errorMsg || "INDUSTRY_JETTISON_FAILED" };
  }
  try {
    const side = prepared.data.side;
    const totals = context.industryDependencies.industryRuntime
      .getFacilityItems(prepared.data.facility);
    context.industryDependencies.industryNotifications.publishIndustryItemsChanged(
      context.session,
      prepared.data.facility.itemID,
      side,
      totals[side],
    );
  } catch (_) {
    // The direct escrow-to-can move is already durable. As with ordinary
    // Industry transfers, a disconnected gateway cannot make it retryable.
  }
  return { success: true as const, data: { can_item_id: positiveInteger(jettisoned.containerID) } };
}

function makeHandler(execute) {
  return { validate: validateIndustryContext, execute };
}

function registerCreationIndustryAbilityHandlers() {
  const handlers = new Map([
    [ABILITY_INDUSTRY_LOAD_BLUEPRINT, makeHandler(context => {
      const settled = settle(context);
      if (!settled.success) return settled;
      const result = context.industryDependencies.industryRuntime.loadBlueprint(
        context.session,
        context.moduleItemID,
        context.kwargs.blueprint_id,
        context.industryOptions,
      );
      if (!result?.success) return result;
      context.industryDependencies.industryNotifications.publishIndustryBlueprintChanged(
        context.session,
        context.moduleItemID,
      );
      return { success: true as const, data: { blueprint: blueprintDict(result.data) } };
    })],
    [ABILITY_INDUSTRY_START_PRODUCTION, makeHandler(context => {
      const settled = settle(context);
      if (!settled.success) return settled;
      return finishProduction(context, context.industryDependencies.industryRuntime.startProduction(
        context.session,
        context.moduleItemID,
        context.kwargs.blueprint_id,
        context.kwargs.blueprint_hash,
        null,
        hostedProductionOptions(context),
      ));
    })],
    [ABILITY_INDUSTRY_DISCONTINUE_PRODUCTION, makeHandler(context =>
      finishProduction(context, context.industryDependencies.industryRuntime.discontinueProduction(
        context.session,
        context.moduleItemID,
        hostedProductionOptions(context),
      )))],
    [ABILITY_INDUSTRY_DEPOSIT_INPUT, makeHandler(context => {
      const settled = settle(context);
      if (!settled.success) return settled;
      return finishTransfer(context, context.industryDependencies.industryRuntime.depositInputItems(
        context.session,
        context.moduleItemID,
        context.kwargs.items,
        context.industryOptions,
      ), "deposited");
    })],
    [ABILITY_INDUSTRY_WITHDRAW_INPUT, makeHandler(context => {
      const settled = settle(context);
      if (!settled.success) return settled;
      return finishTransfer(context, context.industryDependencies.industryRuntime.withdrawItems(
        context.session,
        context.moduleItemID,
        context.kwargs.items,
        context.kwargs.inventory_id,
        context.kwargs.inventory_flag,
        "inputs",
        context.industryOptions,
      ), "withdrawn");
    })],
    [ABILITY_INDUSTRY_WITHDRAW_OUTPUT, makeHandler(context => {
      const settled = settle(context);
      if (!settled.success) return settled;
      return finishTransfer(context, context.industryDependencies.industryRuntime.withdrawItems(
        context.session,
        context.moduleItemID,
        context.kwargs.items,
        context.kwargs.inventory_id,
        context.kwargs.inventory_flag,
        "outputs",
        context.industryOptions,
      ), "withdrawn");
    })],
    [ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_INPUT, makeHandler(context =>
      withdrawToJettison(context, "inputs"))],
    [ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_OUTPUT, makeHandler(context =>
      withdrawToJettison(context, "outputs"))],
  ]);
  for (const [ability, handler] of handlers) {
    if (!resolveCreationAbilityHandler(INDUSTRY_BEHAVIOR, ability)) {
      registerCreationAbilityHandler(INDUSTRY_BEHAVIOR, ability, handler);
    }
  }
}

module.exports = {
  registerCreationIndustryAbilityHandlers,
  _testing: {
    blueprintDict,
    hostedOptions,
    hostedProductionOptions,
    productionData,
    quantityDict,
    validateIndustryContext,
  },
};
