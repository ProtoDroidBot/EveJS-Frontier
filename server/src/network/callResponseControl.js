"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const DEFERRED_CALL_RESPONSE = Symbol.for("evejs.deferredCallResponse");
function buildDeferredCallResponse(start, options = {}) {
    return {
        [DEFERRED_CALL_RESPONSE]: true,
        start: typeof start === "function" ? start : null,
        reason: options.reason || "deferred",
    };
}
function isDeferredCallResponse(value) {
    return Boolean(value && value[DEFERRED_CALL_RESPONSE] === true);
}
module.exports = {
    buildDeferredCallResponse,
    isDeferredCallResponse,
};
//# sourceMappingURL=callResponseControl.js.map