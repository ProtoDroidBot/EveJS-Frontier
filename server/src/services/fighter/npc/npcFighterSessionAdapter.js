"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
function hydrateNpcFighterEntity(entity, itemRecord) {
    const fighterRuntime = require(path.join(__dirname, "../fighterRuntime"));
    return fighterRuntime.hydrateFighterEntityFromItem(entity, itemRecord);
}
module.exports = {
    hydrateNpcFighterEntity,
};
//# sourceMappingURL=npcFighterSessionAdapter.js.map