import { randomUUID } from "node:crypto";
import { createSmartStorageApi } from "./smartStorageEndpoints";

const PREFIX = "/evejs/faction-tasks";
const NODE_TYPE_ID = 88092;
const TASK_TYPES = new Set([
  "maintenance.inspect",
  "defense.scan",
  "logistics.transfer",
  "production.run",
]);

function positiveID(value: unknown): number {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function failed(errorMsg: string) {
  return { success: false as const, errorMsg };
}

function defaultDependencies() {
  const itemStore = require("../../services/inventory/itemStore");
  const deployment = require("../../services/frontier/deploymentRuntime");
  const { readSyncedSuiWorldConfig, SUI_CHARACTER_TENANT } = require("../../services/frontier/suiCharacterProvisioning");
  const { readSuiNpcWorldConfig } = require("../../services/frontier/suiNpcWorldConfig");
  const { suiGrpcClient } = require("../../services/frontier/suiGrpcClient");
  return {
    item: (id: number) => itemStore.findItemById(id),
    metadata: deployment.readNpcConstructionMetadata,
    world: () => {
      const synced = readSyncedSuiWorldConfig();
      if (!synced) return null;
      const features = readSuiNpcWorldConfig(synced);
      if (features.capabilities?.transponder?.status === "unavailable") return null;
      return {
        packageId: features.transponderPackageId,
        typeOrigin: features.transponderTypeOrigin,
        transponderRegistryId: features.transponderRegistryId,
        objectRegistryId: synced.objectRegistryId,
        tenant: SUI_CHARACTER_TENANT,
      };
    },
    client: suiGrpcClient,
    requests: require("../../services/frontier/smartAssemblyRequestRuntime"),
  };
}

/** Every submission re-reads the chain commitment and the live faction registration. */
export function createSmartFactionTaskApi(overrides: Record<string, any> = {}) {
  const auth = overrides.auth || createSmartStorageApi(overrides.authDependencies, {
    scope: "Network Node faction tasking",
    description: "This signature authorizes a session for verified faction task requests from a registered Network Node.",
  });
  const dependencies = overrides.dependencies || defaultDependencies();
  const { deriveSuiTransponderCommitmentObjectId, parseSuiTransponderCommitmentObject,
    verifySuiTransponderCommitment } = require("../../services/frontier/suiTransponderCommitment");

  async function verified(authorization: unknown, rawNodeID: unknown, body: any, requireTarget: boolean) {
    const identity = auth.authenticate(authorization);
    if (!identity.success) return identity;
    if (typeof body?.code !== "string" || !body.code.trim() || body.code.trim().length > 32 ||
        /[\u0000-\u001f\u007f]/.test(body.code) ||
        typeof body?.salt !== "string" || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(body.salt))
      return failed("TRANSPONDER_CODE_INVALID");
    const nodeID = positiveID(rawNodeID);
    const targetID = requireTarget ? positiveID(body?.targetAssemblyID) : 0;
    if (!nodeID || requireTarget && !targetID) return failed("INVALID_ASSEMBLY_ID");
    const node = dependencies.item(nodeID);
    const nodeMetadata = dependencies.metadata(node);
    if (!node || Number(node.typeID) !== NODE_TYPE_ID ||
        !nodeMetadata || nodeMetadata.registeredForFaction !== true ||
        typeof nodeMetadata.factionKey !== "string" || !nodeMetadata.factionKey) {
      return failed("FACTION_COMMAND_NODE_UNAVAILABLE");
    }
    if (requireTarget) {
      const target = dependencies.item(targetID);
      const metadata = dependencies.metadata(target);
      if (!target || !metadata || metadata.registeredForFaction !== true ||
          metadata.factionKey !== nodeMetadata.factionKey ||
          Number(metadata.commandNodeID) !== nodeID) return failed("FACTION_TARGET_DENIED");
    }
    const world = dependencies.world();
    if (!world) return failed("TRANSPONDER_DEPLOYMENT_UNAVAILABLE");
    let state: any;
    try {
      const scope = { kind: "faction", factionKey: nodeMetadata.factionKey };
      const objectId = deriveSuiTransponderCommitmentObjectId(world, scope);
      const response = await dependencies.client.getObject({ objectId, include: { json: true } });
      state = parseSuiTransponderCommitmentObject(response?.object, world, scope);
      if (state.revoked || !verifySuiTransponderCommitment(state.commitment, {
        objectRegistryId: state.registryId, tenant: state.tenant, scope,
        revision: state.revision, code: body?.code, salt: body?.salt,
      })) return failed("TRANSPONDER_CODE_INVALID");
    } catch { return failed("TRANSPONDER_VERIFICATION_UNAVAILABLE"); }
    // The wallet session can expire while Sui is queried. Recheck before any write.
    const current = auth.authenticate(authorization);
    if (!current.success || current.data.characterID !== identity.data.characterID ||
        current.data.walletAddress !== identity.data.walletAddress) return failed("AUTH_EXPIRED");
    const freshNode = dependencies.item(nodeID);
    const freshMetadata = dependencies.metadata(freshNode);
    if (!freshNode || Number(freshNode.typeID) !== NODE_TYPE_ID ||
        freshMetadata?.registeredForFaction !== true ||
        freshMetadata.factionKey !== nodeMetadata.factionKey) return failed("FACTION_COMMAND_NODE_UNAVAILABLE");
    if (requireTarget) {
      const freshTarget = dependencies.item(targetID);
      const freshTargetMetadata = dependencies.metadata(freshTarget);
      if (!freshTarget || freshTargetMetadata?.registeredForFaction !== true ||
          freshTargetMetadata.factionKey !== nodeMetadata.factionKey ||
          Number(freshTargetMetadata.commandNodeID) !== nodeID) return failed("FACTION_TARGET_DENIED");
    }
    return { success: true as const, data: {
      nodeID, targetID, factionKey: nodeMetadata.factionKey,
      characterID: current.data.characterID,
      walletAddress: current.data.walletAddress,
      commitmentID: state.objectId, revision: state.revision,
    } };
  }

  return {
    challenge: (body: any) => auth.challenge({ walletAddress: body?.walletAddress }),
    session: (body: any) => auth.session({ challengeId: body?.challengeId, signature: body?.signature }),
    async verify(authorization: unknown, nodeID: unknown, body: any) {
      const result = await verified(authorization, nodeID, body, false);
      if (!result.success) return result;
      const { factionKey, commitmentID, revision } = result.data;
      return { success: true as const, data: { factionKey, commitmentID, revision } };
    },
    async submit(authorization: unknown, nodeID: unknown, body: any) {
      if (!TASK_TYPES.has(body?.requestType)) return failed("FACTION_TASK_TYPE_INVALID");
      const requestID = typeof body?.requestID === "string" ? body.requestID : randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestID))
        return failed("FACTION_TASK_REQUEST_ID_INVALID");
      const result = await verified(authorization, nodeID, body, true);
      if (!result.success) return result;
      const data = result.data;
      const requested = await dependencies.requests.createRequest(data.nodeID, data.targetID, body.requestType, {
        allowCrossOwner: true,
        requestID,
        payload: {
          operator: { characterID: data.characterID, walletAddress: data.walletAddress },
          membership: { verified: true, scope: "faction", factionKey: data.factionKey,
            commitmentID: data.commitmentID, revision: data.revision },
        },
      });
      return requested?.success ? { success: true as const, data: {
        requestID: requested.data.requestID, status: requested.data.status,
        created: requested.created === true,
      } } : failed(requested?.errorMsg || "FACTION_TASK_SUBMISSION_FAILED");
    },
  };
}

export function mountSmartFactionTaskEndpoints(app: any, options: Record<string, any> = {}) {
  let api: ReturnType<typeof createSmartFactionTaskApi>;
  const getApi = () => api || (api = options.api || createSmartFactionTaskApi());
  const origins = new Set(String(process.env.EVEJS_FACTION_TASK_DAPP_ORIGINS ||
    "https://localhost,https://127.0.0.1,https://dev.dapps.evefrontier.com")
    .split(",").map(value => value.trim()));
  app.use(PREFIX, (req: any, res: any, next: any) => {
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  const route = (handler: (api: ReturnType<typeof createSmartFactionTaskApi>, req: any) => Promise<any>) =>
    async (req: any, res: any) => {
      try {
        const result = await handler(getApi(), req);
        res.status(result.success ? 200 : /^AUTH_|^INVALID_SIGNATURE/.test(result.errorMsg) ? 401 :
          /_UNAVAILABLE$/.test(result.errorMsg) ? 503 : /_INVALID$/.test(result.errorMsg) ? 400 : 403).json(result);
      } catch { res.status(500).json(failed("FACTION_TASK_SUBMISSION_FAILED")); }
    };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  app.post(`${PREFIX}/:nodeID/verify`, route((service, req) => service.verify(req.headers.authorization, req.params.nodeID, req.body)));
  app.post(`${PREFIX}/:nodeID/submit`, route((service, req) => service.submit(req.headers.authorization, req.params.nodeID, req.body)));
}
