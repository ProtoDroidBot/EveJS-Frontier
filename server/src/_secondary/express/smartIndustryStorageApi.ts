type Dependencies = Record<string, any> & {
  resolve: (authorization: unknown, facilityID: unknown) => any;
  failed: (code: unknown) => any;
};
export type IndustryRequestReceipts = Map<string, { fingerprint: string; result: Promise<any> }>;

const STORAGE_FLAG = 66;
const integer = (value: unknown) => ["string", "number"].includes(typeof value) &&
  /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const quantity = (item: any) => Number(item.singleton) === 1 ? 1 : Number(item.stacksize ?? item.quantity);
const store = () => require("../../services/inventory/itemStore");

function availableStorage(session: any, characterID: number) {
  const inventory = store();
  const access = require("../../services/frontier/industryInventoryAccess");
  const storage = require("../../services/frontier/smartStorageUnitRuntime");
  return Object.values<any>(inventory.getAllItems()).filter(item => storage.getStorageComponent(item.typeID))
    .flatMap(item => {
      const result = access.resolveIndustryInventory(session, item.itemID, STORAGE_FLAG);
      if (!result.success) return [];
      const rows = inventory.listContainerItems(characterID, item.itemID, STORAGE_FLAG);
      const items = rows.filter(row => !Number(row.singleton)).map(row => ({
        itemID: Number(row.itemID), typeID: Number(row.typeID),
        name: String(inventory.getItemMetadata(row.typeID)?.name || `Type ${row.typeID}`),
        quantity: quantity(row), unitVolume: Number(inventory.getInventoryItemUnitVolume(row)),
      }));
      return [{ storageUnitID: Number(item.itemID), name: String(item.itemName || item.name ||
        inventory.getItemMetadata(item.typeID)?.name || `Storage ${item.itemID}`),
      capacity: result.data.capacity,
      usedVolume: rows.reduce((total, row) => total + quantity(row) * Number(inventory.getInventoryItemUnitVolume(row)), 0), items }];
    }).sort((left, right) => left.storageUnitID - right.storageUnitID);
}

function sourceRows(characterID: number, storageUnitID: number, typeID: number) {
  return store().listContainerItems(characterID, storageUnitID, STORAGE_FLAG)
    .filter(item => Number(item.typeID) === typeID && !Number(item.singleton))
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
}

/** The connection token grants these operations on the live character only. */
export function createIndustryStorageOperations(dependencies: Dependencies) {
  const { resolve, failed } = dependencies;
  const runtime = () => require("../../services/frontier/industryRuntime");
  const validate = dependencies.validateFacility || ((session, id) => runtime().validateFacility(session, id));
  const settle = dependencies.settleProduction || ((id, session) =>
    require("../../services/frontier/industryProductionWorker").settleIndustryProduction(id, session));
  const list = dependencies.listStorage || availableStorage;
  const readRows = dependencies.readStorageRows || sourceRows;
  const deposit = dependencies.depositItems || ((...args) => runtime().depositInputItems(...args));
  const withdraw = dependencies.withdrawItems || ((...args) => runtime().withdrawItems(...args));
  const notify = dependencies.publishTransfer || ((session, result) =>
    require("../../services/frontier/industryService").publishIndustryTransferResult(session, result));
  const sync = dependencies.syncStorage || (request =>
    require("../../services/frontier/suiIndustryStorageSync").syncIndustryStorageTransfer(request));
  const requests: IndustryRequestReceipts = dependencies.requests || new Map();

  return {
    async storageSync(authorization: unknown, facilityID: unknown, body: any) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const context = resolve(authorization, facilityID);
        if (!context.success) return context;
        if (!integer(body?.storageUnitID)) return failed("INVALID_ASSEMBLY_ID");
        const work = Promise.resolve().then(() => sync({ facilityID: context.data.facilityID,
          characterID: context.data.characterID, storageUnitID: Number(body.storageUnitID) }));
        const chain = await Promise.race([work, new Promise(resolve => {
          timer = setTimeout(() => resolve({ status: "pending", industryStatus: "pending", storageStatus: "pending" }),
            dependencies.chainWaitMs ?? 5000);
        })]);
        const latest = resolve(authorization, facilityID);
        if (!latest.success) return latest;
        if (latest.data.characterID !== context.data.characterID || latest.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
        return { success: true as const, data: publicIndustryStorageChain(chain) };
      } catch { return { success: true as const, data: { status: "error", industryStatus: "error", storageStatus: "error" } }; }
      finally { if (timer) clearTimeout(timer); }
    },
    async storage(authorization: unknown, facilityID: unknown) {
      try {
        const context = resolve(authorization, facilityID);
        if (!context.success) return context;
        const valid = validate(context.data.session, context.data.facilityID);
        if (!valid.success) return failed(valid.errorMsg);
        return { success: true as const, data: { storageUnits: list(context.data.session, context.data.characterID) } };
      } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
    },
    async transfer(authorization: unknown, facilityID: unknown, body: any) {
      try {
        const context = resolve(authorization, facilityID);
        if (!context.success) return context;
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            typeof body.requestID !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestID) ||
            !["deposit", "withdraw"].includes(body.direction) || !["inputs", "outputs"].includes(body.side) ||
            (body.direction === "deposit" && body.side !== "inputs")) return failed("INVALID_REQUEST");
        if (!integer(body.storageUnitID)) return failed("INVALID_ASSEMBLY_ID");
        if (!integer(body.typeID) || Number(body.typeID) > 0xffffffff) return failed("INVALID_INPUT_TYPE");
        if (!integer(body.quantity) || Number(body.quantity) > 0xffffffff) return failed("INVALID_QUANTITY");
        const { characterID, walletAddress } = context.data;
        const request = { requestID: body.requestID.toLowerCase(), facilityID: context.data.facilityID,
          storageUnitID: Number(body.storageUnitID), typeID: Number(body.typeID), quantity: Number(body.quantity),
          direction: body.direction, side: body.side };
        const key = `${characterID}:${request.requestID}`;
        const fingerprint = JSON.stringify({ action: "transfer", ...request, walletAddress });
        const prior = requests.get(key);
        if (prior) return prior.fingerprint === fingerprint ? prior.result : failed("TRANSFER_REQUEST_CHANGED");
        // Receipts live as long as the API's in-memory auth sessions. Never evict
        // an accepted request and accidentally turn a delayed retry into a move.
        if (requests.size >= 10000) return failed("TOO_MANY_REQUESTS");
        const assertAccess = () => {
          const latest = resolve(authorization, facilityID);
          if (!latest.success) return latest;
          if (latest.data.characterID !== characterID || latest.data.walletAddress !== walletAddress ||
              latest.data.session !== context.data.session) return failed("ACCESS_DENIED");
          return validate(latest.data.session, request.facilityID);
        };
        // Install the promise before any asynchronous validation can yield. A
        // repeated request joins this exact operation, including its sync result.
        const result = Promise.resolve().then(async () => {
          try {
            const valid = assertAccess();
            if (!valid.success) return failed(valid.errorMsg);
            const settled = settle(request.facilityID, context.data.session);
            if (!settled.success) return failed(settled.errorMsg);
            let moved: any;
            const options = { assertAccess, storageUnitID: request.storageUnitID };
            if (request.direction === "deposit") {
              let remaining = request.quantity;
              const selected = new Map<number, number>();
              for (const row of readRows(characterID, request.storageUnitID, request.typeID)) {
                const amount = Math.min(remaining, quantity(row));
                if (!Number.isSafeInteger(amount) || amount <= 0) continue;
                selected.set(Number(row.itemID), amount);
                remaining -= amount;
                if (!remaining) break;
              }
              if (remaining) return failed("INSUFFICIENT_SOURCE_ITEMS");
              moved = await deposit(context.data.session, request.facilityID, selected, options);
            } else {
              moved = await withdraw(context.data.session, request.facilityID,
                new Map([[request.typeID, request.quantity]]), request.storageUnitID, STORAGE_FLAG, request.side, options);
            }
            if (!moved?.success) return failed(moved?.errorMsg);
            const committed = { success: true as const, data: {
              requestID: request.requestID, gameCommitted: true, storageUnitID: request.storageUnitID,
              direction: request.direction, side: request.side, items: { [request.typeID]: request.quantity },
              chain: publicIndustryStorageChain(moved.data.chain),
            } };
            try { notify(context.data.session, moved); } catch { /* Inventory is already durable. */ }
            return committed;
          } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
        });
        requests.set(key, { fingerprint, result });
        return result;
      } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
    },
  };
}

export function publicIndustryStorageChain(chain: any) {
  const states = ["synced", "pending", "error", "disabled"];
  const expected = chain?.industryStatus === "error" || chain?.storageStatus === "error" ? "error"
    : chain?.industryStatus === "disabled" && chain?.storageStatus === "disabled" ? "disabled"
      : chain?.industryStatus === "synced" && chain?.storageStatus === "synced" ? "synced" : "pending";
  return chain && states.includes(chain.industryStatus) && states.includes(chain.storageStatus) && chain.status === expected
    ? { status: chain.status, industryStatus: chain.industryStatus, storageStatus: chain.storageStatus }
    : { status: "pending", industryStatus: "pending", storageStatus: "pending" };
}
