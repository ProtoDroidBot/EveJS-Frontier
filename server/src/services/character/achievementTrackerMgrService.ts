const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  buildDict,
} = require("../_shared/serviceHelpers");
const characterState = require("./characterState");
const { throwWrappedUserError, isMachoWrappedException } = require("../../common/machoErrors");
const { createTableRepository } = require("../../gameStore/tableRepository");
const { usesLegacyFrontierDogmaProfile } = require("../dogma/dogmaInfoCompatibility");
const MAX_FILETIME = (1n << 63n) - 1n;
const MAX_SAFE_COUNT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PROGRESS_ENTRIES = 10000;
let characterRepository;

function rejectProgress(info = "The achievement progress update is invalid."): never {
  throwWrappedUserError("CustomInfo", { info });
  throw new Error(info);
}

function unwrapInteger(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value) &&
      ["int", "long", "real"].includes(value.type)) {
    return value.value;
  }
  return value;
}

function integer(value, maximum, allowString = false) {
  value = unwrapInteger(value);
  let result;
  if (typeof value === "bigint") result = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) result = BigInt(value);
  else if (allowString && typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) result = BigInt(value);
  else return rejectProgress();
  if (result < 0n || result > maximum) return rejectProgress();
  return result;
}

function dictionaryEntries(value, stored = false) {
  let entries;
  if (value instanceof Map) entries = [...value.entries()];
  else if (value && value.type === "dict" && Array.isArray(value.entries)) entries = value.entries;
  else if (stored && Array.isArray(value)) entries = value;
  else if (value && typeof value === "object" && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    entries = Object.entries(value);
  } else return rejectProgress();
  if (entries.length > MAX_PROGRESS_ENTRIES || entries.some(entry => !Array.isArray(entry) || entry.length !== 2)) {
    return rejectProgress();
  }
  return entries;
}

function completedMap(value, stored = false): Map<number, string> {
  const result = new Map<number, string>();
  for (let [key, timestamp] of dictionaryEntries(value, stored)) {
    if (Buffer.isBuffer(key)) key = key.toString("utf8");
    const id = Number(integer(key, MAX_SAFE_COUNT, true));
    if (id <= 0 || result.has(id)) return rejectProgress();
    result.set(id, integer(timestamp, MAX_FILETIME, stored).toString());
  }
  return result;
}

function statisticMap(value, stored = false): Map<string, number> {
  const result = new Map<string, number>();
  for (let [key, count] of dictionaryEntries(value, stored)) {
    if (Buffer.isBuffer(key)) key = key.toString("utf8");
    if (typeof key !== "string" || !key.trim() || key.length > 256 || /[\x00-\x1f\x7f]/.test(key) || result.has(key)) {
      return rejectProgress();
    }
    result.set(key, Number(integer(count, MAX_SAFE_COUNT, stored)));
  }
  return result;
}

function progressSource(state, names) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  const key = names.find(name => Object.prototype.hasOwnProperty.call(state, name));
  return key === undefined ? undefined : state[key];
}

const EVENT_KEYS = ["eventDict", "eventCounts", "clientEventCounts"];
const COMPLETED_KEYS = ["completedDict", "completedAchievements"];

function hasProgress(state) {
  return progressSource(state, EVENT_KEYS) !== undefined || progressSource(state, COMPLETED_KEYS) !== undefined;
}

function selectedCharacter(session, required = false) {
  const values = [session?.characterID, session?.charID, session?.charid]
    .filter(value => value !== undefined && value !== null);
  const ids = values.map(value => Number(integer(value, MAX_SAFE_COUNT))).filter(id => id > 0);
  if (ids.length === 0) {
    if (required) rejectProgress("Achievement progress requires a selected character.");
    return null;
  }
  if (ids.some(id => id !== ids[0]) || session?._characterControlDisconnected === true || session?.socket?.destroyed) {
    return rejectProgress("Achievement progress requires a valid selected character session.");
  }
  const accountID = session?.userid === undefined || session?.userid === null
    ? 0 : Number(integer(session.userid, MAX_SAFE_COUNT));
  if (required && accountID <= 0) {
    return rejectProgress("Achievement progress requires an authenticated account.");
  }
  const record = characterState.getCharacterRecord(ids[0]);
  if (!record) return rejectProgress("The selected character is unavailable.");
  if (accountID > 0 && Number(record.accountId ?? record.accountID ?? record.userID ?? record.userid) !== accountID) {
    return rejectProgress("That character is not available on this account.");
  }
  return { characterID: ids[0], record };
}

function repository() {
  characterRepository ||= createTableRepository("service:character", { strict: true });
  return characterRepository;
}

const GOLDEN_LOGIN_EVENT_COUNT_ENTRIES = [
  ["client_activateAutopilot", 1n],
  ["client_activateSalvager", 0],
  ["client_orbitHostileNPC", 0],
  ["client_spinCamera", 1n],
  ["client_loadBlueprint", 0],
  ["client_openCorpFinder", 1n],
  ["client_lockHostileNPC", 0],
  ["client_lockAsteroid", 1n],
  ["client_openAgency", 0],
  ["client_orbitAsteroid", 0],
  ["client_openMap", 0],
  ["client_mouseZoom_out", 2n],
  ["client_lootItems", 0],
  ["client_jumpToNextSystemInRoute", 1n],
  ["client_moveItemFromCargoToHangar", 0],
  ["client_lookAtOwnShip", 1n],
  ["client_setDestination", 1n],
  ["client_chatMessageSent", 1n],
  ["client_lookAtObject", 0],
  ["client_mouseZoom_in", 1n],
  ["client_activateGun", 0],
  ["client_unfitItem", 1n],
  ["client_launchProbes", 0],
  ["client_bookmarkWormhole", 0],
  ["client_reachPerfectScanResult", 0],
  ["client_approach", 1n],
  ["client_doubleClickInSpace", 1n],
];

const GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES = [
  [9, 134273341290000000n],
  [10, 134273362100000000n],
  [16, 134273340850000000n],
  [17, 134275738980000000n],
  [19, 134273338030000000n],
  [23, 134273885480000000n],
  [24, 134273340010000000n],
  [25, 134275807650000000n],
  [26, 134275807630000000n],
  [32, 134275740590000000n],
  [38, 134273353790000000n],
  [44, 134273340760000000n],
  [45, 134273341230000000n],
  [46, 134273342370000000n],
  [47, 134275773470000000n],
  [48, 134275740590000000n],
  [49, 134275755390000000n],
  [50, 134276054820000000n],
  [53, 134273364720000000n],
  [57, 134275751230000000n],
  [60, 134273341380000000n],
  [61, 134273340480000000n],
  [64, 134273331600000000n],
  [66, 134273331580000000n],
  [72, 134275770810000000n],
  [73, 134275750180000000n],
];

function cloneEntries(entries) {
  return Array.isArray(entries)
    ? entries.map(([key, value]) => [key, value])
    : [];
}

function resolveAchievementState(session) {
  const selected = selectedCharacter(session);
  const persisted = selected?.record?.achievementState;
  // First-warp tracking deliberately keeps only a partial session cache.
  // Stored counter maps must win over that cache on subsequent reads.
  if (hasProgress(persisted)) return persisted;
  return session?.achievementState || persisted || null;
}

function extractOptionalBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0" || value === "") {
      return false;
    }
  }
  return null;
}

class AchievementTrackerMgrService extends BaseService {
  constructor(serviceName = "achievementTrackerMgr") {
    super(serviceName);
  }

  Handle_HasEverWarped(args, session) {
    void args;
    const characterID =
      Number(session && (session.characterID || session.charID || session.charid)) || 0;
    const explicitValue =
      extractOptionalBoolean(session && session.hasEverWarped) ??
      extractOptionalBoolean(session && session.everWarped) ??
      extractOptionalBoolean(
        session &&
          session.achievementState &&
          session.achievementState.hasEverWarped,
      );
    if (explicitValue !== null) {
      return explicitValue;
    }

    const characterRecord = characterID ? characterState.getCharacterRecord(characterID) : null;
    const persistedValue = extractOptionalBoolean(
      characterRecord &&
        characterRecord.achievementState &&
        characterRecord.achievementState.hasEverWarped,
    );
    return persistedValue ?? true;
  }

  Handle_GetCompletedAchievementsAndClientEventCount(args, session) {
    log.debug(
      "[AchievementTrackerMgr] GetCompletedAchievementsAndClientEventCount called",
    );
    const state = resolveAchievementState(session);
    const config = require("../../config");
    const emptyInitialState = this.name === "achievementTrackerMgr" &&
      usesLegacyFrontierDogmaProfile(session?.compatibilityProfile ?? config.clientCompatibilityProfile, Number(config.clientBuild));
    const actualProgress = hasProgress(state);
    const eventSource = progressSource(state, EVENT_KEYS);
    const completedSource = progressSource(state, COMPLETED_KEYS);
    const eventEntries = eventSource !== undefined
      ? [...statisticMap(eventSource, true)]
      : emptyInitialState || actualProgress ? [] : cloneEntries(GOLDEN_LOGIN_EVENT_COUNT_ENTRIES);
    const completedEntries = completedSource !== undefined
      ? [...completedMap(completedSource, true)].map(([id, time]) => [id, BigInt(time)])
      : emptyInitialState || actualProgress ? [] : cloneEntries(GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES);
    return buildDict([
      ["eventDict", buildDict(eventEntries)],
      ["completedDict", buildDict(completedEntries)],
    ]);
  }

  Handle_UpdateClientAchievmentsAndCounters(args, session) {
    log.debug(
      "[AchievementTrackerMgr] UpdateClientAchievmentsAndCounters called",
    );
    if (!Array.isArray(args) || args.length !== 2) return rejectProgress();
    // Native uploads contain cumulative absolute totals, not increments.
    // Validate both complete dictionaries before preparing any mutation.
    const incomingCompleted = completedMap(args[0]);
    const incomingStatistics = statisticMap(args[1]);
    const selected = selectedCharacter(session, true);
    let nextState;
    try {
      const repo = repository();
      const read = repo.read("characters", `/${selected.characterID}`);
      const raw = read.success && read.data;
      if (!raw || Number(raw.accountId ?? raw.accountID ?? raw.userID ?? raw.userid) !==
          Number(selected.record.accountId ?? selected.record.accountID ?? selected.record.userID ?? selected.record.userid)) {
        return rejectProgress("The selected character changed while saving achievement progress.");
      }
      if (raw.achievementState !== undefined && raw.achievementState !== null &&
          (typeof raw.achievementState !== "object" || Array.isArray(raw.achievementState))) return rejectProgress();
      const state = raw.achievementState || {};
      const completedSource = progressSource(state, COMPLETED_KEYS);
      const statisticSource = progressSource(state, EVENT_KEYS);
      const completed = completedMap(completedSource === undefined ? {} : completedSource, true);
      const statistics = statisticMap(statisticSource === undefined ? {} : statisticSource, true);
      for (const [id, time] of incomingCompleted) if (!completed.has(id)) completed.set(id, time);
      for (const [name, count] of incomingStatistics) statistics.set(name, Math.max(statistics.get(name) ?? 0, count));
      if (completed.size > MAX_PROGRESS_ENTRIES || statistics.size > MAX_PROGRESS_ENTRIES) return rejectProgress();
      nextState = {
        ...state,
        completedDict: Object.fromEntries([...completed].sort(([a], [b]) => a - b)),
        eventDict: Object.fromEntries([...statistics].sort(([a], [b]) => a.localeCompare(b))),
      };
      const proposal = repo.prepareAtomicRowWrite("characters", String(selected.characterID), {
        ...raw, achievementState: nextState,
      });
      const committed = repo.commitAtomicRowWrites([proposal]);
      if (!committed?.success) return rejectProgress("Achievement progress could not be saved. Please try again.");
    } catch (error) {
      if (isMachoWrappedException(error)) throw error;
      return rejectProgress("Achievement progress could not be saved. Please try again.");
    }
    // Only publish the warm session cache after SQLite and the shared record
    // cache have committed. Failed saves leave both progress views unchanged.
    session.achievementState = JSON.parse(JSON.stringify(nextState));
    return null;
  }
}

AchievementTrackerMgrService._testing = {
  GOLDEN_LOGIN_EVENT_COUNT_ENTRIES,
  GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES,
};

module.exports = AchievementTrackerMgrService;
