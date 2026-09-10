"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function applyNpcWarpCompletionWakeDeadlineCommand(entity, deadlineMs) {
    entity.deferNpcWarpCompletionWakeUntilMs = deadlineMs;
}
module.exports = {
    applyNpcWarpCompletionWakeDeadlineCommand,
};
//# sourceMappingURL=npcWarpCompletion.js.map