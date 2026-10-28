"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const IMAGE_ROOT = path.join(__dirname, "../../_secondary/image");
const GENERATED_ROOT = path.join(IMAGE_ROOT, "generated");
const FACTION_ROOT = path.join(GENERATED_ROOT, "Faction");
const FACTION_IMAGE_SIZES = Object.freeze([32, 64, 128, 256, 512, 1024]);
const DEFAULT_FACTION_LOGO_PATH = path.join(IMAGE_ROOT, "images", "alliance-default.png");
function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
function getFactionLogoFilePath(factionID, size) {
    const numericFactionID = toNumber(factionID, 0);
    const numericSize = toNumber(size, 0);
    return path.join(FACTION_ROOT, `${numericFactionID}_${numericSize}.png`);
}
function listFactionLogoPaths(factionID) {
    const numericFactionID = toNumber(factionID, 0);
    return FACTION_IMAGE_SIZES.map((size) => ({
        size,
        filePath: getFactionLogoFilePath(numericFactionID, size),
    }));
}
function findFactionLogoPath(factionID, size = null) {
    const numericFactionID = toNumber(factionID, 0);
    if (numericFactionID <= 0) {
        return null;
    }
    if (size !== null && size !== undefined) {
        const exactPath = getFactionLogoFilePath(numericFactionID, size);
        if (fs.existsSync(exactPath)) {
            return exactPath;
        }
    }
    for (const { filePath } of listFactionLogoPaths(numericFactionID)) {
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}
async function findFactionLogoPathAsync(factionID, size = null) {
    const numericFactionID = toNumber(factionID, 0);
    if (numericFactionID <= 0)
        return null;
    const candidates = [];
    if (size !== null && size !== undefined) {
        candidates.push(getFactionLogoFilePath(numericFactionID, size));
    }
    candidates.push(...listFactionLogoPaths(numericFactionID).map(({ filePath }) => filePath));
    for (const candidate of candidates) {
        try {
            const stat = await fs.promises.stat(candidate);
            if (stat.isFile())
                return candidate;
        }
        catch (error) {
            if (!(error && error.code === "ENOENT"))
                throw error;
        }
    }
    return null;
}
module.exports = {
    DEFAULT_FACTION_LOGO_PATH,
    FACTION_IMAGE_SIZES,
    FACTION_ROOT,
    ensureDirectory,
    findFactionLogoPath,
    findFactionLogoPathAsync,
    getFactionLogoFilePath,
    listFactionLogoPaths,
};
//# sourceMappingURL=factionImageStore.js.map