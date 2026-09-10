"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const runtime = require(path.join(__dirname, "./shipcasterRuntime"));
class ShipCasterLauncherMgrService extends BaseService {
    constructor() {
        super("shipCasterLauncherMgr");
    }
    Handle_GetFactionsWithShipcaster(args, session) {
        runtime.recordAuditEvent("get_factions_with_shipcaster", args, session);
        return runtime.buildFactionListPayload();
    }
}
ShipCasterLauncherMgrService._testing = runtime;
module.exports = ShipCasterLauncherMgrService;
//# sourceMappingURL=shipCasterLauncherMgrService.js.map