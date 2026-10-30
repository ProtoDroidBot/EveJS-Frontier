const BaseService = require("../baseService");
const { buildDict, buildList, unwrapMarshalValue } = require("../_shared/serviceHelpers");
const { throwWrappedUserError, isMachoWrappedException } = require("../../common/machoErrors");
const { assertLegacyIndustryProfile } = require("./legacyIndustryRuntime");
const {
  getLegacyIndustryBlueprintIDsForStation,
  getLegacyIndustryBlueprintIDsForAllStations,
} = require("./legacyIndustryStaticData");

function readCatalog(session, operation) {
  assertLegacyIndustryProfile(session);
  try { return operation(); }
  catch (error) {
    if (isMachoWrappedException(error)) throw error;
    throwWrappedUserError("CustomNotify", { notify: "The source station manufacturing catalog is unavailable." });
  }
}

class StationConstructableManagerService extends BaseService {
  constructor() { super("stationConstructableManager"); }

  Handle_get_blueprint_ids_for_station(args, session) {
    return readCatalog(session, () => {
      const stationID = unwrapMarshalValue(args?.[0]);
      if (typeof stationID !== "number" || !Number.isSafeInteger(stationID) || stationID <= 0) {
        throwWrappedUserError("CustomNotify", { notify: "The station ID is invalid." });
      }
      return buildList(getLegacyIndustryBlueprintIDsForStation(stationID));
    });
  }

  Handle_get_blueprint_ids_for_all_stations(_args, session) {
    return readCatalog(session, () => buildDict([...getLegacyIndustryBlueprintIDsForAllStations()]
      .map(([stationID, ids]) => [stationID, buildList(ids)])));
  }
}

module.exports = StationConstructableManagerService;
