const protobuf = require("protobufjs");
const contracts = require("./frontierContracts3640684.json");

function applyFrontier3640684ContractProfile(root, build = require("../../../config").clientBuild) {
  if (Number(build) !== 3640684) return root;
  // Replace complete shared messages before compiling encoders. Scalar varints
  // are wire-compatible but not value-compatible (notably sint32 user IDs).
  for (const [name, descriptor] of Object.entries(contracts.types) as Array<[string, any]>) {
    const previous = root.lookup(name);
    if (previous) previous.parent.remove(previous);
    const split = name.lastIndexOf(".");
    const parent = root.define(name.slice(0, split));
    const shortName = name.slice(split + 1);
    parent.add(descriptor.values
      ? protobuf.Enum.fromJSON(shortName, descriptor)
      : protobuf.Type.fromJSON(shortName, descriptor));
  }
  return root;
}

function validateFrontierNoticeTarget(target) {
  if (!target || typeof target !== "object") return false;
  const allowed = ["application_instance_uuid", "solar_system", "user", "character", "corporation", "alliance"];
  const keys = Object.keys(target).filter((key) => target[key] !== null && target[key] !== undefined);
  if (keys.length !== 1 || !allowed.includes(keys[0])) return false;
  const key = keys[0];
  if (key === "application_instance_uuid") return Buffer.from(target[key]).length === 16;
  const value = Number(target[key]);
  return Number.isSafeInteger(value) && value > 0 &&
    value <= (key === "user" || key === "alliance" ? 0x7fffffff : 0xffffffff);
}

function shouldDeliverFrontierNotice(state, envelope) {
  if (!state || state.authenticated !== true || !envelope || !validateFrontierNoticeTarget(envelope.target_group)) return false;
  const target = envelope.target_group;
  if (Object.prototype.hasOwnProperty.call(target, "application_instance_uuid")) {
    return Boolean(state.applicationInstanceHex) && Buffer.from(target.application_instance_uuid).toString("hex") === state.applicationInstanceHex;
  }
  const fields = { solar_system: "solarSystemID", user: "userID", character: "activeCharacterID", corporation: "corporationID", alliance: "allianceID" };
  const key = Object.keys(target)[0];
  return Number(state[fields[key]]) > 0 && Number(state[fields[key]]) === Number(target[key]);
}

module.exports = { applyFrontier3640684ContractProfile, validateFrontierNoticeTarget, shouldDeliverFrontierNotice };
