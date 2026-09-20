"use strict";

// Permanent native-NPC pilot IDs share the world's game-character namespace.
// Keep this interval below the item allocator's floor and within signed 32-bit
// clients' positive integer range. Human character allocation must skip it.
export const NPC_CHARACTER_ID_MIN = 1_500_000_000;
export const NPC_CHARACTER_ID_MAX = 1_599_999_999;

export function isNpcCharacterID(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) &&
    id >= NPC_CHARACTER_ID_MIN && id <= NPC_CHARACTER_ID_MAX;
}
