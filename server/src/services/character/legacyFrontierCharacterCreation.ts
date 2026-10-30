const characterCreationData = require("./characterCreationData");
const corporationState = require("../corporation/corporationState");
const worldData = require("../../space/worldData");
const { throwWrappedUserError } = require("../../common/machoErrors");
const nativeData = require("./legacyFrontierCharacterCreation2703993.json");

// Build 2703993 res:/staticdata/schools.fsdbinary, decoded with the native
// CPython 3.12 loader. SHA256:
// f9efef95b325b23865dd6e22a4e7d5880f601a3be6670aa80afc80b482082935
// All selectable empire schools have one authored starting station. Schools
// 23-25 have no station and no selectable empire bloodline; do not synthesize
// a starter location for them or fall back to classic EVE school data.
const SCHOOLS_2703993 = Object.freeze(Object.fromEntries(
  nativeData.schools.map(school => [school.schoolID, school]),
));

function unavailable() {
  throwWrappedUserError("CustomInfo", {
    info: "The selected Frontier character origin is unavailable.",
  });
}

function resolveLegacyFrontierCharacterCreation({ bloodlineID, raceID, schoolID }) {
  const school = SCHOOLS_2703993[schoolID];
  const ship = nativeData.starterShips[raceID];
  const bloodline = characterCreationData.getCharacterCreationBloodline(bloodlineID);
  const race = characterCreationData.getCharacterCreationRace(raceID);
  if (
    !school || school.raceID !== raceID || !ship ||
    !Array.isArray(school.startingStations) || school.startingStations.length !== 1 ||
    !bloodline || Number(bloodline.raceID) !== raceID ||
    !race || Number(race.shipTypeID) !== ship.starterShipTypeID
  ) unavailable();

  // The school station takes precedence over its corporation's home station.
  // Use actual world records: stationStaticData deliberately has a classic
  // fallback for unknown stations, which is unsuitable for character creation.
  const stationID = school.startingStations[0];
  const station = worldData.getStationByID(stationID);
  const system = station && worldData.getSolarSystemByID(station.solarSystemID);
  const corporation = corporationState.getCorporationRecord(school.corporationID);
  if (
    !station || Number(station.stationID) !== stationID ||
    !system || Number(system.solarSystemID) !== Number(station.solarSystemID) ||
    !corporation || Number(corporation.corporationID) !== school.corporationID ||
    !Number.isSafeInteger(Number(station.constellationID)) || Number(station.constellationID) <= 0 ||
    !Number.isSafeInteger(Number(station.regionID)) || Number(station.regionID) <= 0 ||
    Number(system.constellationID) !== Number(station.constellationID) ||
    Number(system.regionID) !== Number(station.regionID)
  ) unavailable();

  return {
    ...ship,
    starterLocation: {
      corporationID: school.corporationID,
      factionID: Number(corporation.factionID) || null,
      stationID,
      homeStationID: stationID,
      cloneStationID: stationID,
      solarSystemID: Number(station.solarSystemID),
      constellationID: Number(station.constellationID),
      regionID: Number(station.regionID),
    },
  };
}

module.exports = { resolveLegacyFrontierCharacterCreation };
