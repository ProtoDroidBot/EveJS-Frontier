"use strict";
function identity(session) {
  const userID = Number(session?.userid || session?.userID || session?.accountId);
  const characterID = Number(session?.characterID || session?.charid);
  return Number.isSafeInteger(userID) && userID > 0 && Number.isSafeInteger(characterID) && characterID > 0 ? { userID, characterID } : null;
}
function commit(session, systemID, observation) {
  if (Number(require("../../config").clientBuild) !== 3640684 || !process.env.EVEJS_EXPLORATION_WORLD_PATH) return false;
  const actor = identity(session); if (!actor || !Object.keys(observation).length) return false;
  try { require("./explorationRuntime").getExplorationRuntime().recordScanDiscovery(actor, Number(systemID), observation); return true; }
  catch (error) { require("../../utils/logger").warn(`[Exploration] Scan discovery could not be saved: ${error.message}`); return false; }
}
function directionalObservation(scan) {
  const observation = {};
  for (const contact of scan?.updatedScans || []) {
    const signatures = contact.signatureResults || contact.signature_results || contact[6] || [];
    for (const signature of signatures) {
      const type = Number(signature.signatureType ?? signature.signature_type ?? signature[0]);
      const strength = Number(signature.signature ?? signature[1]);
      const noise = Number(signature.noiseLevel ?? signature.noise_level ?? signature[2]);
      const channel = type === 4 ? "thermal" : type === 3 ? "em" : null;
      if (!channel || !Number.isFinite(strength) || strength <= 0 || !Number.isFinite(noise) || noise < 0) continue;
      const level = noise === 0 || strength / noise >= 1 ? "resolved" : "detected";
      if (observation[channel] !== "resolved") observation[channel] = level;
    }
  }
  return observation;
}
function remoteObservation(result) {
  const observation = {};
  for (const cell of result?.heatMapCells || []) for (const [source, channel] of [["thermal", "thermal"], ["electromagnetic", "em"]]) {
    const signal = Number(cell.channels?.[source]);
    if (!Number.isFinite(signal) || signal <= 0) continue;
    const level = ["identified", "deep"].includes(cell.resolutionTier) ? "resolved" : "detected";
    if (observation[channel] !== "resolved") observation[channel] = level;
  }
  return observation;
}
module.exports = { identity, directionalObservation, remoteObservation,
  recordDirectionalScan: (session, scan) => commit(session, Number(session?._space?.systemID || session?.solarsystemid2 || session?.solarSystemID), directionalObservation(scan)),
  recordRemoteScan: (session, result) => commit(session, result?.targetSystemID, remoteObservation(result)) };
