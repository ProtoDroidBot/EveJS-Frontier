const BaseService = require("../baseService");
const { buildDict, buildList, unwrapMarshalValue } = require("../_shared/serviceHelpers");
const { throwWrappedUserError } = require("../../common/machoErrors");

function marshalConfiguration(value) {
  if (Array.isArray(value)) return buildList(value.map(marshalConfiguration));
  if (value && typeof value === "object") {
    return buildDict(Object.entries<any>(value).map(([key, entry]) => [key, marshalConfiguration(entry)]));
  }
  return value;
}

function unavailable(error): never {
  const code = String(error?.code || "");
  const authentication = /AUTHENTICATION|IDENTITY|ACCESS_DENIED/.test(code);
  throwWrappedUserError("CustomNotify", {
    notify: authentication
      ? "An authenticated session for this character is required to use the EVM-to-Sui bridge."
      : "The EVM-to-Sui bridge is unavailable. Check the server bridge configuration.",
  });
  throw error;
}

/** Wallet/configuration RPCs consumed by the packaged EVM clients. */
class EncryptionWalletService extends BaseService {
  declare bridge: any;

  constructor(options: Record<string, any> = {}) {
    super("encryptionWalletService");
    this.bridge = options.bridge;
  }

  _configuration(session) {
    const bridge = this.bridge || require("./legacyEvmSuiBridge").getLegacyEvmSuiBridge();
    const configuration = bridge.getClientConfiguration(session);
    if (!configuration || typeof configuration !== "object") {
      throw Object.assign(new Error("Bridge configuration is unavailable"), { code: "LEGACY_EVM_CONFIG_UNAVAILABLE" });
    }
    return configuration;
  }

  _bridge() {
    return this.bridge || require("./legacyEvmSuiBridge").getLegacyEvmSuiBridge();
  }

  async Handle_create_smart_character(args, session) {
    try {
      const values = unwrapMarshalValue(args);
      const first = values?.[0];
      const request = first?.meta_tx ? first : { meta_tx: first, signature: values?.[1] };
      const result = await this._bridge().createSmartCharacter(session, request);
      return result?.success === true;
    } catch (error) { return unavailable(error); }
  }

  async Handle_encrypt_recovery(args, session) {
    try {
      const values = unwrapMarshalValue(args);
      return await this._bridge().encryptRecovery(session, values?.[0], values?.[1]);
    } catch (error) { return unavailable(error); }
  }

  async Handle_decrypt_recovery(args, session) {
    try {
      const values = unwrapMarshalValue(args);
      return await this._bridge().decryptRecovery(session, values?.[0], values?.[1]);
    } catch (error) { return unavailable(error); }
  }

  Handle_get_web3_config(_args, session) {
    try {
      const configuration = this._configuration(session).web3Config;
      if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
        throw new Error("Bridge Web3 configuration is unavailable");
      }
      // The client JSON-serializes cfg for the native ContractMgr. Preserve
      // its list/dictionary structure and the ABI signature strings exactly.
      return marshalConfiguration(configuration);
    } catch (error) { return unavailable(error); }
  }

  _stringConfiguration(session, field) {
    try {
      const value = this._configuration(session)[field];
      if (typeof value !== "string" || !value.trim()) throw new Error("Bridge configuration is unavailable");
      return value;
    } catch (error) { return unavailable(error); }
  }

  Handle_get_chain_tenant(_args, session) {
    return this._stringConfiguration(session, "tenant");
  }

  Handle_get_world_api_base_url(_args, session) {
    return this._stringConfiguration(session, "worldApiBaseUrl");
  }

  Handle_get_wallet_passphrase(args, session) {
    const requestedCharacter = Number(args?.[0]);
    const activeCharacter = Number(session?.characterID || session?.charid);
    if (!Number.isSafeInteger(requestedCharacter) || requestedCharacter <= 0 ||
        requestedCharacter !== activeCharacter) {
      return unavailable({ code: "CHARACTER_IDENTITY_MISMATCH" });
    }
    return this._stringConfiguration(session, "walletPassphrase");
  }
}

module.exports = EncryptionWalletService;
