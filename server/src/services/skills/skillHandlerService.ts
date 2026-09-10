const SkillMgrService = require("./skillMgrService");

class SkillHandlerService extends SkillMgrService {
  declare _name: any;

  constructor() {
    super();
    this._name = "skillHandler";
  }
}

module.exports = SkillHandlerService;
