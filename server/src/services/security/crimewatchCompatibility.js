"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function usesLegacyCombatTimerShape(compatibilityProfile) {
    return String(compatibilityProfile || "").trim().toLowerCase() === "frontier";
}
function normalizeCombatTimersForProfile(combatTimers, compatibilityProfile) {
    if (usesLegacyCombatTimerShape(compatibilityProfile) &&
        Array.isArray(combatTimers)) {
        return combatTimers.slice(0, 4);
    }
    return combatTimers;
}
module.exports = {
    normalizeCombatTimersForProfile,
    usesLegacyCombatTimerShape,
};
//# sourceMappingURL=crimewatchCompatibility.js.map