"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { buildDict } = require("../_shared/serviceHelpers");
const itemStore = require("../inventory/itemStore");
const { findItemById } = itemStore;
const runtime = require("./industryRuntime");
const blueprints = require("./industryBlueprints");
const { publishIndustryItemsChanged } = require("./industryNotifications");
const { throwWrappedObject } = require("../../common/machoErrors");
const { FRONTIER_INDUSTRY_FACILITY_TYPE_IDS } = blueprints;
const { canReadFacility, getItemSolarSystemID } = runtime;
function getSessionCharacterID(session) {
    return Number(session && (session.characterID || session.charid)) || 0;
}
function quantityDict(totals) {
    return buildDict(Object.entries(totals).map(([typeID, quantity]) => [Number(typeID), quantity]));
}
function blueprintDict(blueprint) {
    if (!blueprint)
        return null;
    return buildDict([
        ["blueprint_id", blueprint.blueprint_id],
        ["run_time", blueprint.run_time],
        ...["inputs", "outputs"].map(side => [side, buildDict(Object.entries(blueprint[side]).map(([typeID, slot]) => [Number(typeID), buildDict(Object.entries(slot))]))]),
    ]);
}
function buildIdleFacilityDetails(item = null) {
    const items = item ? runtime.getFacilityItems(item) : { inputs: {}, outputs: {} };
    return buildDict([
        ["production", null],
        [
            "items",
            buildDict([
                ["inputs", quantityDict(items.inputs)],
                ["outputs", quantityDict(items.outputs)],
            ]),
        ],
        ["blueprint", blueprintDict(item ? blueprints.getSelectedBlueprint(item) : null)],
    ]);
}
const ERROR_REASONS = {
    FACILITY_NOT_FOUND: "IndustryError_FacilityNotFound",
    ACCESS_DENIED: "IndustryError_FacilityAccessDenied",
    FACILITY_NOT_IN_CURRENT_SYSTEM: "IndustryInventoryError_NotSameLocation",
    FACILITY_OUT_OF_RANGE: "IndustryInventoryError_NotSameLocation",
    ASSEMBLY_UNDER_CONSTRUCTION: "IndustryError_FacilityOffline",
    ASSEMBLY_ACTIVATING: "IndustryError_FacilityOffline",
    INVALID_SHIP: "IndustryInventoryError_InventoryNotFound",
    INVALID_SOURCE: "IndustryInventoryError_ItemNotFound",
    INVALID_DESTINATION: "IndustryInventoryError_InventoryNotFound",
    INVALID_DESTINATION_TYPE: "IndustryInventoryError_InvalidType",
    SINGLETON_NOT_ACCEPTED: "IndustryInventoryError_Singleton",
    INVALID_INPUT_TYPE: "IndustryInventoryError_InvalidType",
    INPUT_CAPACITY_EXCEEDED: "IndustryInventoryError_FullSlot",
    SHIP_CARGO_CAPACITY_EXCEEDED: "IndustryInventoryError_NotEnoughCapacity",
    INSUFFICIENT_SOURCE_ITEMS: "IndustryInventoryError_NoItemsAvailable",
    INSUFFICIENT_STORED_ITEMS: "IndustryInventoryError_NoItemsAvailable",
    FACILITY_CONTAINS_ITEMS: "IndustryLoadError_ItemsPresent",
    BLUEPRINT_ALREADY_LOADED: "IndustryLoadError_AlreadyLoaded",
    BLUEPRINT_NOT_FOUND: "IndustryStartError_InvalidBlueprint",
    BLUEPRINT_NOT_LOADED: "IndustryStartError_InvalidBlueprint",
};
function requireSuccess(result) {
    if (!result?.success) {
        const reason = ERROR_REASONS[result?.errorMsg] || "IndustryError_Generic";
        throwWrappedObject("frontier.industry.common.errors.IndustryError", [reason], { msg: reason, dict: buildDict([]) });
    }
    return result.data;
}
function finishTransfer(session, result) {
    const data = requireSuccess(result);
    // Separate change dictionaries preserve each source remainder and each new
    // split row. A shared dictionary for the batch corrupts the client cache.
    const { emitItemsChangedForSession } = require("../character/characterState");
    for (const change of data.changes) {
        const item = change.removed
            ? itemStore.buildRemovedItemNotificationState(change.previousData || change.item) : change.item;
        if (!item)
            continue;
        try {
            emitItemsChangedForSession(session, item, change.previousData || {});
        }
        catch (error) {
            log.warn(`[industry] Inventory notification failed: ${error.message}`);
        }
    }
    publishIndustryItemsChanged(session, data.facility.itemID, data.side, runtime.getFacilityItems(data.facility)[data.side]);
    // Python tuple (moved type quantities, jettisoned quantities).
    return [quantityDict(data.items), buildDict([])];
}
class IndustryService extends BaseService {
    constructor() {
        super("industry");
    }
    Handle_get_facility_details(args, session) {
        const facilityID = Number(args && args[0]) || 0;
        const item = findItemById(facilityID);
        const typeID = Number(item && item.typeID) || 0;
        if (facilityID <= 0 ||
            !item ||
            !blueprints.isIndustryFacilityType(typeID) ||
            !canReadFacility(item, session)) {
            log.debug(`[industry] Facility details unavailable char=${getSessionCharacterID(session)} ` +
                `facility=${facilityID} type=${typeID}`);
            return null;
        }
        log.debug(`[industry] Facility details char=${getSessionCharacterID(session)} ` +
            `facility=${facilityID} type=${typeID} state=idle`);
        return buildIdleFacilityDetails(item);
    }
    Handle_load_blueprint(args, session) {
        const blueprint = requireSuccess(runtime.loadBlueprint(session, args?.[0], args?.[1]));
        return blueprintDict(blueprint);
    }
    Handle_deposit_input_items(args, session) {
        return finishTransfer(session, runtime.depositInputItems(session, args?.[0], args?.[1]));
    }
    Handle_withdraw_input_items(args, session) {
        return finishTransfer(session, runtime.withdrawItems(session, args?.[0], args?.[1], args?.[2], args?.[3], "inputs"));
    }
    Handle_withdraw_output_items(args, session) {
        return finishTransfer(session, runtime.withdrawItems(session, args?.[0], args?.[1], args?.[2], args?.[3], "outputs"));
    }
}
module.exports = IndustryService;
module.exports._testing = {
    FRONTIER_INDUSTRY_FACILITY_TYPE_IDS,
    buildIdleFacilityDetails,
    canReadFacility,
    getItemSolarSystemID,
};
//# sourceMappingURL=industryService.js.map