"use strict";
const protobuf = require("protobufjs");
// Build3640684 serialized descriptors: eve_public/achievement/notice.proto,
// eve_public/broadcast/api/notices.proto. Upload failure reason is an enum.
function createProgressionNoticeTypes() {
  const root = new protobuf.Root();
  root.define("eve_public.achievement").add(new protobuf.Type("CompletedNotice").add(new protobuf.Field("message", 1, "string")));
  const namespace = root.define("eve_public.broadcast.api");
  namespace.add(new protobuf.Type("UploadSucceededNotice"));
  namespace.add(new protobuf.Type("UploadFailedNotice")
    .add(new protobuf.Enum("Reason", { REASON_UNSPECIFIED: 0, REASON_ALREADY_UPLOADED: 1 }))
    .add(new protobuf.Field("reason", 1, "Reason")));
  return root.resolveAll();
}
const root = createProgressionNoticeTypes();
const ALLOWED = new Set(["eve_public.achievement.CompletedNotice", "eve_public.broadcast.api.UploadSucceededNotice", "eve_public.broadcast.api.UploadFailedNotice"]);
function createProgressionNoticePublisher(publishGatewayNotice) {
  return (session, typeName, payload) => {
    const characterID = Number(session?.characterID || session?.charid || session?.charID);
    if (!Number.isSafeInteger(characterID) || characterID <= 0 || !ALLOWED.has(typeName)) throw new Error("INVALID_PROGRESSION_NOTICE");
    const type = root.lookupType(typeName), error = type.verify(payload);
    if (error) throw new Error(`INVALID_PROGRESSION_NOTICE_PAYLOAD: ${error}`);
    return publishGatewayNotice(typeName, Buffer.from(type.encode(type.create(payload)).finish()), { character: characterID });
  };
}
function installProgressionNoticePublisher(publishGatewayNotice) {
  const publisher = createProgressionNoticePublisher(publishGatewayNotice);
  require("../../../services/frontier/progressionRuntime").setNoticePublisher(publisher);
  return publisher;
}
module.exports = { createProgressionNoticeTypes, createProgressionNoticePublisher, installProgressionNoticePublisher };
