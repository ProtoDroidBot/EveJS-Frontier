"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
class SecurityMgrService extends BaseService {
    constructor() {
        super("securityMgr");
    }
    Handle_get_modified_systems(args, session, kwargs) {
        log.debug("[SecurityMgrService] get_modified_systems called");
        return { type: "dict", entries: [] };
    }
}
module.exports = SecurityMgrService;
//# sourceMappingURL=securityMgrService.js.map