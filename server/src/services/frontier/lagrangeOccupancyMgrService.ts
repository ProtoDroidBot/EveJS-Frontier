const BaseService = require("../baseService");
const { unwrapMarshalValue, buildList, buildObjectEx1 } = require("../_shared/serviceHelpers");
const { throwWrappedUserError } = require("../../common/machoErrors");
const { getFrontierClaimsRuntime, marshalOccupant } = require("./frontierClaimsRuntime");

class LagrangeOccupancyMgrService extends BaseService {
  declare runtime: any;
  constructor(options: Record<string, any> = {}) { super("lagrangeOccupancyMgr"); this.runtime = options.runtime || null; }
  state() { return this.runtime || getFrontierClaimsRuntime(); }
  arg(args) { const values = unwrapMarshalValue(args); return Array.isArray(values) ? values[0] : values; }
  result(result) { if (!result?.success) throwWrappedUserError("CustomNotify", { notify: result?.errorMsg || "CLAIM_FAILED" }); return null; }
  Handle_add_occupant(args, session) { return this.result(this.state().addOccupant(session, this.arg(args))); }
  Handle_remove_occupant(args, session) { return this.result(this.state().removeOccupant(session, this.arg(args))); }
  Handle_get_occupant(args) { return marshalOccupant(this.state().getOccupant(this.arg(args))); }
  Handle_is_occupied(args) { return Boolean(this.state().getOccupant(this.arg(args))); }
  Handle_is_occupied_by(args) { return buildObjectEx1("frontier.lagrange_occupancy.common.data_classes.OccupantType", [this.state().getOccupant(this.arg(args))?.type || "No_Occupant"]); }
  Handle_get_all_occupants_for_solar_system(args) { const id = Number(this.arg(args)); return buildList(this.state().listOccupants(row => row.lagrange_point.solar_system_id === id).map(marshalOccupant)); }
  Handle_get_all_occupants_for_planet(args) { const id = Number(this.arg(args)); return buildList(this.state().listOccupants(row => row.lagrange_point.planet_id === id).map(marshalOccupant)); }
  Handle_get_all_occupants_for_owner(args) { const id = Number(this.arg(args)); return buildList(this.state().listOccupants(row => row.owner_id === id).map(marshalOccupant)); }
  Handle_get_all_occupants_of_type(args) {
    const value = this.arg(args);
    // The target passes a StrEnum directly here (other mutations use to_dict).
    const type = value?.header?.[0] === "frontier.lagrange_occupancy.common.data_classes.OccupantType" &&
      Array.isArray(value.header[1]) && value.header[1].length === 1 ? value.header[1][0] : value;
    return buildList(this.state().listOccupants(row => row.type === type).map(marshalOccupant));
  }
}
module.exports = LagrangeOccupancyMgrService;
