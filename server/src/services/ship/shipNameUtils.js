"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SHIP_NAME_MAX_LENGTH = 32;
function normalizeShipNameLabel(value) {
    return String(value ?? "")
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(0, SHIP_NAME_MAX_LENGTH)
        .trim();
}
module.exports = {
    SHIP_NAME_MAX_LENGTH,
    normalizeShipNameLabel,
};
//# sourceMappingURL=shipNameUtils.js.map