"use strict";
const catalog = require("./progressionCatalog3640684.json");

// frontier/skills/common/factor.pyc: bonus_at = scale*100*log1p(C/H)/log1p(Cref/H).
function buildProgressionDogma(split) {
  const direct = [], sources = [], attributes = {};
  for (const skill of catalog.skills) {
    const complexity = Number(split?.inherited?.[skill.skill_id] || 0) + Number(split?.acquired?.[skill.skill_id] || 0);
    if (!Number.isFinite(complexity) || complexity <= 0) continue;
    const factor = Math.log1p(complexity / catalog.constants.complexityH) / Math.log1p(catalog.constants.complexityReference / catalog.constants.complexityH);
    attributes[skill.complexity_attribute_id] = complexity;
    const sourceAttributes = {}, modifiers = [];
    for (const effect of skill.effects) {
      const value = effect.scale * 100 * factor;
      attributes[effect.bonus_attribute_id] = value;
      if (effect.func === "ItemModifier") direct.push({ sourceKind: "frontier-skill", modifiedAttributeID: effect.attribute_id, operation: 6, value, stackingPenalized: false });
      else {
        sourceAttributes[effect.bonus_attribute_id] = value;
        modifiers.push({ func: effect.func, domain: "shipID", operation: 6, modifyingAttributeID: effect.bonus_attribute_id, modifiedAttributeID: effect.attribute_id, ...(effect.group_id ? { groupID: effect.group_id } : {}) });
      }
    }
    if (modifiers.length) sources.push({ sourceKind: "skill", frontierProgression: true, sourceTypeID: 0, sourceAttributes, sourceEffects: [{ effectID: skill.effect_id, modifierInfo: modifiers }] });
  }
  return { direct, sources, attributes };
}
function getProgressionDogma(characterID) {
  if (Number(require("../../config").clientBuild) !== 3640684 || !Number.isSafeInteger(Number(characterID)) || Number(characterID) <= 0) return { direct: [], sources: [], attributes: {} };
  if (!require("./shellEquipmentRuntime").getActiveShell(Number(characterID))) return { direct: [], sources: [], attributes: {} };
  return buildProgressionDogma(require("./progressionRuntime").getRuntime().complexity(Number(characterID)));
}
module.exports = { buildProgressionDogma, getProgressionDogma };
