"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function normalizeCharacterGender(value, fallback = 1) {
    const numeric = Number(value);
    return numeric === 0 || numeric === 1 || numeric === 2
        ? numeric
        : fallback;
}
module.exports = {
    normalizeCharacterGender,
};
//# sourceMappingURL=characterIdentity.js.map