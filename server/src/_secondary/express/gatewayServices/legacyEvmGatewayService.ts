const protobuf = require("protobufjs");
const { getClientBlockchainProtocol } = require("../../../config/clientBuildProfiles");
const { bufferFromBytes, encodePayload } = require("./gatewayServiceHelpers");
const { LEGACY_EVM_META_TRANSACTION_REQUEST } = require("../../../services/frontier/legacyEvmSuiBridge");
const RESPONSE = LEGACY_EVM_META_TRANSACTION_REQUEST.replace(/Request$/, "Response");
const ACCOUNT = "eve_public.blockchain.account.";
const EXISTS = ACCOUNT + "smartcharacter.SmartCharacterExistsRequest";
const BALANCE = ACCOUNT + "balance.TokenBalanceRequest";
const GET_KEY = ACCOUNT + "smartcharacter.GetPrivateKeyRequest";
const STORE_KEY = ACCOUNT + "smartcharacter.StorePrivateKeyRequest";
const REQUESTS = [LEGACY_EVM_META_TRANSACTION_REQUEST, EXISTS, BALANCE, GET_KEY, STORE_KEY];

// Exported from packaged EVM clients (2973163, 2997426 and 3122254).
function buildLegacyEvmProtoRoot() {
  const root = new protobuf.Root();
  const erc2771 = new protobuf.Type("ERC2771")
    .add(new protobuf.Field("sender", 1, "string"))
    .add(new protobuf.Field("address", 2, "string"))
    .add(new protobuf.Field("value", 3, "uint64"))
    .add(new protobuf.Field("gas", 4, "uint64"))
    .add(new protobuf.Field("nonce", 5, "string"))
    .add(new protobuf.Field("deadline", 6, "uint64"))
    .add(new protobuf.Field("data", 7, "string"))
    .add(new protobuf.Field("signature", 8, "string"));
  root.define("eve_public.blockchain.metatransaction")
    .add(new protobuf.Type("MetaTransactionRequest").add(erc2771)
      .add(new protobuf.Field("erc2771", 1, "ERC2771")))
    .add(new protobuf.Type("MetaTransactionResponse").add(new protobuf.Field("success", 1, "bool"))
      .add(new protobuf.Field("transaction_hash", 2, "string")));
  root.define(ACCOUNT + "smartcharacter")
    .add(new protobuf.Type("SmartCharacterExistsRequest").add(new protobuf.Field("char_id", 1, "int64")))
    .add(new protobuf.Type("SmartCharacterExistsResponse").add(new protobuf.Field("exists", 1, "bool")))
    .add(new protobuf.Type("GetPrivateKeyRequest").add(new protobuf.Field("public_key", 1, "string")))
    .add(new protobuf.Type("GetPrivateKeyResponse").add(new protobuf.Field("private_key", 1, "string")))
    .add(new protobuf.Type("StorePrivateKeyRequest").add(new protobuf.Field("public_key", 1, "string"))
      .add(new protobuf.Field("private_key", 2, "string")))
    .add(new protobuf.Type("StorePrivateKeyResponse"));
  root.define(ACCOUNT + "balance")
    .add(new protobuf.Type("TokenBalanceRequest").add(new protobuf.Field("char_id", 1, "int64"))
      .add(new protobuf.Field("wallet_address", 2, "string")))
    .add(new protobuf.Type("TokenBalanceResponse").add(new protobuf.Field("balance", 1, "string")))
    .add(new protobuf.Type("UpdatedNotice").add(new protobuf.Field("char_id", 1, "int64"))
      .add(new protobuf.Field("wallet_address", 2, "string"))
      .add(new protobuf.Field("balance", 3, "string")));
  return root.resolveAll();
}
const root = buildLegacyEvmProtoRoot();
function createLegacyEvmGatewayService(context: Record<string, any> = {}) {
  const observedBalances = new Map<string, string>();
  return {
    name: "legacy-evm-sui",
    handledRequestTypes: REQUESTS,
    getEmptySuccessResponseType: () => null,
    handleRequest(name, envelope) {
      if (!REQUESTS.includes(name)) return null;
      const responseTypeName = name.replace(/Request$/, "Response");
      const failed = (error) => {
        const code = String(error?.code || "INVALID_LEGACY_EVM_REQUEST");
        return { statusCode: /UNAVAILABLE/.test(code) ? 503 : /AUTHENTICATION|IDENTITY|SIGNATURE|ACCESS/.test(code) ? 403 :
          /NONCE_CONFLICT|RECONCILIATION/.test(code) ? 409 : 400,
          statusMessage: code, responseTypeName, responsePayloadBuffer: Buffer.alloc(0) };
      };
      try {
        const build = context.clientBuild || require("../../../config").clientBuild;
        if (getClientBlockchainProtocol(build) !== "evm") throw Object.assign(new Error(), { code: "UNSUPPORTED_LEGACY_EVM_BUILD" });
        const trusted = context.resolveGatewayIdentity?.(envelope);
        if (!trusted?.session || !trusted.characterID || Number(trusted.session.userid) !== trusted.userID ||
            Number(trusted.session.characterID || trusted.session.charid) !== trusted.characterID) {
          throw Object.assign(new Error(), { code: "AUTHENTICATION_REQUIRED" });
        }
        const request = root.lookupType(name).decode(bufferFromBytes(envelope?.payload?.value));
        const bridge = context.legacyEvmSuiBridge || require("../../../services/frontier/legacyEvmSuiBridge").getLegacyEvmSuiBridge();
        const operation = async () => {
          switch (name) {
            case LEGACY_EVM_META_TRANSACTION_REQUEST: {
              if (!request.erc2771) throw Object.assign(new Error(), { code: "INVALID_LEGACY_EVM_REQUEST" });
              const result = await bridge.relay(request.erc2771, trusted.session);
              return { success: result?.success === true, transaction_hash: result?.transactionDigest || "" };
            }
            case EXISTS: return { exists: await bridge.characterExists(trusted.session, String(request.char_id)) };
            case BALANCE: {
              const balance = await bridge.tokenBalance(trusted.session, String(request.char_id), request.wallet_address);
              const key = `${trusted.userID}:${trusted.characterID}`;
              if (observedBalances.get(key) !== balance.value && typeof context.publishGatewayNotice === "function") {
                const notice = ACCOUNT + "balance.UpdatedNotice";
                try {
                  context.publishGatewayNotice(notice, encodePayload(root.lookupType(notice), {
                    char_id: trusted.characterID, wallet_address: request.wallet_address, balance: balance.value,
                  }), { character: trusted.characterID });
                  observedBalances.set(key, balance.value);
                  if (observedBalances.size > 4096) observedBalances.delete(observedBalances.keys().next().value);
                } catch { /* A disconnected notice stream does not invalidate the authoritative read. */ }
              }
              return { balance: balance.value };
            }
            case GET_KEY:
              if (Number(build) !== 3122254) throw Object.assign(new Error(), { code: "UNSUPPORTED_LEGACY_EVM_RECOVERY" });
              return { private_key: await bridge.getPrivateKey(trusted.session, request.public_key) || "" };
            case STORE_KEY:
              if (Number(build) !== 3122254) throw Object.assign(new Error(), { code: "UNSUPPORTED_LEGACY_EVM_RECOVERY" });
              await bridge.storePrivateKey(trusted.session, request.public_key, request.private_key);
              return {};
            default: throw Object.assign(new Error(), { code: "INVALID_LEGACY_EVM_REQUEST" });
          }
        };
        return operation().then(result => ({ statusCode: 200, statusMessage: "", responseTypeName,
          responsePayloadBuffer: encodePayload(root.lookupType(responseTypeName), result) }), failed);
      } catch (error) { return failed(error); }
    },
  };
}
export { buildLegacyEvmProtoRoot, createLegacyEvmGatewayService, REQUESTS as LEGACY_EVM_GATEWAY_REQUESTS };
