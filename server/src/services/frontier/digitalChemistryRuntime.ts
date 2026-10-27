"use strict";
const { createHash } = require("node:crypto");
const CATALOG = require("./data/economy3640684.json");
const TABLE = "digitalChemistryState";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const clone = value => JSON.parse(JSON.stringify(value));
function createDigitalChemistryRuntime(options: Record<string, any> = {}) {
  const repo = options.repo || require("../../gameStore/tableRepository").createTableRepository("service:frontier-economy", { strict: true });
  const inventory = options.inventory || require("../inventory/itemStore");
  const now = options.now || Date.now;
  const catalog = options.catalog || CATALOG;
  let ready = false;
  function ensure() { if (!ready) { const result = repo.ensureTable(TABLE); if (result && result.success === false) fail("CHEMISTRY_STORE_UNAVAILABLE"); ready = true; } }
  function read(key) { ensure(); const r = repo.read(TABLE, key === "/" ? "/" : `/${key}`); return r && r.success && r.data ? clone(r.data) : null; }
  function row(key, value) { ensure(); return repo.prepareAtomicRowWrite(TABLE, key, value); }
  function authorize(session) {
    if (options.authorize) return options.authorize(session);
    const characterID = Number(session && (session.characterID || session.charid)), shipID = Number(session?._space?.shipID || session?.shipid || session?.shipID);
    if (!Number.isSafeInteger(characterID) || characterID <= 0 || !Number.isSafeInteger(shipID) || shipID <= 0) fail("AUTHENTICATION_REQUIRED");
    const ship = inventory.findItemById(shipID);
    if (!ship || ship.ownerID !== characterID) fail("SHIP_NOT_ACCESSIBLE");
    const stationID = Number(session.stationid2 || session.stationid || 0);
    return { characterID, sourceLocationIDs: [shipID, ...(stationID > 0 ? [stationID] : [])], sourceFlagIDs: [5, 4],
      accessibleLocationIDs: stationID > 0 ? [stationID] : [],
      getDestinationCapacity: ({ locationID }) => require("./smartStorageUnitRuntime").getShipCargoCapacity(characterID, inventory.findItemById(locationID)) };
  }
  function properties(item) {
    const stored = read(`variant:${item.itemID}`);
    if (stored && stored.typeID === item.typeID) return stored.properties;
    // Legacy whole-unit resources have no variant identity. Choose stable local
    // properties inside the client's authored ranges, keyed by physical stack.
    // This is emulator migration policy, not an inferred official RNG algorithm.
    const result = {};
    for (const [key, range] of Object.entries<any>(catalog.propertyRanges[String(item.typeID)] || {})) {
      if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) fail("VARIANT_PROPERTY_UNAVAILABLE");
      const seed = createHash("sha256").update(`${item.itemID}:${item.typeID}:${key}`).digest().readUInt32LE(0) / 0xffffffff;
      result[key] = range.min + (range.max - range.min) * seed;
    }
    return result;
  }
  function listRecipes() { return catalog.recipes.map(recipe => ({ recipe_id: recipe.recipe_id, name: recipe.name })); }
  function plan(session, recipeID, inputIDs, requestedMultiplier = null) {
    const access = authorize(session), recipe = catalog.recipes.find(row => row.recipe_id === Number(recipeID));
    if (!recipe) fail("RECIPE_NOT_FOUND");
    const entries = inputIDs instanceof Map ? Object.fromEntries(inputIDs) : inputIDs?.type === "dict" ? Object.fromEntries(inputIDs.entries) : inputIDs;
    if (!entries || typeof entries !== "object" || Object.keys(entries).length !== recipe.inputs.length) fail("INVALID_INPUT_SLOTS");
    const selected = {}, seen = new Set(); let maximum = Infinity;
    for (const input of recipe.inputs) {
      const itemID = Number(entries[input.index]);
      if (!Number.isSafeInteger(itemID) || itemID <= 0 || seen.has(itemID)) fail("INVALID_INPUT_SLOTS"); seen.add(itemID);
      const item = inventory.findItemById(itemID);
      if (!item || item.ownerID !== access.characterID || item.typeID !== input.typeID || item.singleton !== 0 ||
          !access.sourceLocationIDs.includes(item.locationID) || !access.sourceFlagIDs.includes(item.flagID)) fail("INPUT_NOT_ACCESSIBLE");
      const quantity = Number(item.stacksize ?? item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) fail("INVALID_INPUT_QUANTITY");
      selected[input.index] = { item, properties: properties(item), quantity };
      maximum = Math.min(maximum, Math.floor(quantity / input.quantity));
    }
    const multiplier = requestedMultiplier == null ? maximum : Number(requestedMultiplier);
    if (!Number.isSafeInteger(multiplier) || multiplier <= 0) fail("FRACTIONAL_CHEMISTRY_NOT_SUPPORTED");
    if (multiplier > maximum || !Number.isSafeInteger(maximum)) fail("INSUFFICIENT_INPUTS");
    const inputs = {}, outputs = {};
    const consumptions = recipe.inputs.map(input => {
      const chosen = selected[input.index], quantity = input.quantity * multiplier;
      if (!Number.isSafeInteger(quantity)) fail("FRACTIONAL_CHEMISTRY_NOT_SUPPORTED");
      inputs[input.index] = { consumed: quantity, remainder: chosen.quantity - quantity };
      return { itemID: chosen.item.itemID, typeID: chosen.item.typeID, quantity, expected: { locationID: chosen.item.locationID, flagID: chosen.item.flagID } };
    });
    for (const output of recipe.outputs) {
      const transformed = {};
      for (const transform of recipe.transforms.filter(row => row.outputIndex === output.index)) {
        if (transform.op !== "linearCombination") fail("UNSUPPORTED_RECIPE_TRANSFORM");
        let value = Number(transform.linearConstant || 0);
        for (const source of recipe.sources.filter(row => row.outputIndex === output.index && row.propertyID === transform.propertyID)) {
          const inputValue = selected[source.inputIndex].properties[source.sourcePropertyID];
          if (!Number.isFinite(inputValue) || !Number.isFinite(source.coefficient)) fail("VARIANT_PROPERTY_UNAVAILABLE");
          value += inputValue * source.coefficient;
        }
        const range = catalog.propertyRanges[String(output.typeID)]?.[transform.propertyID];
        if (!range || !Number.isFinite(value) || value < range.min - 1e-7 || value > range.max + 1e-7) fail("OUTPUT_PROPERTY_OUT_OF_RANGE");
        transformed[transform.propertyID] = value;
      }
      const quantity = output.quantity * multiplier;
      if (!Number.isSafeInteger(quantity)) fail("FRACTIONAL_CHEMISTRY_NOT_SUPPORTED");
      outputs[output.index] = { type_id: output.typeID, properties: transformed, quantity };
    }
    return { access, consumptions, selected, plan: { recipe_id: recipe.recipe_id, multiplier, max_multiplier: maximum, duration: recipe.duration * multiplier, inputs, outputs } };
  }
  function preview(session, recipeID, inputs, multiplier = null) { return plan(session, recipeID, inputs, multiplier).plan; }
  function notify(session, job, changes) {
    if (options.onInventoryChanged) options.onInventoryChanged(session, changes);
    else if (session) require("../character/characterState").emitItemsChangedBatchForSession(session, changes);
    if (options.onCompleted) options.onCompleted(session, job);
    else if (session && typeof session.sendNotification === "function") {
      const native = require("./digitalChemistryService").nativeChemistryValue;
      session.sendNotification("OnRecipeJobCompletedNotice", "clientID", [native(job), native(job.minted_item_ids)]);
    }
  }
  function start(session, recipeID, inputs, destinationID, destinationFlag, multiplier = null) {
    const prepared = plan(session, recipeID, inputs, multiplier), access = prepared.access;
    const dest = Number(destinationID), flag = Number(destinationFlag);
    if (!access.sourceLocationIDs.includes(dest) || !access.sourceFlagIDs.includes(flag)) fail("DESTINATION_NOT_ACCESSIBLE");
    const sequence = read("sequence") || { nextID: 1 };
    const jobID = Number(sequence.nextID), atMs = now();
    if (!Number.isSafeInteger(jobID) || jobID <= 0) fail("INVALID_JOB_SEQUENCE");
    const job = { recipe_job_id: jobID, recipe_id: prepared.plan.recipe_id, character_id: access.characterID,
      location_id: dest, destination_id: dest, destination_flag_id: flag, multiplier: prepared.plan.multiplier,
      start_time: (BigInt(Math.trunc(atMs)) * 10000n + 116444736000000000n).toString(),
      end_time: (BigInt(Math.trunc(atMs + prepared.plan.duration * 1000)) * 10000n + 116444736000000000n).toString(),
      state: 1, frozen_plan: prepared.plan, completed_time: null, minted_item_ids: null,
      endAtMs: atMs + prepared.plan.duration * 1000,
      refund: prepared.consumptions.map(entry => ({ typeID: entry.typeID, quantity: entry.quantity })),
      sourceVariants: Object.values<any>(prepared.selected).map(chosen => ({ itemID: chosen.item.itemID, typeID: chosen.item.typeID, properties: chosen.properties })) };
    const result = inventory.applyInventoryTransactionWithAtomicRows({ ...access, consumptions: prepared.consumptions },
      [row("sequence", { nextID: jobID + 1 }), row(`job:${jobID}`, job),
        ...job.sourceVariants.map(variant => row(`variant:${variant.itemID}`, variant))]);
    if (!result.success) fail(result.errorMsg);
    if (options.onInventoryChanged) options.onInventoryChanged(session, result.data.changes);
    else require("../character/characterState").emitItemsChangedBatchForSession(session, result.data.changes);
    return view(job);
  }
  function view(job) {
    const result = clone(job); delete result.endAtMs; delete result.refund; delete result.sourceVariants;
    return result;
  }
  function finish(session, job, access) {
    if (job.state === 4 || (job.state === 1 && job.endAtMs > now())) return job;
    const cancelling = job.state === 2;
    const outputs = cancelling ? job.refund.map((value, index) => ({ ...value, index, properties: job.sourceVariants[index]?.properties || {} })) :
      Object.entries<any>(job.frozen_plan.outputs).map(([index, value]) => ({ index: Number(index), typeID: value.type_id, quantity: value.quantity, properties: value.properties }));
    let stopped;
    const result = inventory.applyInventoryTransactionWithAtomicRows({ characterID: job.character_id,
      accessibleLocationIDs: access.accessibleLocationIDs, getDestinationCapacity: access.getDestinationCapacity,
      destinationLocationID: job.destination_id, destinationFlagID: job.destination_flag_id,
      grants: outputs.map(output => ({ typeID: output.typeID, quantity: output.quantity, forceNewStack: true })) }, staged => {
        if (staged.grantedItems.length !== outputs.length) fail("CHEMISTRY_OUTPUT_STACK_LIMIT");
        const minted = Object.fromEntries(staged.grantedItems.map((item, index) => [outputs[index].index, item.itemID]));
        stopped = { ...job, state: 4, completed_time: (BigInt(Math.trunc(now())) * 10000n + 116444736000000000n).toString(), minted_item_ids: cancelling ? {} : minted };
        return [row(`job:${job.recipe_job_id}`, stopped), ...staged.grantedItems.map((item, index) => row(`variant:${item.itemID}`, { itemID: item.itemID, typeID: item.typeID, properties: outputs[index].properties }))];
      });
    if (!result.success) {
      // Keep durable paid inputs in escrow until cargo/ownership can be resolved;
      // callers may retry after making room. A failed delivery never mints twice.
      if (job.state === 1) repo.commitAtomicRowWrites([row(`job:${job.recipe_job_id}`, { ...job, state: 3 })]);
      return read(`job:${job.recipe_job_id}`);
    }
    notify(session, view(stopped), result.data.changes); return stopped;
  }
  function getJobs(session) {
    const access = authorize(session);
    return Object.values<any>(read("/") || {}).filter(job => job.recipe_job_id && job.character_id === access.characterID)
      .map(job => view(finish(session, job, access))).sort((a, b) => a.recipe_job_id - b.recipe_job_id);
  }
  function discontinue(session, jobID) {
    const access = authorize(session), job = read(`job:${Number(jobID)}`);
    if (!job || job.character_id !== access.characterID) fail("JOB_NOT_FOUND");
    if (job.state === 4) return false;
    if (job.endAtMs <= now()) { finish(session, job, access); return false; }
    const result = repo.commitAtomicRowWrites([row(`job:${job.recipe_job_id}`, { ...job, state: 2 })]);
    if (!result.success) fail(result.errorMsg);
    finish(session, { ...job, state: 2 }, access); return true;
  }
  return { listRecipes, preview, start, getJobs, discontinue, properties };
}
let singleton;
function getDigitalChemistryRuntime() {
  if (!singleton) {
    singleton = createDigitalChemistryRuntime();
    const timer = setInterval(() => {
      for (const session of require("../chat/sessionRegistry").getSessions()) {
        if (!(session.characterID || session.charid)) continue;
        try { singleton.getJobs(session); } catch (_) { /* Durable escrow retries on the next valid session. */ }
      }
    }, 1000);
    timer.unref();
  }
  return singleton;
}
module.exports = { createDigitalChemistryRuntime, getDigitalChemistryRuntime };
