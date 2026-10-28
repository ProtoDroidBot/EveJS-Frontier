"use strict";

const path = require("path");

const npcFactionConfig = require(path.join(__dirname, "../../config/npcFactionConfig"));

const trustResolvers = new Set<any>();

function toPositiveInt(value) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : 0;
}

function normalizeFactionKey(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^(0|[1-9][0-9]*)-[a-z0-9][a-z0-9_-]{0,95}$/u.test(text)
    ? text
    : null;
}

function normalizeIDSet(value) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map(toPositiveInt)
      .filter(Boolean),
  );
}

function authoredTrustPolicy(entityRecord) {
  const policy = entityRecord && entityRecord.npcFittingTrust;
  const source = policy && typeof policy === "object" && !Array.isArray(policy)
    ? policy
    : {};
  return {
    trustedCharacterIDs: normalizeIDSet(
      source.trustedCharacterIDs ?? entityRecord?.trustedFitterCharacterIDs,
    ),
    deniedCharacterIDs: normalizeIDSet(
      source.deniedCharacterIDs ?? entityRecord?.deniedFitterCharacterIDs,
    ),
  };
}

function matchesNpcFaction(entityRecord, actor) {
  const npcFactionID = toPositiveInt(npcFactionConfig.resolveNpcFactionID(entityRecord));
  const actorFactionID = toPositiveInt(actor && actor.factionID);
  if (npcFactionID && actorFactionID) return npcFactionID === actorFactionID;

  const npcFactionKey = normalizeFactionKey(
    npcFactionConfig.resolveNpcFactionKey(entityRecord),
  );
  const actorFactionKey = normalizeFactionKey(actor && actor.factionKey);
  return Boolean(npcFactionKey && actorFactionKey && npcFactionKey === actorFactionKey);
}

function matchesNpcAlliedFaction(entityRecord, actor) {
  const actorFactionKey = npcFactionConfig.resolveNpcFactionCanonicalKey(actor);
  if (!actorFactionKey) return false;
  const diplomacy = npcFactionConfig.resolveNpcFactionDiplomacy(entityRecord);
  return Array.isArray(diplomacy?.allies) && diplomacy.allies.some(
    (ally) => ally?.factionKey === actorFactionKey,
  );
}

function normalizeResolverVerdict(verdict) {
  if (verdict === true) return { trusted: true, reason: "behavior-trust" };
  if (verdict === false) return { trusted: false, reason: "behavior-distrust" };
  if (!verdict || typeof verdict !== "object") return null;
  if (verdict.trusted !== true && verdict.trusted !== false) return null;
  return {
    trusted: verdict.trusted === true,
    reason: String(verdict.reason || (
      verdict.trusted ? "behavior-trust" : "behavior-distrust"
    )),
  };
}

/**
 * Phase 1 trust is intentionally small and fail-closed. Future behavior-tree
 * standing/reputation logic can register a resolver without weakening the RPC
 * boundary or teaching the client to decide whether an NPC trusts the actor.
 */
function evaluateNpcFittingTrust(entityRecord, actor, context: Record<string, any> = {}) {
  const characterID = toPositiveInt(actor && actor.characterID);
  if (!entityRecord || !characterID) {
    return { trusted: false, reason: "identity-required" };
  }

  const authored = authoredTrustPolicy(entityRecord);
  if (authored.deniedCharacterIDs.has(characterID)) {
    return { trusted: false, reason: "authored-deny" };
  }
  if (authored.trustedCharacterIDs.has(characterID)) {
    return { trusted: true, reason: "authored-character" };
  }

  for (const resolver of trustResolvers) {
    let verdict = null;
    try {
      verdict = normalizeResolverVerdict(resolver(entityRecord, actor, context));
    } catch (_) {
      verdict = null;
    }
    if (verdict) return verdict;
  }
  if (matchesNpcFaction(entityRecord, actor)) {
    return { trusted: true, reason: "same-faction" };
  }
  // Configured alliances use the server-authenticated player faction, not a
  // shareable IFF code.
  if (matchesNpcAlliedFaction(entityRecord, actor)) {
    return { trusted: true, reason: "allied-faction" };
  }
  // Explicit Localnet debug switch: the caller has already passed the live
  // same-system and 5 km check. Never bypass an authored character denial.
  if (npcFactionConfig.getConfig().debugFittingTrust.allowNearbyPlayers &&
      context.interaction?.shipEntity && context.interaction?.npcEntity) {
    return { trusted: true, reason: "debug-nearby-player" };
  }
  return { trusted: false, reason: "no-positive-trust" };
}

function registerNpcFittingTrustResolver(resolver) {
  if (typeof resolver !== "function") {
    throw new TypeError("NPC fitting trust resolver must be a function");
  }
  trustResolvers.add(resolver);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    trustResolvers.delete(resolver);
  };
}

module.exports = {
  evaluateNpcFittingTrust,
  registerNpcFittingTrustResolver,
  _testing: {
    authoredTrustPolicy,
    matchesNpcFaction,
    matchesNpcAlliedFaction,
    resetTrustResolvers() {
      trustResolvers.clear();
    },
  },
};
