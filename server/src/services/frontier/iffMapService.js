"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const CairnService = require("./cairnService");
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict, buildList, unwrapMarshalValue, } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const iffRuntime = require(path.join(__dirname, "./iffRuntime"));
const { notifyIffStateChanged, scheduleIffVerdicts, } = require(path.join(__dirname, "./iffAbilityHandlers"));
const { findItemById } = require(path.join(__dirname, "../inventory/itemStore"));
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function resolveSessionCharacterID(session) {
    return toInt(session && (session.charid || session.characterID), 0);
}
function resolveSessionSolarSystemID(session) {
    return toInt(session && (session.solarsystemid2 || session.solarsystemid || session.locationid), 0);
}
function buildBeaconRow(row) {
    return buildDict([
        ["beacon_id", row.beacon_id],
        ["type_id", row.type_id],
        ["position", row.position],
        ["is_mine", row.is_mine],
        ["transponder_channel", row.transponder_channel],
        ["transponder_code", row.transponder_code],
    ]);
}
class IffMapService extends CairnService {
    constructor(options = {}) {
        super("iffMapService", options);
        this.options = options;
    }
    /**
     * Beacon rows for the requesting pilot. Always returns a marshalled list —
     * an empty one when nothing is visible — matching the client's
     * `for entry in remote.get_visible_beacons()` consumption.
     */
    Handle_get_visible_beacons(args, session) {
        const characterID = resolveSessionCharacterID(session);
        const solarSystemID = resolveSessionSolarSystemID(session);
        const shipID = toInt(session && (session.activeShipID || session.shipid || session.shipID), 0);
        const viewer = {
            characterID,
            solarSystemID,
            corporationID: toInt(session && session.corpid, 0),
            transponder: shipID > 0
                ? iffRuntime.resolveActiveTransponder(characterID, shipID)
                : null,
        };
        const rows = iffRuntime.listVisibleBeacons(viewer);
        log.debug(`[iffMap] get_visible_beacons char=${characterID} system=${solarSystemID} rows=${rows.length}`);
        // The map fetch is part of the client's IFF bootstrap. Refresh verdicts
        // here as well so a persisted active player transponder immediately sees
        // already-materialized NPC group broadcasts after login or system entry.
        scheduleIffVerdicts(solarSystemID);
        return buildList(rows.map(buildBeaconRow));
    }
    /**
     * The build-3502403 solar-system view names cairn/transponder rows
     * "structures" and iterates this result unconditionally. Keep the client
     * RPC at the IFF service boundary while reusing CairnService's visibility
     * authority and exact row shape; that implementation also guarantees an
     * empty marshalled list when the pilot has no active space scene.
     */
    Handle_get_visible_structures(args, session) {
        if (Number(this.options.clientBuild ?? require("../../config").clientBuild) !== 3640684)
            return super.Handle_get_visible_cairns(args, session);
        const publication = require("./structurePublicationRuntime");
        const rows = CairnService._testing.listVisibleCairns(session, {
            ...this.options,
            isSupportedType: this.options.isTransponderStructureType || publication.isTransponderStructureType,
            isPublished: this.options.isPublished || publication.isPublished,
        });
        const seen = new Set(rows.map(row => Number(row.itemID)));
        const published = (this.options.listPublished || publication.listPublished)(session)
            .filter(row => !seen.has(Number(row.item_id))).map(row => buildDict(Object.entries(row)));
        return buildList([...rows.map(CairnService._testing.buildCairnRow), ...published]);
    }
    /**
     * set_transponder(item_id, channel, code): channel None turns the
     * transponder off; the code argument is only meaningful on the "code"
     * channel. Applies to an owned transponder-capable item (the client uses
     * this surface for cairn transponders). The client discards the return
     * value and refetches after OnIffMapChanged.
     */
    Handle_set_structure_transponder(args, session) {
        const values = unwrapMarshalValue(args);
        const itemID = toInt(values && values[0], 0);
        const item = (this.options.findItemById || findItemById)(itemID);
        const supported = this.options.isTransponderStructureType || require("./structurePublicationRuntime").isTransponderStructureType;
        if (!item || !supported(Number(item.typeID)) || Number(item.ownerID) !== resolveSessionCharacterID(session)) {
            require("../../common/machoErrors").throwWrappedUserError("CustomNotify", { notify: "You do not own a transponder-capable structure with that ID." });
        }
        if (!CairnService.CAIRN_TYPE_IDS.has(Number(item.typeID))) {
            const deployment = this.options.deployment || require("./deploymentRuntime");
            const state = deployment.readConstructionState(item);
            if (!state || state.assemblyStatus === deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION ||
                deployment.isAssemblyActivationPending(item) || Number(item.flagID) !== 0 ||
                Number(state.solarSystemID) !== resolveSessionSolarSystemID(session)) {
                require("../../common/machoErrors").throwWrappedUserError("CustomNotify", { notify: "This assembly must be deployed in the current system." });
            }
        }
        const configuration = iffRuntime.normalizeIffConfiguration(values?.[1], values?.[2], iffRuntime.IFF_TRANSPONDER_CHANNELS);
        if (configuration.errorMsg)
            require("../../common/machoErrors").throwWrappedUserError("CustomNotify", { notify: configuration.errorMsg });
        const result = (this.options.writeTransponderState || iffRuntime.writeTransponderState)(itemID, configuration);
        if (!result?.success)
            require("../../common/machoErrors").throwWrappedUserError("CustomNotify", { notify: "Failed to save the structure transponder." });
        (this.options.notifyIffStateChanged || notifyIffStateChanged)(resolveSessionSolarSystemID(session), "structure-transponder");
        return null;
    }
    Handle_set_transponder(args, session) {
        const values = unwrapMarshalValue(args);
        const list = Array.isArray(values) ? values : [values];
        const itemID = toInt(list[0], 0);
        const rawChannel = list.length > 1 ? unwrapMarshalValue(list[1]) : null;
        const rawCode = list.length > 2 ? unwrapMarshalValue(list[2]) : null;
        const characterID = resolveSessionCharacterID(session);
        const resolveItem = typeof this.options.findItemById === "function"
            ? this.options.findItemById
            : findItemById;
        const item = itemID > 0 ? resolveItem(itemID) : null;
        if (!item || toInt(item.ownerID, 0) !== characterID || characterID <= 0) {
            log.warn(`[iffMap] set_transponder rejected item=${itemID} char=${characterID} reason=ITEM_NOT_OWNED`);
            return false;
        }
        if (!CairnService.CAIRN_TYPE_IDS.has(toInt(item.typeID, 0))) {
            log.warn(`[iffMap] set_transponder rejected item=${itemID} char=${characterID} reason=ITEM_NOT_CAIRN`);
            return false;
        }
        const configuration = iffRuntime.normalizeIffConfiguration(rawChannel, rawCode, iffRuntime.IFF_TRANSPONDER_CHANNELS);
        if (configuration.errorMsg) {
            log.warn(`[iffMap] set_transponder rejected item=${itemID} reason=${configuration.errorMsg}`);
            return false;
        }
        const writeTransponderState = typeof this.options.writeTransponderState === "function"
            ? this.options.writeTransponderState
            : iffRuntime.writeTransponderState;
        const writeResult = writeTransponderState(itemID, configuration);
        if (!writeResult || writeResult.success !== true) {
            log.warn(`[iffMap] set_transponder write failed item=${itemID} ` +
                `reason=${(writeResult && writeResult.errorMsg) || "WRITE_FAILED"}`);
            return false;
        }
        const solarSystemID = resolveSessionSolarSystemID(session);
        if (solarSystemID > 0) {
            notifyIffStateChanged(solarSystemID, "cairn-transponder");
        }
        log.info(`[iffMap] set_transponder item=${itemID} channel=${configuration.channel || "off"} ` +
            `hasCode=${Boolean(configuration.code)}`);
        return true;
    }
}
module.exports = IffMapService;
//# sourceMappingURL=iffMapService.js.map