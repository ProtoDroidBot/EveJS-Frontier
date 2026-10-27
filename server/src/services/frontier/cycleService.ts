"use strict";
const BaseService = require("../baseService");
const progression = require("./progressionRuntime");
class CycleService extends BaseService {
  constructor() { super("cycleService"); }
  Handle_is_founder(_args, session) {
    const id = Number(session?.characterID || session?.charid || session?.charID);
    return Number.isSafeInteger(id) && id > 0 && progression.getRuntime().isFounder(id);
  }
}
module.exports = CycleService;
