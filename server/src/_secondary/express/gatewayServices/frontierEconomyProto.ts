"use strict";
const protobuf = require("protobufjs");
const catalog = require("./economy3640684.proto.json");
let cached;
/** Exact build-3640684 descriptors, extracted from the client's generated pb2. */
function getFrontierEconomyProtoRoot() {
  if (cached) return cached;
  const root = new protobuf.Root();
  for (const record of catalog.enums) {
    const split = record.fullName.lastIndexOf(".");
    root.define(record.fullName.slice(0, split)).add(new protobuf.Enum(record.name,
      Object.fromEntries(record.values.map(entry => [entry.name, entry.number]))));
  }
  for (const record of catalog.messages) {
    const split = record.fullName.lastIndexOf(".");
    const type = new protobuf.Type(record.name);
    for (const field of record.fields) type.add(new protobuf.Field(field.name, field.number,
      field.typeName || field.type.slice(5).toLowerCase(), field.label === "LABEL_REPEATED" ? "repeated" : undefined));
    root.define(record.fullName.slice(0, split)).add(type);
  }
  cached = root.resolveAll(); return cached;
}
module.exports = { getFrontierEconomyProtoRoot };
