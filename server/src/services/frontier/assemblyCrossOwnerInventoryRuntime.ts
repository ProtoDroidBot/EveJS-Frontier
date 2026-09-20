"use strict";

const crypto = require("crypto");
const path = require("path");

const CARGO_HOLD_FLAG = 5;
const SMART_STORAGE_FLAG = 66;
const ASSEMBLY_STATUS_ONLINE = 2;
const CAP_DEPOSIT = "inventory.deposit";
const CAP_WITHDRAW = "inventory.withdraw";
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

let verifyChainProof = null;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function positive(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function quantity(item) {
  return Number(item?.singleton) === 1 ? 1 : positive(item?.stacksize ?? item?.quantity);
}

function defaultDependencies() {
  return {
    itemStore: require(path.join(__dirname, "../inventory/itemStore")),
    deployment: require("./deploymentRuntime"),
    access: require("./assemblyAccessRuntime"),
    storage: require("./smartStorageUnitRuntime"),
  };
}

function createAssemblyCrossOwnerInventoryRuntime(options: Record<string, any> = {}) {
  const dependencies = { ...defaultDependencies(), ...(options.dependencies || {}) };
  const now = typeof options.now === "function" ? options.now : Date.now;
  const chainVerifier = typeof options.verifyChainProof === "function"
    ? options.verifyChainProof : (operation, proof) => {
      if (typeof verifyChainProof !== "function") return false;
      return verifyChainProof(operation, proof);
    };

  function assembly(itemID, actor, capability, solarSystemID) {
    const record = dependencies.deployment.getAssemblyRecord(itemID);
    if (!record) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
    if (record.createOnChain !== true) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_CHAIN_REQUIRED" };
    }
    if (record.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
      return { success: false as const, errorMsg: "ASSEMBLY_OFFLINE" };
    }
    if (record.solarSystemID !== solarSystemID) {
      return { success: false as const, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    }
    const item = dependencies.itemStore.findItemById(record.itemID);
    const component = dependencies.storage.getStorageComponent(item?.typeID);
    if (!item || !component) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_STORAGE_ONLY" };
    }
    const authorization = dependencies.access.resolveAccess(actor, record.itemID, [capability]);
    if (!authorization || authorization.success !== true) return authorization;
    return { success: true as const, data: { record, item, component, authorization: authorization.data } };
  }

  function usedVolume(ownerID, assemblyID) {
    return dependencies.itemStore.listContainerItems(ownerID, assemblyID, SMART_STORAGE_FLAG)
      .reduce((total, item) => total + dependencies.itemStore.getInventoryItemUnitVolume(item) * quantity(item), 0);
  }

  async function execute(actor, request: Record<string, any> = {}) {
    const actorID = positive(actor?.actorID ?? actor?.characterID);
    const activeShipID = positive(request.activeShipID);
    const solarSystemID = positive(request.solarSystemID);
    const sourceItemID = positive(request.sourceItemID);
    const moveQuantity = positive(request.quantity);
    const operationID = String(request.operationID || "").trim().toLowerCase();
    const action = String(request.action || "").trim().toLowerCase();
    const sourceAssemblyID = positive(request.sourceAssemblyID);
    const destinationAssemblyID = positive(request.destinationAssemblyID);
    if (!actorID || !activeShipID || !solarSystemID || !sourceItemID || !moveQuantity ||
        !OPERATION_ID.test(operationID) || !["deposit", "withdraw", "transfer"].includes(action)) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_REQUEST_INVALID" };
    }
    if ((action === "deposit" && (!destinationAssemblyID || sourceAssemblyID)) ||
        (action === "withdraw" && (!sourceAssemblyID || destinationAssemblyID)) ||
        (action === "transfer" && (!sourceAssemblyID || !destinationAssemblyID ||
          sourceAssemblyID === destinationAssemblyID))) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_REQUEST_INVALID" };
    }

    const immutable = {
      action,
      actorID,
      activeShipID,
      solarSystemID,
      sourceItemID,
      quantity: moveQuantity,
      sourceAssemblyID,
      destinationAssemblyID,
    };
    const operationFingerprint = fingerprint(immutable);
    const replay = dependencies.itemStore.findAssemblyCustodyReceipt(operationID);
    if (replay) {
      return replay.operationFingerprint === operationFingerprint
        ? { success: true as const, replayed: true, data: replay.result }
        : { success: false as const, errorMsg: "CUSTODY_IDEMPOTENCY_CONFLICT" };
    }

    const sourceAssembly = sourceAssemblyID
      ? assembly(sourceAssemblyID, actor, CAP_WITHDRAW, solarSystemID) : null;
    if (sourceAssembly && sourceAssembly.success !== true) return sourceAssembly;
    const destinationAssembly = destinationAssemblyID
      ? assembly(destinationAssemblyID, actor, CAP_DEPOSIT, solarSystemID) : null;
    if (destinationAssembly && destinationAssembly.success !== true) return destinationAssembly;

    const sourceItem = dependencies.itemStore.findItemById(sourceItemID);
    if (!sourceItem || Number(sourceItem.singleton) !== 0 || moveQuantity > quantity(sourceItem)) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_ITEM_INVALID" };
    }
    const expectedSourceOwner = sourceAssembly ? sourceAssembly.data.record.ownerID : actorID;
    const expectedSourceLocation = sourceAssembly ? sourceAssemblyID : activeShipID;
    const expectedSourceFlag = sourceAssembly ? SMART_STORAGE_FLAG : CARGO_HOLD_FLAG;
    if (Number(sourceItem.ownerID) !== expectedSourceOwner ||
        Number(sourceItem.locationID) !== expectedSourceLocation ||
        Number(sourceItem.flagID) !== expectedSourceFlag) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_SOURCE_MISMATCH" };
    }

    const destinationOwnerID = destinationAssembly ? destinationAssembly.data.record.ownerID : actorID;
    const destinationLocationID = destinationAssembly ? destinationAssemblyID : activeShipID;
    const destinationFlagID = destinationAssembly ? SMART_STORAGE_FLAG : CARGO_HOLD_FLAG;
    if (destinationAssembly) {
      const unitVolume = dependencies.itemStore.getInventoryItemUnitVolume(sourceItem);
      const nextVolume = usedVolume(destinationOwnerID, destinationAssemblyID) + unitVolume * moveQuantity;
      if (!(unitVolume > 0) || nextVolume > Number(destinationAssembly.data.component.storageCapacity) + 1e-6) {
        return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_CAPACITY_EXCEEDED" };
      }
    }

    const proofRequest = {
      ...immutable,
      operationID,
      typeID: Number(sourceItem.typeID),
      custodyKind: action === "deposit" ? 1 : action === "withdraw" ? 2 : 3,
    };
    let chainConfirmed = false;
    try { chainConfirmed = await chainVerifier(proofRequest, request.chainProof); }
    catch { chainConfirmed = false; }
    if (chainConfirmed !== true) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_CHAIN_PROOF_INVALID" };
    }

    // Recheck the immutable item boundary after the asynchronous chain read.
    const current = dependencies.itemStore.findItemById(sourceItemID);
    if (!current || Number(current.ownerID) !== expectedSourceOwner ||
        Number(current.locationID) !== expectedSourceLocation || Number(current.flagID) !== expectedSourceFlag ||
        Number(current.typeID) !== Number(sourceItem.typeID) || moveQuantity > quantity(current)) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_SOURCE_CHANGED" };
    }
    const sourceCurrent = sourceAssemblyID
      ? assembly(sourceAssemblyID, actor, CAP_WITHDRAW, solarSystemID) : null;
    const destinationCurrent = destinationAssemblyID
      ? assembly(destinationAssemblyID, actor, CAP_DEPOSIT, solarSystemID) : null;
    if (sourceCurrent && sourceCurrent.success !== true) return sourceCurrent;
    if (destinationCurrent && destinationCurrent.success !== true) return destinationCurrent;
    if ((sourceCurrent && sourceCurrent.data.record.ownerID !== expectedSourceOwner) ||
        (destinationCurrent && destinationCurrent.data.record.ownerID !== destinationOwnerID)) {
      return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_SOURCE_CHANGED" };
    }
    if (destinationCurrent) {
      const unitVolume = dependencies.itemStore.getInventoryItemUnitVolume(current);
      const nextVolume = usedVolume(destinationOwnerID, destinationAssemblyID) + unitVolume * moveQuantity;
      if (!(unitVolume > 0) ||
          nextVolume > Number(destinationCurrent.data.component.storageCapacity) + 1e-6) {
        return { success: false as const, errorMsg: "ASSEMBLY_CUSTODY_CAPACITY_EXCEEDED" };
      }
    }
    const commit = dependencies.itemStore.transferItemToOwnerLocation(
      sourceItemID,
      destinationOwnerID,
      destinationLocationID,
      destinationFlagID,
      moveQuantity,
      {
        operationKey: operationID,
        operationFingerprint,
        chainDigest: String(request.chainProof?.digest || ""),
        committedAtMs: now(),
        flush: true,
      },
    );
    if (!commit || commit.success !== true) return commit;
    return {
      success: true as const,
      replayed: commit.replayed === true,
      data: {
        ...commit.data,
        operationID,
        action,
        chainDigest: String(request.chainProof?.digest || ""),
        gameCommitted: true,
      },
    };
  }

  return { execute };
}

const runtime = createAssemblyCrossOwnerInventoryRuntime();

function registerAssemblyCustodyChainVerifier(verifier) {
  if (typeof verifier !== "function") throw new TypeError("Assembly custody chain verifier must be a function");
  verifyChainProof = verifier;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (verifyChainProof === verifier) verifyChainProof = null;
  };
}

module.exports = {
  createAssemblyCrossOwnerInventoryRuntime,
  registerAssemblyCustodyChainVerifier,
  executeCrossOwnerInventoryTransfer: runtime.execute,
  _testing: { fingerprint },
};
