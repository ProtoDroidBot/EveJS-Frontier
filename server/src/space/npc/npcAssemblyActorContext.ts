"use strict";

const { getNpcPilotIdentityStore } = require("./npcPilotIdentityStore");

const SENSITIVE_FIELD = /(?:private.?key|secret|seed|mnemonic|passphrase|transponder(?:.?code|.?secret)?|raw.?code|membership.?receipt|receipt.?token)/i;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, label) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return numeric;
}

function optionalU32(value, label) {
  const numeric = Number(value || 0);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xffffffff) {
    throw new Error(`${label} must fit an unsigned 32-bit integer`);
  }
  return numeric;
}

function publicString(value, label, pattern = null) {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || pattern && !pattern.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

/** Reject secrets before a value can enter the durable job or assembly metadata. */
function assertNoSensitiveNpcAssemblyData(value, path = "payload", seen = new Set()) {
  if (value == null || typeof value !== "object") return true;
  if (seen.has(value)) throw new Error("NPC_ASSEMBLY_PAYLOAD_CYCLIC");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key)) {
      throw Object.assign(new Error(`Sensitive field ${path}.${key} cannot be persisted`), {
        code: "NPC_ASSEMBLY_SECRET_FORBIDDEN",
      });
    }
    assertNoSensitiveNpcAssemblyData(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return true;
}

function normalizeNpcAssemblyActorContext(input, options: Record<string, any> = {}) {
  if (!input || typeof input !== "object" || input.kind !== "npc") {
    throw Object.assign(new Error("NPC assembly actor context is required"), {
      code: "NPC_ASSEMBLY_ACTOR_INVALID",
    });
  }
  assertNoSensitiveNpcAssemblyData(input, "actor");
  const factionKey = publicString(
    input.factionKey,
    "NPC faction key",
    /^(0|[1-9][0-9]*)-[a-z0-9][a-z0-9_-]{0,95}$/,
  ).toLowerCase();
  const actor = {
    kind: "npc",
    actorID: positiveInt(input.actorID, "NPC actor ID"),
    ownerPrincipalID: positiveInt(input.ownerPrincipalID, "NPC owner principal ID"),
    factionID: optionalU32(input.factionID, "NPC faction ID"),
    factionKey,
    shipID: positiveInt(input.shipID, "NPC ship ID"),
    solarSystemID: positiveInt(input.solarSystemID, "NPC solar system ID"),
    suiProfileObjectID: input.suiProfileObjectID
      ? publicString(input.suiProfileObjectID, "NPC Sui profile object ID")
      : null,
    suiWalletAddress: input.suiWalletAddress
      ? publicString(input.suiWalletAddress, "NPC Sui wallet address")
      : null,
  };
  if (actor.ownerPrincipalID !== actor.actorID) {
    throw Object.assign(new Error("NPC assemblies must use the durable NPC character as owner principal"), {
      code: "NPC_ASSEMBLY_OWNER_INVALID",
    });
  }
  if (options.requireSui === true && (!actor.suiProfileObjectID || !actor.suiWalletAddress)) {
    throw Object.assign(new Error("Confirmed NPC Sui profile is required for a smart assembly"), {
      code: "NPC_SUI_PROFILE_REQUIRED",
    });
  }
  return Object.freeze(actor);
}

function createNpcAssemblyActorContext(entityRecord, options: Record<string, any> = {}) {
  if (!entityRecord || entityRecord.transient === true) {
    throw Object.assign(new Error("A durable NPC entity is required"), {
      code: "NPC_DURABLE_ENTITY_NOT_FOUND",
    });
  }
  const actorID = positiveInt(entityRecord.npcCharacterID, "NPC character ID");
  const pilot = getNpcPilotIdentityStore().get(actorID);
  if (!pilot || Number(pilot.activeEntityID) !== Number(entityRecord.entityID) ||
      Number(pilot.incarnation) !== Number(entityRecord.npcIncarnation)) {
    throw Object.assign(new Error("NPC pilot identity does not match the active ship"), {
      code: "NPC_ASSEMBLY_IDENTITY_STALE",
    });
  }
  if (options.requireSui === true && pilot.sui?.status !== "confirmed") {
    throw Object.assign(new Error("NPC Sui identity has not been confirmed"), {
      code: "NPC_SUI_PROFILE_PENDING",
    });
  }
  return normalizeNpcAssemblyActorContext({
    kind: "npc",
    actorID,
    ownerPrincipalID: actorID,
    factionID: pilot.factionID,
    factionKey: pilot.factionKey,
    shipID: entityRecord.entityID,
    solarSystemID: entityRecord.systemID,
    suiProfileObjectID:
      pilot.sui?.npcProfileObjectId || entityRecord.npcSuiNpcProfileObjectID || null,
    suiWalletAddress:
      pilot.sui?.walletAddress || pilot.sui?.identity?.walletAddress ||
      entityRecord.npcSuiWalletAddress || null,
  }, options);
}

function publicNpcAssemblyOperator(actor) {
  const normalized = normalizeNpcAssemblyActorContext(actor);
  return cloneValue({
    kind: normalized.kind,
    actorID: normalized.actorID,
    ownerPrincipalID: normalized.ownerPrincipalID,
    factionID: normalized.factionID,
    factionKey: normalized.factionKey,
    shipID: normalized.shipID,
    solarSystemID: normalized.solarSystemID,
    suiProfileObjectID: normalized.suiProfileObjectID,
    suiWalletAddress: normalized.suiWalletAddress,
  });
}

module.exports = {
  assertNoSensitiveNpcAssemblyData,
  normalizeNpcAssemblyActorContext,
  createNpcAssemblyActorContext,
  publicNpcAssemblyOperator,
  _testing: { SENSITIVE_FIELD },
};
