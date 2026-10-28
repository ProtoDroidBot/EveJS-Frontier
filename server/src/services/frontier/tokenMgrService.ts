const BaseService = require("../baseService");
const { throwWrappedUserError } = require("../../common/machoErrors");
const { evmAddress } = require("./legacyEvmAuthorization");

function unavailable(error): never {
  const reason = String(error?.code || "LEGACY_PROXY_OPERATION_UNAVAILABLE");
  throwWrappedUserError("CustomNotify", {
    notify: /AUTHENTICATION|IDENTITY|ACCESS_DENIED/.test(reason)
      ? "Log into the character that owns this wallet before using the blockchain connection."
      : "The legacy blockchain adapter could not complete this action. Check its server configuration.",
  });
  throw error;
}

/** The exact native tokenMgr calls consumed by build 2455427. */
class TokenMgrService extends BaseService {
  declare bridge: any;
  constructor(options: Record<string, any> = {}) {
    super("tokenMgr");
    this.bridge = options.bridge;
  }
  _bridge() {
    return this.bridge || require("./legacyEvmSuiBridge").getLegacyEvmSuiBridge();
  }
  async Handle_blockchain_connection(_args, session) {
    try {
      const bridge = this._bridge();
      if (typeof bridge.getProxyConfiguration !== "function") throw new Error("Legacy proxy is unavailable");
      const configuration = await bridge.getProxyConfiguration(session);
      if (!configuration?.smart_contracts || !configuration?.well_known_addresses) throw new Error("Legacy proxy configuration is incomplete");
      // This native return value is only an enable/disable toggle. The exact
      // client patch redirects its otherwise fixed external host to loopback.
      return true;
    } catch (error) { return unavailable(error); }
  }
  async Handle_associate_character_with_address(args, session) {
    try {
      const bridge = this._bridge();
      const address = evmAddress(args?.[0]);
      if (typeof bridge.associateProxyCharacter !== "function") throw new Error("Wallet association is unavailable");
      const result = await bridge.associateProxyCharacter(session, address);
      if (result?.success !== true) throw new Error("Wallet association failed");
      return true;
    } catch (error) { return unavailable(error); }
  }
  Handle_buy_helium(_args, _session) { return unavailable({ code: "LEGACY_PROXY_CURRENCY_UNSUPPORTED" }); }
  Handle_activate_license(_args, _session) { return unavailable({ code: "LEGACY_PROXY_LICENSE_UNSUPPORTED" }); }
}

module.exports = TokenMgrService;
