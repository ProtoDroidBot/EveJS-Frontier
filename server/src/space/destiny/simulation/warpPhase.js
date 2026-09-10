"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Proper warp begins only after the authoritative pending alignment request is
// cleared. This predicate describes lifecycle and presentation phase only; it
// grants no additional simulation policy.
function isEntityInActiveWarp(entity) {
    return Boolean(entity &&
        String(entity.mode || "").trim().toUpperCase() === "WARP" &&
        !entity.pendingWarp &&
        String(entity.warpState && entity.warpState.nativeWarpCommand || "").trim().toUpperCase() !== "GOTO");
}
module.exports = {
    isEntityInActiveWarp,
};
//# sourceMappingURL=warpPhase.js.map