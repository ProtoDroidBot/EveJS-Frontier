"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function isFrontierProfile(compatibilityProfile) {
    return String(compatibilityProfile || "").trim().toLowerCase() === "frontier";
}
function buildDestinyConfigurationSettings(compatibilityProfile) {
    if (!isFrontierProfile(compatibilityProfile)) {
        return null;
    }
    return [
        false, // Separate ball IDs
        false, // Just-in-time collision structures
        false, // Convex collisions
    ];
}
function defersUndockBallparkStateUntilBeyonceBind(compatibilityProfile) {
    return isFrontierProfile(compatibilityProfile);
}
module.exports = {
    buildDestinyConfigurationSettings,
    defersUndockBallparkStateUntilBeyonceBind,
    isFrontierProfile,
};
//# sourceMappingURL=destinyCompatibility.js.map