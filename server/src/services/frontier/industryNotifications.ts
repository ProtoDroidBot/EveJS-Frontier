const protobuf = require("protobufjs");
const log = require("../../utils/logger");
const { encodePayload, timestampFromMs } = require(
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
);

const NOTICE_NAMESPACE = "eve_public.industry.api";
let cachedTypes = null;

function getIndustryNoticeTypes() {
  if (cachedTypes) {
    return cachedTypes;
  }

  // Field numbers and scalar types from client build 3502403's descriptors.
  const root = new protobuf.Root();
  root.define("google.protobuf").add(new protobuf.Type("Timestamp")
    .add(new protobuf.Field("seconds", 1, "int64"))
    .add(new protobuf.Field("nanos", 2, "int32")));
  root.define("eve_public.industry.model.reason").add(new protobuf.Enum("Reason", {
    REASON_UNSPECIFIED: 0, REASON_MANUAL: 1, REASON_OFFLINE: 2,
    REASON_VERSION: 3, REASON_GM: 4, REASON_MISSING_INPUT: 5, REASON_OUTPUT_CAPACITY: 6,
  }));
  root.define("eve_public.industry.model.facility").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "int64"),
    ),
  );
  root.define("eve_public.inventory.genericitemtype").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );
  root.define("eve_public.industry.model.item").add(
    new protobuf.Type("Stack")
      .add(new protobuf.Field(
        "type", 1, "eve_public.inventory.genericitemtype.Identifier",
      ))
      .add(new protobuf.Field("quantity", 2, "int64")),
  );
  const api = root.define(NOTICE_NAMESPACE);
  for (const name of ["InputItemsChangeNotice", "OutputItemsChangeNotice"]) {
    api.add(
      new protobuf.Type(name)
        .add(new protobuf.Field(
          "facility", 1, "eve_public.industry.model.facility.Identifier",
        ))
        .add(new protobuf.Field(
          "items", 2, "eve_public.industry.model.item.Stack", "repeated",
        )),
    );
  }
  api.add(new protobuf.Type("ProductionStartedNotice")
    .add(new protobuf.Field("facility", 1, "eve_public.industry.model.facility.Identifier"))
    .add(new protobuf.Field("start_time", 2, "google.protobuf.Timestamp"))
    .add(new protobuf.Field("end_time", 3, "google.protobuf.Timestamp")));
  api.add(new protobuf.Type("ProductionStoppedNotice")
    .add(new protobuf.Field("facility", 1, "eve_public.industry.model.facility.Identifier"))
    .add(new protobuf.Field("reason", 2, "eve_public.industry.model.reason.Reason")));
  root.resolveAll();
  cachedTypes = {
    inputs: root.lookupType(`${NOTICE_NAMESPACE}.InputItemsChangeNotice`),
    outputs: root.lookupType(`${NOTICE_NAMESPACE}.OutputItemsChangeNotice`),
    started: root.lookupType(`${NOTICE_NAMESPACE}.ProductionStartedNotice`),
    stopped: root.lookupType(`${NOTICE_NAMESPACE}.ProductionStoppedNotice`),
  };
  return cachedTypes;
}

function publishIndustryProductionChanged(session, facilityID, event, options: Record<string, any> = {}) {
  const characterID = Number(session && (session.characterID || session.charid));
  const numericFacilityID = Number(facilityID);
  if (!Number.isSafeInteger(characterID) || characterID <= 0 ||
      !Number.isSafeInteger(numericFacilityID) || numericFacilityID <= 0 ||
      !["started", "stopped"].includes(event?.type)) return false;
  const payload: Record<string, any> = { facility: { sequential: numericFacilityID } };
  if (event.type === "started") {
    const { runStartedAtMs, runEndAtMs } = event.production || {};
    if (!Number.isSafeInteger(runStartedAtMs) || runStartedAtMs < 0 ||
        !Number.isSafeInteger(runEndAtMs) || runEndAtMs <= runStartedAtMs) return false;
    payload.start_time = timestampFromMs(runStartedAtMs);
    payload.end_time = timestampFromMs(runEndAtMs);
  } else {
    const reasons = {
      MANUAL: 1, DISCONTINUED: 1, COMPLETED: 1, RUNS_COMPLETED: 1,
      FACILITY_OFFLINE: 2, OFFLINE: 2,
      INVALID_BLUEPRINT_HASH: 3, INVALID_BLUEPRINT: 3, BLUEPRINT_CHANGED: 3,
      INSUFFICIENT_INPUTS: 5, MISSING_INPUT: 5,
      OUTPUT_CAPACITY_EXCEEDED: 6, OUTPUT_CAPACITY: 6,
    };
    payload.reason = reasons[event.stopReason || event.production?.stopReason] || 0;
  }
  try {
    const publish = options.publishGatewayNotice || require("../../_secondary/express/publicGatewayLocal").publishGatewayNotice;
    const noticeType = getIndustryNoticeTypes()[event.type];
    publish(`${NOTICE_NAMESPACE}.${noticeType.name}`, encodePayload(noticeType, payload), { character: characterID });
    return true;
  } catch (error) {
    log.warn(`[industry] Failed to publish production for facility=${numericFacilityID}: ${error.message}`);
    return false;
  }
}

function publishIndustryJobLaneChanged(session, facility, event, options: Record<string, any> = {}) {
  const facilityID = Number(facility?.itemID);
  const laneID = Number(event?.laneID) || 1;
  if (!Number.isSafeInteger(facilityID) || facilityID <= 0 ||
      !Number.isSafeInteger(laneID) || laneID <= 0) return false;
  const characterIDs = new Set<number>([Number(facility.ownerID)]);
  const callerID = Number(session?.characterID || session?.charid);
  if (Number.isSafeInteger(callerID) && callerID > 0) characterIDs.add(callerID);
  const sessions = new Set<any>(session ? [session] : []);
  try {
    const registry = options.sessionRegistry || require("../chat/sessionRegistry");
    for (const connected of registry.getSessions()) sessions.add(connected);
  } catch (error) { log.warn(`[industry] Lane sessions unavailable: ${error.message}`); }
  let published = false;
  for (const connected of sessions) {
    if (!characterIDs.has(Number(connected?.characterID || connected?.charid)) ||
        typeof connected.sendNotification !== "function") continue;
    try {
      connected.sendNotification("OnFrontierIndustryJobLaneChanged", "clientID", [
        facilityID,
        laneID,
        event?.type || "changed",
      ]);
      published = true;
    } catch (error) {
      log.warn(`[industry] Lane notification failed for facility=${facilityID}: ${error.message}`);
    }
  }
  return published;
}

// Background completion has no initiating transport. Notify every connected
// owner session and the owner's gateway streams after the inventory commits.
function publishIndustryProductionResult(result, session = null, options: Record<string, any> = {}) {
  const data = result?.data;
  const facility = data?.facility;
  if (!facility) return;
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const events = Array.isArray(data.events) ? data.events : [];
  if (!changes.length && !events.length) return;
  const ownerID = Number(facility.ownerID);
  const target = { characterID: ownerID };
  const runtime = options.runtime || require("./industryRuntime");
  const laneSides = new Map<number, Set<string>>();
  for (const change of changes) {
    for (const item of [change.item, change.previousData]) {
      if (Number(item?.locationID) !== Number(facility.itemID)) continue;
      const escrow = runtime.industryEscrowLaneForFlag?.(item.flagID) ||
        (Number(item.flagID) === Number(runtime.INDUSTRY_INPUT_FLAG)
          ? { laneID: 1, side: "inputs" }
          : Number(item.flagID) === Number(runtime.INDUSTRY_OUTPUT_FLAG)
            ? { laneID: 1, side: "outputs" } : null);
      if (!escrow) continue;
      if (!laneSides.has(escrow.laneID)) laneSides.set(escrow.laneID, new Set());
      laneSides.get(escrow.laneID).add(escrow.side);
    }
  }
  if (changes.length) {
    try {
      const registry = options.sessionRegistry || require("../chat/sessionRegistry");
      const sessions = new Set<any>(registry.getSessions());
      if (session) sessions.add(session);
      const itemStore = options.itemStore || require("../inventory/itemStore");
      const emit = options.emitItemsChangedForSession || require("../character/characterState").emitItemsChangedForSession;
      for (const ownerSession of sessions) {
        if (Number(ownerSession?.characterID || ownerSession?.charid) !== ownerID) continue;
        for (const change of changes) {
          const item = change.removed
            ? itemStore.buildRemovedItemNotificationState(change.previousData || change.item) : change.item;
          if (!item) continue;
          try { emit(ownerSession, item, change.previousData || {}); }
          catch (error) { log.warn(`[industry] Inventory notification failed: ${error.message}`); }
        }
      }
    } catch (error) { log.warn(`[industry] Owner inventory notifications unavailable: ${error.message}`); }
  }
  if (laneSides.size) {
    try {
      // Gateway inventory descriptors predate lanes. Only lane one may use
      // that replacement stream; lane-aware clients refresh from lane events.
      const sides = laneSides.get(1);
      if (sides) {
        const totals = runtime.getFacilityItems(facility, 1);
        for (const side of sides) {
          publishIndustryItemsChanged(target, facility.itemID, side, totals[side], options);
        }
      }
    } catch (error) { log.warn(`[industry] Production inventory snapshots unavailable: ${error.message}`); }
  }
  for (const event of events) {
    publishIndustryJobLaneChanged(session, facility, event, options);
    // Retail descriptors do not carry a lane identifier. Only lane 1 is
    // mirrored onto that legacy stream so an older client cannot mistake a
    // delegated lane for its single production slot.
    if ((Number(event?.laneID) || 1) === 1) {
      publishIndustryProductionChanged(target, facility.itemID, event, options);
    }
  }
}

// A recipe change also invalidates slot controllers and run duration. The
// retail gateway item notices only update quantities, so the client adapter
// listens for this event and reloads the complete authoritative facility.
function publishIndustryBlueprintChanged(session, facilityID, requestedLaneID: any = 1,
  options: Record<string, any> = {}) {
  // Preserve callers from the single-lane API that supplied options third.
  if (requestedLaneID && typeof requestedLaneID === "object") {
    options = requestedLaneID;
    requestedLaneID = 1;
  }
  const characterID = Number(session && (session.characterID || session.charid));
  const numericFacilityID = Number(facilityID);
  const laneID = Number(requestedLaneID) || 1;
  if (!Number.isSafeInteger(characterID) || characterID <= 0 ||
      !Number.isSafeInteger(numericFacilityID) || numericFacilityID <= 0) return false;
  const store = options.itemStore || require("../inventory/itemStore");
  const facility = store.findItemById?.(numericFacilityID);
  if (facility) publishIndustryJobLaneChanged(session, facility, {
    laneID,
    type: "blueprint_changed",
  }, options);
  if (laneID !== 1) return true;
  const sessions = new Set<any>(session ? [session] : []);
  try {
    const registry = options.sessionRegistry || require("../chat/sessionRegistry");
    for (const connected of registry.getSessions()) sessions.add(connected);
  } catch (error) { log.warn(`[industry] Blueprint owner sessions unavailable: ${error.message}`); }
  for (const connected of sessions) {
    if (Number(connected?.characterID || connected?.charid) !== characterID ||
        typeof connected.sendNotification !== "function") continue;
    try {
      connected.sendNotification("OnFrontierIndustryBlueprintChanged", "clientID", [numericFacilityID]);
    } catch (error) {
      log.warn(`[industry] Blueprint notification failed for facility=${numericFacilityID}: ${error.message}`);
    }
  }
  // Selection is allowed only with both inventories empty. Preserve the
  // replacement snapshots for clients using the original gateway listeners.
  for (const side of ["inputs", "outputs"]) {
    publishIndustryItemsChanged(session, numericFacilityID, side, {}, options);
  }
  return true;
}

function publishIndustryItemsChanged(
  session,
  facilityID,
  side,
  totals,
  options: Record<string, any> = {},
) {
  const characterID = Number(session && (session.characterID || session.charid));
  const numericFacilityID = Number(facilityID);
  if (
    !Number.isSafeInteger(characterID) || characterID <= 0 ||
    !Number.isSafeInteger(numericFacilityID) || numericFacilityID <= 0 ||
    (side !== "inputs" && side !== "outputs")
  ) {
    return false;
  }

  // These notices replace the client's cached side completely. Send all
  // remaining type totals, including an empty list after the final withdrawal.
  const items = Object.entries(totals || {}).map(([typeID, quantity]) => ({
    type: { sequential: Number(typeID) },
    quantity: Number(quantity),
  }));
  if (items.some((item) => (
    !Number.isSafeInteger(item.type.sequential) || item.type.sequential <= 0 ||
    !Number.isSafeInteger(item.quantity) || item.quantity < 0
  ))) {
    return false;
  }

  try {
    const publish = options.publishGatewayNotice || require(
      "../../_secondary/express/publicGatewayLocal",
    ).publishGatewayNotice;
    const noticeType = getIndustryNoticeTypes()[side];
    publish(
      `${NOTICE_NAMESPACE}.${noticeType.name}`,
      encodePayload(noticeType, {
        facility: { sequential: numericFacilityID },
        items: items.filter((item) => item.quantity > 0),
      }),
      { character: characterID },
    );
    return true;
  } catch (error) {
    // The inventory transfer has already committed. A disconnected notice
    // stream must not turn it into an apparent failed transfer and invite retry.
    log.warn(`[industry] Failed to publish ${side} snapshot for facility=${numericFacilityID}: ${error.message}`);
    return false;
  }
}

module.exports = {
  publishIndustryBlueprintChanged,
  publishIndustryItemsChanged,
  publishIndustryProductionChanged,
  publishIndustryJobLaneChanged,
  publishIndustryProductionResult,
  _testing: { getIndustryNoticeTypes },
};
