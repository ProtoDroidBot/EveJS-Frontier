"use strict";
const BaseService = require("../baseService");
const defaultRuntime = require("./dockingPointRuntime");
const { buildDict, buildList } = require("../_shared/serviceHelpers");
const { throwWrappedUserError } = require("../../common/machoErrors");
class DockingPointService extends BaseService {
  declare runtime: any;
  constructor(options: Record<string, any> = {}) { super("dockingPointService"); this.runtime = options.runtime || defaultRuntime; }
  _check(result) {
    if (!result?.success) throwWrappedUserError(result?.errorMsg || "DockingFailed", {});
    return result?.data;
  }
  Handle_get_docking_capabilities(_args, session) { return buildDict(Object.entries(this.runtime.capabilities(session))); }
  Handle_manual_dock(args, session) { return buildList(this._check(this.runtime.manualDock(session, args?.[0])) || []); }
  Handle_undock(args, session) { this._check(this.runtime.undock(session, args?.[0])); return null; }
  Handle_get_docked_point(_args, session) { return this.runtime.getDockedPoint(session); }
  Handle_refuel_from_port(args, session) { this._check(this.runtime.refuelFromPort(session, args?.[0], args?.[1], args?.[2])); return null; }
}
module.exports = DockingPointService;
