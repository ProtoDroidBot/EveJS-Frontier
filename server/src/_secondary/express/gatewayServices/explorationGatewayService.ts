"use strict";

const protobuf = require("protobufjs");
const {
  GET_KNOWN_UNIVERSE_REQUEST,
  GET_KNOWN_UNIVERSE_RESPONSE,
  GET_SYSTEM_DETAIL_REQUEST,
  GET_SYSTEM_DETAIL_RESPONSE,
  UNIVERSE_REVEAL_NOTICE,
  getExplorationProtoTypes,
} = require("./explorationProto");

const HANDLED_REQUEST_TYPES = Object.freeze([
  GET_KNOWN_UNIVERSE_REQUEST,
  GET_SYSTEM_DETAIL_REQUEST,
]);

function requestError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function positiveIdentityID(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeIdentity(value) {
  if (!value || typeof value !== "object") return null;
  const userID = positiveIdentityID(value.userID);
  const characterID = positiveIdentityID(value.characterID);
  if (!userID) return null;
  const currentSystemID = positiveIdentityID(value.currentSystemID);
  return { userID, characterID, ...(currentSystemID ? { currentSystemID } : {}) };
}

function readUnsignedVarint(reader, bits) {
  let value = 0n;
  for (let index = 0; index < Math.ceil(bits / 7); index++) {
    if (reader.pos >= reader.len) throw requestError(400, "INVALID_EXPLORATION_REQUEST");
    const byte = reader.buf[reader.pos++];
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if (!(byte & 0x80)) {
      if (value >= (1n << BigInt(bits))) throw requestError(400, "INVALID_EXPLORATION_REQUEST");
      return value;
    }
  }
  throw requestError(400, "INVALID_EXPLORATION_REQUEST");
}

// protobufjs's decoder accepts a known field with the wrong wire type in some
// cases. Check the small request schemas before decoding, including nested
// message boundaries. Unknown fields remain legal for protobuf evolution.
function validateRequestWire(type, bytes) {
  const reader = protobuf.Reader.create(bytes);
  while (reader.pos < reader.len) {
    const tag = Number(readUnsignedVarint(reader, 32));
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNumber === 0 || wireType > 5 || wireType === 3 || wireType === 4) {
      throw requestError(400, "INVALID_EXPLORATION_REQUEST");
    }
    const field = type.fieldsById[fieldNumber];
    if (!field) {
      reader.skipType(wireType);
      continue;
    }
    const messageType = field.resolvedType;
    const expectedWire = messageType || field.type === "string" ? 2 : 0;
    if (wireType !== expectedWire) {
      throw requestError(400, "INVALID_EXPLORATION_REQUEST");
    }
    if (wireType === 2) {
      const length = Number(readUnsignedVarint(reader, 32));
      const end = reader.pos + length;
      if (end > reader.len) throw requestError(400, "INVALID_EXPLORATION_REQUEST");
      if (messageType) validateRequestWire(messageType, bytes.subarray(reader.pos, end));
      else new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(reader.pos, end));
      reader.pos = end;
    } else {
      readUnsignedVarint(reader, field.type === "uint32" ? 32 : 64);
    }
  }
  if (reader.pos !== reader.len) throw requestError(400, "INVALID_EXPLORATION_REQUEST");
}

function decodeRequest(type, envelope) {
  const bytes = envelope && envelope.payload && envelope.payload.value;
  if (!(bytes instanceof Uint8Array)) {
    throw requestError(400, "INVALID_EXPLORATION_REQUEST");
  }
  try {
    validateRequestWire(type, bytes);
    return type.decode(bytes);
  } catch (_) {
    throw requestError(400, "INVALID_EXPLORATION_REQUEST");
  }
}

function encodeResponse(type, payload) {
  if (!payload || !payload.bundle_version || !(payload.payload instanceof Uint8Array) || payload.payload.length === 0) {
    throw new Error("Missing exploration bundle version or universe payload");
  }
  // fromObject preserves decimal uint64 values supplied by the authority.
  const message = type.fromObject(payload);
  const error = type.verify(message);
  if (error) throw new Error(`Invalid exploration response: ${error}`);
  return Buffer.from(type.encode(message).finish());
}

function createExplorationGatewayService(
  context: Record<string, any> = {},
  overrides: Record<string, any> = {},
) {
  let runtime = overrides.runtime || context.explorationRuntime || null;
  let unsubscribe = null;
  let subscribed = false;

  function publishReveal(event) {
    const identity = normalizeIdentity(event && event.identity);
    if (!identity || typeof context.publishGatewayNotice !== "function") return false;
    const types = getExplorationProtoTypes();
    const targetGroup = identity.characterID
      ? { character: identity.characterID }
      : { user: identity.userID };
    return context.publishGatewayNotice(
      UNIVERSE_REVEAL_NOTICE,
      encodeResponse(types.universeRevealNotice, event.payload),
      targetGroup,
    );
  }

  function getRuntime() {
    if (!runtime) runtime = require("../../../services/frontier/explorationRuntime").getExplorationRuntime();
    if (!subscribed && typeof runtime.subscribe === "function") {
      unsubscribe = runtime.subscribe(publishReveal);
      subscribed = true;
    }
    return runtime;
  }

  async function handleSupportedRequest(requestTypeName, envelope) {
    const knownUniverse = requestTypeName === GET_KNOWN_UNIVERSE_REQUEST;
    const responseTypeName = knownUniverse ? GET_KNOWN_UNIVERSE_RESPONSE : GET_SYSTEM_DETAIL_RESPONSE;
    try {
      const types = getExplorationProtoTypes();
      const request = decodeRequest(
        knownUniverse ? types.getKnownUniverseRequest : types.getSystemDetailRequest,
        envelope,
      );
      // Identity must be resolved by the authenticated gateway/session layer.
      // Never accept authoritative_context or identity fields from a caller as
      // proof of ownership; the wire envelope can be fabricated by that caller.
      const resolver = overrides.resolveIdentity || context.resolveExplorationIdentity;
      const identity = typeof resolver === "function"
        ? normalizeIdentity(await resolver(envelope))
        : null;
      if (!identity) throw requestError(401, "EXPLORATION_AUTHENTICATION_REQUIRED");

      let payload;
      if (knownUniverse) {
        const page = request.page || {};
        payload = await getRuntime().getKnownUniverse(identity, {
          token: page.token || "",
          size: Number(page.size || 0),
        });
      } else {
        if (!identity.characterID) throw requestError(403, "EXPLORATION_CHARACTER_REQUIRED");
        const systemID = request.solar_system && request.solar_system.sequential
          ? request.solar_system.sequential.toString()
          : "0";
        if (!/^[1-9][0-9]*$/.test(systemID)) {
          throw requestError(400, "INVALID_SOLAR_SYSTEM_ID");
        }
        payload = await getRuntime().getSystemDetail(identity, systemID);
      }
      if (!payload || typeof payload !== "object") throw new Error("Missing exploration response");
      return {
        statusCode: 200,
        statusMessage: "",
        responseTypeName,
        responsePayloadBuffer: encodeResponse(
          knownUniverse ? types.getKnownUniverseResponse : types.getSystemDetailResponse,
          payload,
        ),
      };
    } catch (error) {
      const explicitStatus = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599;
      return {
        statusCode: explicitStatus ? error.statusCode : 500,
        statusMessage: explicitStatus ? error.message : "EXPLORATION_INTERNAL_ERROR",
        responseTypeName,
        responsePayloadBuffer: Buffer.alloc(0),
      };
    }
  }

  return {
    name: "exploration",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType() { return null; },
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) return null;
      return handleSupportedRequest(requestTypeName, requestEnvelope);
    },
    dispose() {
      if (typeof unsubscribe === "function") unsubscribe();
      unsubscribe = null;
      subscribed = false;
    },
  };
}

module.exports = {
  HANDLED_REQUEST_TYPES,
  createExplorationGatewayService,
};
