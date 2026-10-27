"use strict";
const BaseService = require("../baseService");
const { buildDict, buildList } = require("../_shared/serviceHelpers");
const { throwWrappedObject } = require("../../common/machoErrors");
const { getDigitalChemistryRuntime } = require("./digitalChemistryRuntime");
function native(value, key = "") {
  if (value == null) return null;
  if (["start_time", "end_time", "completed_time"].includes(key)) return BigInt(value);
  if (Array.isArray(value)) return buildList(value.map(entry => native(entry)));
  if (typeof value === "object") return buildDict(Object.entries(value).map(([k, v]) => [/^[0-9]+$/.test(k) ? Number(k) : k, native(v, k)]));
  return value;
}
class DigitalChemistryService extends BaseService {
  declare runtime: any;
  constructor(runtime = null) { super("digitalChemistry"); this.runtime = runtime; }
  invoke(action, args, session) {
    try { return native((this.runtime || getDigitalChemistryRuntime())[action](session, ...args)); }
    catch (error) {
      const reasons = { RECIPE_NOT_FOUND: "DigitalChemistryError_RecipeNotFound", INPUT_NOT_ACCESSIBLE: "DigitalChemistryInputError_AccessDenied",
        INVALID_INPUT_SLOTS: "DigitalChemistryInputError_SlotMismatch", INSUFFICIENT_INPUTS: "DigitalChemistryInputError_NotEnoughMaterial",
        FRACTIONAL_CHEMISTRY_NOT_SUPPORTED: "DigitalChemistryPlanError_MultiplierOutOfRange", OUTPUT_PROPERTY_OUT_OF_RANGE: "DigitalChemistryPlanError_OutputOutOfRange",
        NOT_ENOUGH_CARGO_SPACE: "DigitalChemistryJobError_DestinationFull", DESTINATION_NOT_ACCESSIBLE: "DigitalChemistryInputError_AccessDenied" };
      const reason = reasons[error.code || error.message] || "DigitalChemistryError_Generic";
      return throwWrappedObject("frontier.digitalchemistry.common.errors.DigitalChemistryError", [reason, buildDict([])], { msg: reason, dict: buildDict([]) });
    }
  }
  Handle_list_recipes() { return native((this.runtime || getDigitalChemistryRuntime()).listRecipes()); }
  Handle_preview(args, session) { return this.invoke("preview", args, session); }
  Handle_start(args, session) { return this.invoke("start", args, session); }
  Handle_get_jobs(args, session) { return this.invoke("getJobs", [], session); }
  Handle_discontinue(args, session) { return this.invoke("discontinue", args, session); }
}
module.exports = DigitalChemistryService;
module.exports.nativeChemistryValue = native;
