"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let activeIncursions = [];
function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}
function listActiveIncursions() {
    return cloneValue(activeIncursions);
}
function replaceActiveIncursions(incursions = []) {
    activeIncursions = Array.isArray(incursions) ? cloneValue(incursions) : [];
}
function resetForTests() {
    activeIncursions = [];
}
module.exports = {
    listActiveIncursions,
    replaceActiveIncursions,
    _testing: {
        resetForTests,
    },
};
//# sourceMappingURL=incursionRuntime.js.map