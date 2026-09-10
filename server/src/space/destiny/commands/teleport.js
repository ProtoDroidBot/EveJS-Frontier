"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function applyTeleportRelocationMotionCommand(entity, point, options, cloneVector, normalizeVector) {
    entity.position = cloneVector(point, entity.position);
    entity.direction = normalizeVector(options.direction, entity.direction || { x: 1, y: 0, z: 0 });
}
function clearTeleportWarpCorrectionBroadcastCommand(entity) {
    entity.lastWarpCorrectionBroadcastAt = 0;
}
module.exports = {
    applyTeleportRelocationMotionCommand,
    clearTeleportWarpCorrectionBroadcastCommand,
};
//# sourceMappingURL=teleport.js.map