"use strict";

// Optional actual-client check. Run directly after `npm run build`; it imports
// only pure protobuf reflection modules, never server startup or gameStore.
// EVEJS_FRONTIER_CONTRACT_INDEX selects an explicit export (missing = failure).
// Otherwise the current build's absent local export is an intentional skip.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DEFAULT_BUILD } = require("../../scripts/Tests/run-frontier-server-tests");
const { buildFrontierCoreProtoRoot } = require(
  "../src/_secondary/express/gatewayServices/frontierCoreProto",
);
const { buildAssemblyGateProtoRoot } = require(
  "../src/_secondary/express/gatewayServices/assemblyGateProto",
);
const { getNetworkNodeProtoTypes } = require(
  "../src/_secondary/express/gatewayServices/assemblyNetworkNodeProto",
);
const { buildStorageUnitProtoRoot } = require(
  "../src/_secondary/express/gatewayServices/assemblyStorageUnitProto",
);

const build = process.env.EVEJS_CLIENT_BUILD || DEFAULT_BUILD;
assert.match(build, /^\d+$/, "actual-contract build must be numeric");
const explicitIndex = process.env.EVEJS_FRONTIER_CONTRACT_INDEX;
const indexPath = explicitIndex || path.resolve(
  __dirname, "../../_local/frontier-contracts", build, "frontier-contract-index.json",
);
const available = fs.existsSync(indexPath);
if (explicitIndex) {
  assert.equal(available, true, `Explicit contract export is missing: ${indexPath}`);
}

function collectMessages(namespace) {
  return [
    ...(namespace.fieldsArray ? [namespace] : []),
    ...(namespace.nestedArray || []).flatMap(collectMessages),
  ];
}

function rawMessageMap(descriptors) {
  const messages = new Map<string, any>();
  function visit(message, prefix) {
    const fullName = `${prefix}.${message.name}`;
    messages.set(fullName, message);
    for (const child of message.nested_type || []) visit(child, fullName);
  }
  for (const file of descriptors.file) {
    for (const message of file.message_type || []) visit(message, file.package);
  }
  return messages;
}

function scalarShape(type, typeName?) {
  const wireTypes = {
    TYPE_DOUBLE: 1, TYPE_FLOAT: 5, TYPE_INT64: 0, TYPE_UINT64: 0,
    TYPE_INT32: 0, TYPE_FIXED64: 1, TYPE_FIXED32: 5, TYPE_BOOL: 0,
    TYPE_STRING: 2, TYPE_GROUP: 3, TYPE_MESSAGE: 2, TYPE_BYTES: 2,
    TYPE_UINT32: 0, TYPE_ENUM: 0, TYPE_SFIXED32: 5, TYPE_SFIXED64: 1,
    TYPE_SINT32: 0, TYPE_SINT64: 0,
  };
  assert.ok(Object.hasOwn(wireTypes, type), `Unknown protobuf scalar: ${type}`);
  return { type, wireType: wireTypes[type], typeName: typeName || null };
}

function reflectedScalar(field) {
  const resolved = field.resolvedType;
  return scalarShape(
    resolved ? (resolved.fieldsArray ? "TYPE_MESSAGE" : "TYPE_ENUM")
      : `TYPE_${field.type.toUpperCase()}`,
    resolved?.fullName,
  );
}

const roots = [
  ["core", buildFrontierCoreProtoRoot],
  ["assembly gate", buildAssemblyGateProtoRoot],
  ["network node", () => getNetworkNodeProtoTypes().root],
  ["storage unit", buildStorageUnitProtoRoot],
];

for (const [name, createRoot] of roots) {
  test(`actual Frontier ${build} ${name} gateway contract`, {
    skip: available ? false : `No local contract export: ${indexPath}`,
  }, (t) => {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.equal(index.format, "evejs-frontier-contract-index-v1");
    assert.equal(index.build, Number(build));
    assert.deepEqual(index.failures, [], "client descriptor extraction failures");
    const clientMessages = new Map<string, any>(index.descriptorFiles.flatMap(
      (file) => file.messages.map((message) => [message.fullName, message]),
    ));
    // The compact index omits map_entry; consult the matching full descriptor
    // export as well, otherwise repeated messages could be mistaken for maps.
    const rawMessages = rawMessageMap(JSON.parse(fs.readFileSync(
      path.join(path.dirname(indexPath), "frontier-public-protos.json"), "utf8",
    )));
    const serverMessages = collectMessages(createRoot().resolveAll());
    const missingMessages = [];
    const optionalClientFields = [];
    let fieldsChecked = 0;
    for (const message of serverMessages) {
      const fullName = message.fullName.replace(/^\./, "");
      const client = clientMessages.get(fullName);
      if (!client) {
        missingMessages.push(fullName);
        continue;
      }
      const raw = rawMessages.get(fullName);
      assert.ok(raw, `Full descriptor missing for ${fullName}`);
      for (const field of message.fieldsArray) {
        const label = `${fullName}.${field.name} (#${field.id})`;
        const descriptor = client.fields.find((entry) => entry.number === field.id);
        assert.ok(descriptor, `Client field missing: ${label}`);
        assert.equal(descriptor.name, field.name, `${label}: field name/number`);
        const rawField = raw.field.find((entry) => entry.number === field.id);
        assert.ok(rawField, `${label}: missing from full descriptor`);
        assert.deepEqual(
          [rawField.name, rawField.type, rawField.type_name, rawField.label],
          [descriptor.name, descriptor.type, descriptor.typeName, descriptor.label],
          `${label}: index/full descriptor disagree`,
        );
        const entry = rawMessages.get((descriptor.typeName || "").replace(/^\./, ""));
        const clientMap = Boolean(entry?.options?.map_entry);
        assert.equal(Boolean(field.map), clientMap, `${label}: map semantics`);
        assert.equal(
          descriptor.label,
          field.map || field.repeated ? "LABEL_REPEATED"
            : field.required ? "LABEL_REQUIRED" : "LABEL_OPTIONAL",
          `${label}: repeated/required label`,
        );
        if (clientMap) {
          assert.equal(descriptor.type, "TYPE_MESSAGE", `${label}: map wire type`);
          const key = entry.field.find((value) => value.number === 1);
          const value = entry.field.find((value) => value.number === 2);
          assert.deepEqual(scalarShape(`TYPE_${field.keyType.toUpperCase()}`),
            scalarShape(key.type, key.type_name), `${label}: map key`);
          assert.deepEqual(reflectedScalar(field), scalarShape(value.type, value.type_name),
            `${label}: map value`);
        } else {
          assert.deepEqual(reflectedScalar(field),
            scalarShape(descriptor.type, descriptor.typeName),
            `${label}: scalar/wire/fully-qualified type`);
        }
        fieldsChecked += 1;
      }
      for (const field of client.fields) {
        if (message.fieldsById[field.number]) continue;
        assert.notEqual(field.label, "LABEL_REQUIRED",
          `${fullName}.${field.name}: unimplemented required client field`);
        optionalClientFields.push(`${fullName}.${field.name} (#${field.number})`);
      }
    }
    assert.deepEqual(missingMessages, [], "implemented messages missing from client export");
    t.diagnostic(`${serverMessages.length} messages, ${fieldsChecked} fields matched; ` +
      `${optionalClientFields.length} optional client-only fields`);
    if (optionalClientFields.length) t.diagnostic(optionalClientFields.join("\n"));
  });
}
