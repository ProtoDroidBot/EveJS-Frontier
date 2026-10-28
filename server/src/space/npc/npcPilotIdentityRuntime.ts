import { getNpcPilotIdentityStore, type NpcPilotIdentity } from "./npcPilotIdentityStore";
import { deriveLocalNpcFactionSuiWalletAddress } from "../../services/frontier/suiNpcCharacterProvisioning";

const config = require("../../config");
const factionWallets = new Map<string, string>();

export function npcPilotIdentitiesEnabled() {
  return config.clientCompatibilityProfile === "frontier" && config.npcPilotIdentitiesEnabled !== false;
}

/** These are NPC metadata, not human inventory/session character identifiers. */
export function applyNpcPilotIdentity(target: Record<string, any>, pilot: NpcPilotIdentity) {
  let wallet = pilot.sui?.walletAddress || pilot.sui?.identity?.walletAddress;
  if (!wallet) {
    wallet = factionWallets.get(pilot.factionKey);
    if (!wallet) {
      wallet = deriveLocalNpcFactionSuiWalletAddress(pilot.factionKey);
      factionWallets.set(pilot.factionKey, wallet);
    }
  }
  Object.assign(target, {
    npcCharacterID: pilot.characterID,
    npcIdentitySlot: pilot.identitySlot,
    npcFactionIdentityKey: pilot.factionKey,
    npcIncarnation: pilot.incarnation,
    npcSuiWalletAddress: wallet,
    npcSuiCharacterObjectID: pilot.sui?.characterObjectId || pilot.sui?.identity?.characterObjectId || null,
    npcSuiPlayerProfileObjectID: pilot.sui?.playerProfileObjectId || null,
    npcSuiNpcProfileObjectID: pilot.sui?.npcProfileObjectId || null,
    npcSuiStatus: pilot.sui?.status || "pending",
  });
  return target;
}

export function ensureNpcPilotIdentity(record: Record<string, any>, identitySlot?: string) {
  if (!npcPilotIdentitiesEnabled()) return false;
  const store = getNpcPilotIdentityStore();
  if (record.npcCharacterID) {
    const existing = store.get(record.npcCharacterID);
    if (!existing || existing.activeEntityID !== record.entityID) {
      throw new Error(`NPC ${record.entityID} references a missing or reassigned pilot`);
    }
    applyNpcPilotIdentity(record, existing);
    return false;
  }
  const pilot = store.acquire({
    entityID: record.entityID,
    systemID: record.systemID,
    factionID: record.warFactionID,
    factionStringOnlyID: record.npcFactionKey,
    characterName: record.itemName,
    profileID: record.profileID,
    identitySlot: identitySlot || record.npcIdentitySlot,
  });
  applyNpcPilotIdentity(record, pilot);
  return true;
}
