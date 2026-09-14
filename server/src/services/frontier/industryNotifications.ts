const protobuf = require("protobufjs");
const log = require("../../utils/logger");
const { encodePayload } = require(
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
);

const NOTICE_NAMESPACE = "eve_public.industry.api";
let cachedTypes = null;

function getIndustryNoticeTypes() {
  if (cachedTypes) {
    return cachedTypes;
  }

  // Field numbers and scalar types from client build 3502403's descriptors.
  const root = new protobuf.Root();
  root.define("eve_public.industry.model.facility").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "int64"),
    ),
  );
  root.define("eve_public.inventory.genericitemtype").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );
  root.define("eve_public.industry.model.item").add(
    new protobuf.Type("Stack")
      .add(new protobuf.Field(
        "type", 1, "eve_public.inventory.genericitemtype.Identifier",
      ))
      .add(new protobuf.Field("quantity", 2, "int64")),
  );
  const api = root.define(NOTICE_NAMESPACE);
  for (const name of ["InputItemsChangeNotice", "OutputItemsChangeNotice"]) {
    api.add(
      new protobuf.Type(name)
        .add(new protobuf.Field(
          "facility", 1, "eve_public.industry.model.facility.Identifier",
        ))
        .add(new protobuf.Field(
          "items", 2, "eve_public.industry.model.item.Stack", "repeated",
        )),
    );
  }
  root.resolveAll();
  cachedTypes = {
    inputs: root.lookupType(`${NOTICE_NAMESPACE}.InputItemsChangeNotice`),
    outputs: root.lookupType(`${NOTICE_NAMESPACE}.OutputItemsChangeNotice`),
  };
  return cachedTypes;
}

function publishIndustryItemsChanged(
  session,
  facilityID,
  side,
  totals,
  options: Record<string, any> = {},
) {
  const characterID = Number(session && (session.characterID || session.charid));
  const numericFacilityID = Number(facilityID);
  if (
    !Number.isSafeInteger(characterID) || characterID <= 0 ||
    !Number.isSafeInteger(numericFacilityID) || numericFacilityID <= 0 ||
    (side !== "inputs" && side !== "outputs")
  ) {
    return false;
  }

  // These notices replace the client's cached side completely. Send all
  // remaining type totals, including an empty list after the final withdrawal.
  const items = Object.entries(totals || {}).map(([typeID, quantity]) => ({
    type: { sequential: Number(typeID) },
    quantity: Number(quantity),
  }));
  if (items.some((item) => (
    !Number.isSafeInteger(item.type.sequential) || item.type.sequential <= 0 ||
    !Number.isSafeInteger(item.quantity) || item.quantity < 0
  ))) {
    return false;
  }

  try {
    const publish = options.publishGatewayNotice || require(
      "../../_secondary/express/publicGatewayLocal",
    ).publishGatewayNotice;
    const noticeType = getIndustryNoticeTypes()[side];
    publish(
      `${NOTICE_NAMESPACE}.${noticeType.name}`,
      encodePayload(noticeType, {
        facility: { sequential: numericFacilityID },
        items: items.filter((item) => item.quantity > 0),
      }),
      { character: characterID },
    );
    return true;
  } catch (error) {
    // The inventory transfer has already committed. A disconnected notice
    // stream must not turn it into an apparent failed transfer and invite retry.
    log.warn(`[industry] Failed to publish ${side} snapshot for facility=${numericFacilityID}: ${error.message}`);
    return false;
  }
}

module.exports = {
  publishIndustryItemsChanged,
  _testing: { getIndustryNoticeTypes },
};
