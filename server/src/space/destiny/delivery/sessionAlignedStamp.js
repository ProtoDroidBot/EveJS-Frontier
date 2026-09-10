"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function createSessionAlignmentAdapter(options) {
    const resolveSessionAlignedStamp = options && typeof options.resolveSessionAlignedStamp === "function"
        ? options.resolveSessionAlignedStamp
        : null;
    return {
        resolveSessionAlignedStamp,
    };
}
module.exports = {
    createSessionAlignmentAdapter,
};
//# sourceMappingURL=sessionAlignedStamp.js.map