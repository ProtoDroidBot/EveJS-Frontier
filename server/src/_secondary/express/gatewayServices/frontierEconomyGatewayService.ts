"use strict";
const { getFrontierEconomyProtoRoot } = require("./frontierEconomyProto");
const { bufferFromBytes, encodePayload } = require("./gatewayServiceHelpers");
const TOKEN = "eve_public.token.exchange.api.";
const LENS = "eve_public.assembly.relay.lens.api.";
const WALLET = "eve_public.wallet.api.";
const AUTH = ["eve_public.auth.zklogin.token.JWTTokenRequest", "eve_public.auth.zklogin.api.CallEnokiZKLoginRequest", "eve_public.auth.zklogin.api.CallEnokiZKProofRequest"];
const REQUESTS = [WALLET + "GetBalanceRequest", ...["GetExchangeRate", "ExchangeLUXToToken", "PrepareTokenToLUX", "ExecuteTokenToLUX"].map(name => TOKEN + name + "Request"),
  ...["GetPrice", "PrepareBuy", "ExecuteBuy"].map(name => LENS + name + "Request"), ...AUTH];
function failure(error, responseTypeName) {
  const code = String(error && error.code || error && error.message || "ECONOMY_ERROR");
  const unavailable = /UNAVAILABLE|UNSUPPORTED|OFFICIAL_AUTH/.test(code);
  const forbidden = /IDENTITY|AUTHENTICATION|SIGNATURE|ACCESS|WALLET_ADDRESS/.test(code);
  return { statusCode: unavailable ? 503 : forbidden ? 403 : /NOT_FOUND/.test(code) ? 404 : /EXPIRED|INSUFFICIENT|CONFLICT|CHANGED|CARGO/.test(code) ? 409 : 400,
    statusMessage: code, responseTypeName, responsePayloadBuffer: Buffer.alloc(0) };
}
function uuidText(raw) {
  const bytes = bufferFromBytes(raw); if (bytes.length !== 16) throw Object.assign(new Error("INVALID_OPERATION_ID"), { code: "INVALID_OPERATION_ID" });
  const h = bytes.toString("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function createFrontierEconomyGatewayService(context: Record<string, any> = {}) {
  const root = getFrontierEconomyProtoRoot();
  const active = () => Number(context.clientBuild || require("../../../config").clientBuild) === 3640684;
  const runtime = () => context.frontierEconomyRuntime || require("../../../services/frontier/frontierEconomyRuntime").getFrontierEconomyRuntime();
  function identity(envelope) {
    const trusted = context.resolveGatewayIdentity && context.resolveGatewayIdentity(envelope);
    if (!trusted || !trusted.characterID) throw Object.assign(new Error("AUTHENTICATION_REQUIRED"), { code: "AUTHENTICATION_REQUIRED" });
    return trusted;
  }
  return {
    name: "frontier-economy", handledRequestTypes: REQUESTS,
    getEmptySuccessResponseType(name) { return REQUESTS.includes(name) ? name.replace(/Request$/, "Response") : null; },
    handleRequest(name, envelope) {
      if (!active() || !REQUESTS.includes(name)) return null;
      const responseTypeName = name.replace(/Request$/, "Response");
      const success = data => ({ statusCode: 200, statusMessage: "", responseTypeName, responsePayloadBuffer: encodePayload(root.lookupType(responseTypeName), data) });
      try {
        const request = root.lookupType(name).decode(bufferFromBytes(envelope?.payload?.value));
        const trusted = identity(envelope), domain = runtime();
        let result;
        switch (name) {
          case WALLET + "GetBalanceRequest": result = { balance: domain.getBalance(trusted, request.wallet?.hex) }; break;
          case TOKEN + "GetExchangeRateRequest": result = domain.getExchangeRate(); break;
          case TOKEN + "ExchangeLUXToTokenRequest": {
            const correlation = bufferFromBytes(envelope.correlation_uuid);
            if (correlation.length !== 16) throw Object.assign(new Error("IDEMPOTENCY_KEY_REQUIRED"), { code: "IDEMPOTENCY_KEY_REQUIRED" });
            result = domain.exchangeLUX(trusted, request.wallet_address, request.lux_amount, correlation.toString("hex")); break;
          }
          case TOKEN + "PrepareTokenToLUXRequest": result = domain.prepareToken(trusted, request.wallet_address, request.token_amount); break;
          case TOKEN + "ExecuteTokenToLUXRequest": result = domain.executeToken(trusted, request.operation_id, request.signature); break;
          case LENS + "GetPriceRequest": result = domain.getLensPrice(); break;
          case LENS + "PrepareBuyRequest": result = domain.prepareLens(trusted, Number(request.relay?.sequential), request.lens_count, request.destination); break;
          case LENS + "ExecuteBuyRequest": result = domain.executeLens(trusted, uuidText(request.prepared_transaction?.uuid), request.signature); break;
          default:
            // Official identity is an external authority. Deployment may provide
            // a real provider; the local signer never manufactures JWT/zk proofs.
            if (typeof context.frontierOfficialAuthProvider !== "function") throw Object.assign(new Error("OFFICIAL_AUTH_PROVIDER_UNAVAILABLE"), { code: "OFFICIAL_AUTH_PROVIDER_UNAVAILABLE" });
            result = context.frontierOfficialAuthProvider(name, request, trusted);
        }
        return result && typeof result.then === "function" ? result.then(success, error => failure(error, responseTypeName)) : success(result);
      } catch (error) { return failure(error, responseTypeName); }
    },
  };
}
function routeGatewayEvent(envelope, identity, options: Record<string, any> = {}) {
  const typeName = String(envelope?.payload?.type_url || "").split("/").pop();
  if (typeName !== WALLET + "Reported") return null;
  if (!identity || !identity.characterID) return { success: false, statusCode: 403, errorMsg: "AUTHENTICATION_REQUIRED" };
  try {
    const event = getFrontierEconomyProtoRoot().lookupType(typeName).decode(bufferFromBytes(envelope.payload.value));
    const runtime = options.frontierEconomyRuntime || require("../../../services/frontier/frontierEconomyRuntime").getFrontierEconomyRuntime();
    return runtime.reportWallet(identity, event.wallet_address?.hex);
  } catch (error) { return { success: false, statusCode: failure(error, "").statusCode, errorMsg: String(error.code || error.message) }; }
}
module.exports = { createFrontierEconomyGatewayService, routeGatewayEvent, FRONTIER_ECONOMY_REQUESTS: REQUESTS };
