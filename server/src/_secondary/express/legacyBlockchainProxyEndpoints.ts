import http = require("node:http");
import { createLegacyBlockchainProxy, legacyProxyParameters, legacyProxyRpcError } from "../../services/frontier/legacyBlockchainProxy";

const { normalizeLoopbackAddress } = require("./gatewayServices/explorationIdentity");
const MAX_BODY_BYTES = 64 * 1024;
const PORT = 32811;

function denied(code: string): never { throw Object.assign(new Error(code), { code }); }
function characterID(session: any): number {
  return Number(session?.characterID || session?.charid || session?.charID || session?.characterId || 0);
}

/** Only the actual HTTP peer and server-owned TCP registry establish identity. */
export function resolveLegacyProxySession(request: any, params: Record<string, any>, sessions: any[]) {
  const peer = normalizeLoopbackAddress(request?.socket?.remoteAddress);
  if (!peer || !Array.isArray(sessions)) denied("AUTHENTICATION_REQUIRED");
  const candidates = sessions.filter(session => session?.socket && !session.socket.destroyed &&
    session._characterControlDisconnected !== true && Number.isSafeInteger(Number(session.userid)) && Number(session.userid) > 0 &&
    Number.isSafeInteger(characterID(session)) && characterID(session) > 0 &&
    normalizeLoopbackAddress(session.socket.remoteAddress) === peer);
  if (new Set(candidates.map(session => Number(session.userid))).size !== 1) denied("AUTHENTICATION_REQUIRED");
  const claims = [params?.anima_id, params?.caller?.character_id].filter(value => value !== undefined);
  if (claims.some(value => !/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))) denied("CHARACTER_IDENTITY_MISMATCH");
  const distinct = [...new Set(claims.map(Number))];
  if (distinct.length > 1) denied("CHARACTER_IDENTITY_MISMATCH");
  const desired = distinct[0];
  const matches = desired ? candidates.filter(session => characterID(session) === desired) : candidates;
  if (!matches.length || !desired && new Set(matches.map(characterID)).size !== 1) denied("CHARACTER_IDENTITY_MISMATCH");
  matches.sort((a, b) => Number(b.lastActivity || 0) - Number(a.lastActivity || 0) || Number(b.connectTime || 0) - Number(a.connectTime || 0));
  return matches[0];
}

function handler(options: Record<string, any>) {
  const sessions = options.getSessions || (() => require("../../services/chat/sessionRegistry").getSessions());
  const getBridge = () => options.bridge || require("../../services/frontier/legacyEvmSuiBridge").getLegacyEvmSuiBridge();
  return async (request: any, payload: any) => {
    if (request.headers?.origin !== undefined || !normalizeLoopbackAddress(request.socket?.remoteAddress)) denied("AUTHENTICATION_REQUIRED");
    const params = legacyProxyParameters(payload);
    const session = options.resolveSession
      ? await options.resolveSession(request, params)
      : resolveLegacyProxySession(request, params, sessions());
    return createLegacyBlockchainProxy({ bridge: getBridge() }).handleRpc(payload, session);
  };
}

function send(response: any, status: number, body: any) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

/** Dedicated listener for the exact port retained by the 2455427 host patch. */
export function startLegacyBlockchainProxyServer(options: Record<string, any> = {}) {
  const runtime = options.config || require("../../config");
  if (Number(runtime.clientBuild) !== 2455427 || runtime.clientCompatibilityProfile !== "frontier" ||
      !options.bridge && !require("../../services/frontier/legacyEvmSuiBridge").resolveLegacyEvmSuiBridgePath(runtime)) return null;
  const host = options.host || "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host) || options.port !== undefined && Number(options.port) !== PORT) denied("INVALID_LEGACY_PROXY_LISTENER");
  const processRpc = handler(options);
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || !/^\/jsonrpc\/?$/.test(request.url || "")) {
      send(response, 404, legacyProxyRpcError(null, { code: "LEGACY_PROXY_METHOD_NOT_SUPPORTED" }));
      return;
    }
    if (request.headers.origin !== undefined || !normalizeLoopbackAddress(request.socket.remoteAddress)) {
      send(response, 403, legacyProxyRpcError(null, { code: "AUTHENTICATION_REQUIRED" }));
      request.resume();
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers["content-type"] || ""))) {
      send(response, 415, legacyProxyRpcError(null, { code: "INVALID_LEGACY_PROXY_REQUEST" }));
      request.resume();
      return;
    }
    let length = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    request.on("data", chunk => {
      length += chunk.length;
      if (rejected) return;
      if (length > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        send(response, 413, legacyProxyRpcError(null, { code: "INVALID_LEGACY_PROXY_REQUEST" }));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", async () => {
      if (rejected || response.writableEnded) return;
      let payload: any;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = await processRpc(request, payload);
        if (!response.writableEnded) send(response, 200, result);
      } catch (error) {
        if (!response.writableEnded) send(response, 200, legacyProxyRpcError(payload?.id,
          error instanceof SyntaxError ? { code: "INVALID_LEGACY_PROXY_REQUEST" } : error));
      }
    });
    request.on("error", () => { if (!response.writableEnded) response.destroy(); });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.listen(PORT, host);
  return server;
}

/** Optional shared HTTP-server route; legacy staging uses the dedicated port. */
export function installLegacyBlockchainProxyEndpoints(app: any, options: Record<string, any> = {}) {
  const processRpc = handler(options);
  app.post("/legacy-evm/proxy", async (request: any, response: any) => {
    try {
      const body = request.body;
      if (Buffer.byteLength(JSON.stringify(body ?? null)) > MAX_BODY_BYTES) denied("INVALID_LEGACY_PROXY_REQUEST");
      const result = await processRpc(request, body);
      response.setHeader("cache-control", "no-store");
      response.status(200).json(result);
    } catch (error) { response.status(200).json(legacyProxyRpcError(request.body?.id, error)); }
  });
}
