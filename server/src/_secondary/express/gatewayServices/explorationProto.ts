"use strict";

const protobuf = require("protobufjs");

// Field numbers and widths come from the build 3640684 serialized descriptors
// recorded in docs/FRONTIER_BUILD_3640684_GALAXY_EVIDENCE.json. Keep this root
// independent of the game store so contract inspection cannot initialize it.
const GET_KNOWN_UNIVERSE_REQUEST = "eve_public.exploration.api.GetKnownUniverseRequest";
const GET_KNOWN_UNIVERSE_RESPONSE = "eve_public.exploration.api.GetKnownUniverseResponse";
const GET_SYSTEM_DETAIL_REQUEST = "eve_public.exploration.api.GetSystemDetailRequest";
const GET_SYSTEM_DETAIL_RESPONSE = "eve_public.exploration.api.GetSystemDetailResponse";
const UNIVERSE_REVEAL_NOTICE = "eve_public.exploration.api.UniverseRevealNotice";

let cachedTypes = null;

function buildExplorationProtoRoot() {
  const root = new protobuf.Root();
  root.define("eve_public")
    .add(new protobuf.Type("Page")
      .add(new protobuf.Field("size", 1, "uint32"))
      .add(new protobuf.Field("token", 2, "string")))
    .add(new protobuf.Type("NextPage")
      .add(new protobuf.Field("token", 1, "string")));
  root.define("eve_public.semanticversion").add(
    new protobuf.Type("Specification")
      .add(new protobuf.Field("major", 1, "uint32"))
      .add(new protobuf.Field("minor", 2, "uint32"))
      .add(new protobuf.Field("patch", 3, "uint32"))
      .add(new protobuf.Field("prerelease_tags", 4, "string", "repeated"))
      .add(new protobuf.Field("build_tags", 5, "string", "repeated")),
  );
  root.define("eve_public.solarsystem").add(
    new protobuf.Type("Identifier")
      .add(new protobuf.Field("sequential", 1, "uint64")),
  );
  root.define("eve_public.exploration")
    .add(new protobuf.Type("DetectionLadder")
      .add(new protobuf.Field("detected_system_ids", 1, "uint64", "repeated"))
      .add(new protobuf.Field("resolved_system_ids", 2, "uint64", "repeated")))
    .add(new protobuf.Type("SystemKnowledge")
      .add(new protobuf.Field("revision", 1, "uint64"))
      .add(new protobuf.Field("complete", 2, "bool"))
      .add(new protobuf.Field("visited_system_ids", 3, "uint64", "repeated"))
      .add(new protobuf.Field("thermal", 4, "eve_public.exploration.DetectionLadder"))
      .add(new protobuf.Field("em", 5, "eve_public.exploration.DetectionLadder")));
  root.define("eve_public.exploration.api")
    .add(new protobuf.Type("GetKnownUniverseRequest")
      .add(new protobuf.Field("page", 1, "eve_public.Page")))
    .add(new protobuf.Type("GetKnownUniverseResponse")
      .add(new protobuf.Field("bundle_version", 1, "eve_public.semanticversion.Specification"))
      .add(new protobuf.Field("payload", 2, "bytes"))
      .add(new protobuf.Field("next_page", 3, "eve_public.NextPage"))
      .add(new protobuf.Field("total_systems", 4, "uint64"))
      .add(new protobuf.Field("knowledge", 5, "eve_public.exploration.SystemKnowledge")))
    .add(new protobuf.Type("GetSystemDetailRequest")
      .add(new protobuf.Field("solar_system", 1, "eve_public.solarsystem.Identifier")))
    .add(new protobuf.Type("GetSystemDetailResponse")
      .add(new protobuf.Field("bundle_version", 1, "eve_public.semanticversion.Specification"))
      .add(new protobuf.Field("payload", 2, "bytes")))
    .add(new protobuf.Type("UniverseRevealNotice")
      .add(new protobuf.Field("bundle_version", 1, "eve_public.semanticversion.Specification"))
      .add(new protobuf.Field("payload", 2, "bytes"))
      .add(new protobuf.Field("knowledge", 3, "eve_public.exploration.SystemKnowledge")));
  return root.resolveAll();
}

function getExplorationProtoTypes() {
  if (!cachedTypes) {
    const root = buildExplorationProtoRoot();
    cachedTypes = {
      root,
      getKnownUniverseRequest: root.lookupType(GET_KNOWN_UNIVERSE_REQUEST),
      getKnownUniverseResponse: root.lookupType(GET_KNOWN_UNIVERSE_RESPONSE),
      getSystemDetailRequest: root.lookupType(GET_SYSTEM_DETAIL_REQUEST),
      getSystemDetailResponse: root.lookupType(GET_SYSTEM_DETAIL_RESPONSE),
      universeRevealNotice: root.lookupType(UNIVERSE_REVEAL_NOTICE),
      systemKnowledge: root.lookupType("eve_public.exploration.SystemKnowledge"),
    };
  }
  return cachedTypes;
}

module.exports = {
  GET_KNOWN_UNIVERSE_REQUEST,
  GET_KNOWN_UNIVERSE_RESPONSE,
  GET_SYSTEM_DETAIL_REQUEST,
  GET_SYSTEM_DETAIL_RESPONSE,
  UNIVERSE_REVEAL_NOTICE,
  buildExplorationProtoRoot,
  getExplorationProtoTypes,
};
