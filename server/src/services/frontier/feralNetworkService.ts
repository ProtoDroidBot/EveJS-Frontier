"use strict";
const BaseService = require("../baseService");
const { throwWrappedUserError } = require("../../common/machoErrors");
class FeralNetworkService extends BaseService {
  declare runtime: any;
  constructor(runtime = null) { super("feralnetwork"); this.runtime = runtime; }
  Handle_sell_feral_data(args, session, kwargs: Record<string, any> = {}) {
    try {
      const runtime = this.runtime || require("./frontierEconomyRuntime").getFrontierEconomyRuntime();
      const keyword = kwargs && kwargs.type === "dict" ? Object.fromEntries(kwargs.entries) : kwargs;
      runtime.sellFeralData({ userID: Number(session.userid), characterID: Number(session.characterID || session.charid),
        currentSystemID: Number(session._space?.systemID || session.solarsystemid2), session }, args[0], keyword.item_id ?? args[1], keyword.quantity ?? args[2]);
      return null;
    } catch (error) { return throwWrappedUserError("CustomNotify", { notify: String(error.code || error.message) }); }
  }
}
module.exports = FeralNetworkService;
