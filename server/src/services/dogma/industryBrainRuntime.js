"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const { buildCharacterBrainGrayMatter, buildCharacterBrainUpdatePayload, syncCharacterDogmaBrain, syncCharacterDogmaState, } = require(path.join(__dirname, "./brain/characterBrainRuntime"));
const { buildIndustryAttributeChangePayloads, resolveCharacterIndustryAttributes, syncIndustryCharacterModifiers, } = require(path.join(__dirname, "./brain/providers/industryBrainProvider"));
module.exports = {
    buildIndustryAttributeChangePayloads,
    buildIndustryBrainGrayMatter: buildCharacterBrainGrayMatter,
    buildIndustryBrainUpdatePayload: buildCharacterBrainUpdatePayload,
    resolveCharacterIndustryAttributes,
    syncIndustryCharacterDogmaBrain: syncCharacterDogmaBrain,
    syncIndustryCharacterDogmaState: syncCharacterDogmaState,
    syncIndustryCharacterModifiers,
};
//# sourceMappingURL=industryBrainRuntime.js.map