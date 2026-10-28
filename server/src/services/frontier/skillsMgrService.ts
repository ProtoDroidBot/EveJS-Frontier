"use strict";
const BaseService = require("../baseService");
const progression = require("./progressionRuntime");
const id = session => Number(session?.characterID || session?.charid || session?.charID);

// Frontier's plural service is independent of legacy skillMgr training queues.
class SkillsMgrService extends BaseService {
  constructor() { super("skillsMgr"); }
  Handle_get_complexity_split(_args, session) { return progression.marshalSplit(progression.getRuntime().complexity(id(session))); }
  Handle_get_vault_complexity(_args, session) { return progression.marshalMap(progression.getRuntime().complexity(id(session)).vault, true); }
}
module.exports = SkillsMgrService;
