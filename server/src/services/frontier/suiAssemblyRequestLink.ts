import { createHash, timingSafeEqual } from "node:crypto";
import { bcs } from "@mysten/sui/bcs";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { publicKeyFromRawBytes } from "@mysten/sui/verify";
import type { AssemblySnapshot } from "./suiAssemblySnapshot";
import type { SuiAssemblyChainObject } from "./suiAssemblyChain";

const LINK_VERSION = 1;
const DOMAIN = Buffer.from("EVEJS_SMART_ASSEMBLY_REQUEST_V1", "utf8");
const TERMINAL_PROOF_TTL_MS = 5 * 60 * 1000;
const PHASE = Object.freeze({ created: 0, fulfilled: 1, failed: 2, cancelled: 3 });

const AssemblyRequestAttestation = bcs.struct("AssemblyRequestAttestation", {
  domain: bcs.vector(bcs.u8()),
  version: bcs.u8(),
  phase: bcs.u8(),
  chain_id: bcs.string(),
  package_id: bcs.Address,
  object_registry_id: bcs.Address,
  server_registry_id: bcs.Address,
  server_address: bcs.Address,
  request_id: bcs.string(),
  source_local_id: bcs.u64(),
  source_object_id: bcs.Address,
  source_version: bcs.u64(),
  source_digest: bcs.string(),
  target_local_id: bcs.u64(),
  target_object_id: bcs.Address,
  target_version: bcs.u64(),
  target_digest: bcs.string(),
  request_commitment: bcs.vector(bcs.u8()),
  previous_attestation_hash: bcs.vector(bcs.u8()),
  outcome_commitment: bcs.vector(bcs.u8()),
  issued_at_ms: bcs.u64(),
  deadline_ms: bcs.u64(),
});

export type AssemblyRequestPhase = keyof typeof PHASE;
export type SuiAssemblyRequestObjectRef = {
  localAssemblyID: number;
  objectID: string;
  version: string;
  digest: string;
};
export type SuiAssemblyRequestAttestation = {
  version: number;
  scheme: "ED25519_SUI_PERSONAL_MESSAGE";
  phase: AssemblyRequestPhase;
  chainID: string;
  packageID: string;
  objectRegistryID: string;
  serverAddressRegistryID: string;
  serverAddress: string;
  requestID: string;
  source: SuiAssemblyRequestObjectRef;
  target: SuiAssemblyRequestObjectRef;
  requestCommitment: string;
  previousAttestationHash: string;
  outcomeCommitment: string;
  issuedAtMs: number;
  deadlineMs: number;
  messageBase64: string;
  signature: string;
  attestationHash: string;
};

export type SuiAssemblyRequestLinkBridge = {
  attestCreation(request: any): Promise<SuiAssemblyRequestAttestation>;
  verifyCreation(request: any, proof: SuiAssemblyRequestAttestation): Promise<boolean>;
  attestTerminal(request: any, phase: Exclude<AssemblyRequestPhase, "created">,
    outcome: any): Promise<SuiAssemblyRequestAttestation>;
  verifyTerminal(request: any, phase: Exclude<AssemblyRequestPhase, "created">,
    outcome: any, proof: SuiAssemblyRequestAttestation): Promise<boolean>;
};

let activeBridge: SuiAssemblyRequestLinkBridge | null = null;

export function registerSuiAssemblyRequestLinkBridge(bridge: SuiAssemblyRequestLinkBridge): () => void {
  activeBridge = bridge;
  return () => { if (activeBridge === bridge) activeBridge = null; };
}

export function getSuiAssemblyRequestLinkBridge(): SuiAssemblyRequestLinkBridge | null {
  return activeBridge;
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableBytes(value: any): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
}

function sha256(value: Uint8Array | string): Buffer {
  return createHash("sha256").update(value).digest();
}

function requestCommitment(request: any): string {
  return sha256(stableBytes({
    createdAtMs: request.createdAtMs,
    expiresAtMs: request.expiresAtMs,
    ownerID: request.ownerID,
    payload: request.payload,
    priority: request.priority,
    priorityFlags: request.priorityFlags,
    requestID: request.requestID,
    requestType: request.requestType,
    sourceAssemblyID: request.sourceAssemblyID,
    targetAssemblyID: request.targetAssemblyID,
  })).toString("hex");
}

function outcomeCommitment(phase: AssemblyRequestPhase, outcome: any): string {
  return phase === "created"
    ? Buffer.alloc(32).toString("hex")
    : sha256(stableBytes({ outcome, phase })).toString("hex");
}

function hashBytes(value: unknown, label: string): Buffer {
  const normalized = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hash`);
  return Buffer.from(normalized, "hex");
}

function safeU64(value: unknown, label: string): bigint {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be an unsigned integer`);
  const numeric = BigInt(String(value));
  if (numeric < 0n || numeric >= 1n << 64n) throw new Error(`${label} exceeds u64`);
  return numeric;
}

function objectRef(localAssemblyID: number, value: SuiAssemblyChainObject): SuiAssemblyRequestObjectRef {
  if (!/^\d+$/.test(String(value.version)) || !String(value.digest || "")) {
    throw new Error(`Assembly ${localAssemblyID} is missing its immutable Sui object reference`);
  }
  return {
    localAssemblyID,
    objectID: normalizeSuiAddress(value.id),
    version: String(value.version),
    digest: String(value.digest),
  };
}

function messageBytes(proof: Omit<SuiAssemblyRequestAttestation,
  "messageBase64" | "signature" | "attestationHash">): Uint8Array {
  const phase = PHASE[proof.phase];
  if (phase === undefined) throw new Error("Unsupported assembly request proof phase");
  return AssemblyRequestAttestation.serialize({
    domain: [...DOMAIN],
    version: proof.version,
    phase,
    chain_id: proof.chainID,
    package_id: normalizeSuiAddress(proof.packageID),
    object_registry_id: normalizeSuiAddress(proof.objectRegistryID),
    server_registry_id: normalizeSuiAddress(proof.serverAddressRegistryID),
    server_address: normalizeSuiAddress(proof.serverAddress),
    request_id: proof.requestID,
    source_local_id: safeU64(proof.source.localAssemblyID, "source assembly ID"),
    source_object_id: normalizeSuiAddress(proof.source.objectID),
    source_version: safeU64(proof.source.version, "source object version"),
    source_digest: proof.source.digest,
    target_local_id: safeU64(proof.target.localAssemblyID, "target assembly ID"),
    target_object_id: normalizeSuiAddress(proof.target.objectID),
    target_version: safeU64(proof.target.version, "target object version"),
    target_digest: proof.target.digest,
    request_commitment: [...hashBytes(proof.requestCommitment, "request commitment")],
    previous_attestation_hash: [...hashBytes(proof.previousAttestationHash, "previous attestation hash")],
    outcome_commitment: [...hashBytes(proof.outcomeCommitment, "outcome commitment")],
    issued_at_ms: safeU64(proof.issuedAtMs, "proof issue time"),
    deadline_ms: safeU64(proof.deadlineMs, "proof deadline"),
  }).toBytes();
}

function proofHash(message: Uint8Array, signature: string): string {
  return sha256(Buffer.concat([Buffer.from(message), Buffer.from(signature, "base64")])).toString("hex");
}

export async function createSuiAssemblyRequestAttestation(options: {
  signer: Ed25519Keypair;
  phase: AssemblyRequestPhase;
  chainID: string;
  packageID: string;
  objectRegistryID: string;
  serverAddressRegistryID: string;
  request: any;
  source: SuiAssemblyRequestObjectRef;
  target: SuiAssemblyRequestObjectRef;
  outcome?: any;
  previousAttestationHash?: string;
  issuedAtMs?: number;
  deadlineMs?: number;
}): Promise<SuiAssemblyRequestAttestation> {
  const issuedAtMs = options.issuedAtMs ?? Date.now();
  const previous = options.phase === "created"
    ? Buffer.alloc(32).toString("hex")
    : String(options.previousAttestationHash || "").toLowerCase();
  const unsigned = {
    version: LINK_VERSION,
    scheme: "ED25519_SUI_PERSONAL_MESSAGE" as const,
    phase: options.phase,
    chainID: String(options.chainID).toLowerCase(),
    packageID: normalizeSuiAddress(options.packageID),
    objectRegistryID: normalizeSuiAddress(options.objectRegistryID),
    serverAddressRegistryID: normalizeSuiAddress(options.serverAddressRegistryID),
    serverAddress: normalizeSuiAddress(options.signer.toSuiAddress()),
    requestID: String(options.request.requestID).toLowerCase(),
    source: options.source,
    target: options.target,
    requestCommitment: requestCommitment(options.request),
    previousAttestationHash: previous,
    outcomeCommitment: outcomeCommitment(options.phase, options.outcome),
    issuedAtMs,
    deadlineMs: options.deadlineMs ?? (options.phase === "created"
      ? Number(options.request.expiresAtMs)
      : issuedAtMs + TERMINAL_PROOF_TTL_MS),
  };
  const message = messageBytes(unsigned);
  const signed = await options.signer.signWithIntent(message, "PersonalMessage");
  return {
    ...unsigned,
    messageBase64: Buffer.from(message).toString("base64"),
    signature: signed.signature,
    attestationHash: proofHash(message, signed.signature),
  };
}

export async function verifySuiAssemblyRequestAttestation(options: {
  request: any;
  proof: SuiAssemblyRequestAttestation;
  phase: AssemblyRequestPhase;
  outcome?: any;
  previousAttestationHash?: string;
  expected?: Partial<Pick<SuiAssemblyRequestAttestation,
    "chainID" | "packageID" | "objectRegistryID" | "serverAddressRegistryID">>;
  now?: number;
  enforceDeadline?: boolean;
}): Promise<boolean> {
  try {
    const proof = options.proof;
    if (!proof || proof.version !== LINK_VERSION || proof.scheme !== "ED25519_SUI_PERSONAL_MESSAGE" ||
        proof.phase !== options.phase || proof.requestID !== String(options.request.requestID).toLowerCase() ||
        proof.source?.localAssemblyID !== Number(options.request.sourceAssemblyID) ||
        proof.target?.localAssemblyID !== Number(options.request.targetAssemblyID) ||
        proof.requestCommitment !== requestCommitment(options.request) ||
        proof.outcomeCommitment !== outcomeCommitment(options.phase, options.outcome)) return false;
    if (options.phase !== "created" &&
        proof.previousAttestationHash !== String(options.previousAttestationHash || "").toLowerCase()) return false;
    if (options.phase === "created" && proof.previousAttestationHash !== Buffer.alloc(32).toString("hex")) return false;
    for (const key of ["chainID", "packageID", "objectRegistryID", "serverAddressRegistryID"] as const) {
      const expected = options.expected?.[key];
      if (expected !== undefined && String(proof[key]).toLowerCase() !== String(expected).toLowerCase()) return false;
    }
    if (options.enforceDeadline !== false && proof.deadlineMs < (options.now ?? Date.now())) return false;
    if (proof.issuedAtMs > proof.deadlineMs) return false;
    const unsigned: any = { ...proof };
    delete unsigned.messageBase64; delete unsigned.signature; delete unsigned.attestationHash;
    const message = messageBytes(unsigned);
    const storedMessage = Buffer.from(proof.messageBase64, "base64");
    if (message.length !== storedMessage.length || !timingSafeEqual(Buffer.from(message), storedMessage)) return false;
    if (proof.attestationHash !== proofHash(message, proof.signature)) return false;
    const parsed = parseSerializedSignature(proof.signature);
    if (parsed.signatureScheme !== "ED25519" || !parsed.signature || !parsed.publicKey) return false;
    const publicKey = publicKeyFromRawBytes(parsed.signatureScheme, parsed.publicKey);
    if (normalizeSuiAddress(publicKey.toSuiAddress()) !== normalizeSuiAddress(proof.serverAddress)) return false;
    return publicKey.verifyWithIntent(message, parsed.signature, "PersonalMessage");
  } catch (_) {
    return false;
  }
}

function tableId(value: any): string {
  const fields = value && typeof value === "object" && value.fields ? value.fields : value;
  const id = fields?.id?.id ?? fields?.id;
  if (typeof id !== "string") throw new Error("Server address registry table is missing");
  return normalizeSuiAddress(id);
}

export function createSuiAssemblyRequestLinkBridge(options: {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  getContext(): any;
  getSnapshot(): { assemblies: AssemblySnapshot[] };
  hasPrepared?(): boolean;
  now?: () => number;
}): SuiAssemblyRequestLinkBridge {
  const now = options.now ?? Date.now;

  async function withContext<T>(operation: (context: any) => Promise<T>): Promise<T> {
    return options.runExclusive(async () => {
      const context = options.getContext();
      if (!context) throw Object.assign(new Error("Assembly synchronization is starting"), { code: "ASSEMBLY_REQUEST_CHAIN_UNAVAILABLE" });
      if (options.hasPrepared?.()) throw Object.assign(new Error("An assembly owner transaction is pending"), { code: "ASSEMBLY_REQUEST_CHAIN_UNAVAILABLE" });
      await context.assertCurrent();
      if (!context.world.serverAddressRegistryId) throw new Error("Server address registry is not deployed");
      await assertAuthorized(context);
      return operation(context);
    });
  }

  async function assertAuthorized(context: any): Promise<void> {
    const response = await context.client.getObject({
      id: context.world.serverAddressRegistryId,
      options: { showContent: true, showType: true },
    });
    const content = response.data?.content;
    if (response.error || content?.dataType !== "moveObject") throw new Error("Cannot read the server address registry");
    const fields: any = content.fields;
    const authorizedTable = tableId(fields.authorized_address);
    const signer = normalizeSuiAddress(context.adminSigner.toSuiAddress());
    const entry = await context.client.getDynamicFieldObject({
      parentId: authorizedTable,
      name: { type: "address", value: signer },
    });
    if (entry.error || entry.data?.content?.dataType !== "moveObject") {
      throw Object.assign(new Error("Queue signer is not authorized by the deployed Sui world"), {
        code: "ASSEMBLY_REQUEST_CHAIN_SIGNER_UNAUTHORIZED",
      });
    }
  }

  async function refs(context: any, request: any) {
    const snapshot = options.getSnapshot().assemblies;
    const source = snapshot.find(value => value.itemId === String(request.sourceAssemblyID));
    const target = snapshot.find(value => value.itemId === String(request.targetAssemblyID));
    if (!source || !target) throw new Error("Queue assemblies are absent from the current Sui snapshot");
    const [sourceState, targetState] = await Promise.all([
      context.chain.readAssembly(source), context.chain.readAssembly(target),
    ]);
    if (!sourceState || !targetState) throw new Error("Queue assemblies are not anchored on Sui");
    return {
      source: objectRef(Number(request.sourceAssemblyID), sourceState),
      target: objectRef(Number(request.targetAssemblyID), targetState),
    };
  }

  function expected(context: any) {
    return {
      chainID: context.synced.chainId,
      packageID: context.synced.packageId,
      objectRegistryID: context.synced.objectRegistryId,
      serverAddressRegistryID: context.world.serverAddressRegistryId,
    };
  }

  async function attest(request: any, phase: AssemblyRequestPhase, outcome?: any) {
    return withContext(async context => {
      const bound = await refs(context, request);
      await context.assertCurrent();
      return createSuiAssemblyRequestAttestation({
        signer: context.adminSigner,
        phase,
        ...expected(context),
        request,
        ...bound,
        outcome,
        previousAttestationHash: request.chainLink?.creation?.attestationHash,
        issuedAtMs: now(),
      });
    });
  }

  async function verify(request: any, proof: SuiAssemblyRequestAttestation,
    phase: AssemblyRequestPhase, outcome?: any) {
    return withContext(async context => verifySuiAssemblyRequestAttestation({
      request, proof, phase, outcome,
      previousAttestationHash: phase === "created" ? undefined : request.chainLink?.creation?.attestationHash,
      expected: expected(context), now: now(), enforceDeadline: phase === "created",
    }));
  }

  return {
    attestCreation: request => attest(request, "created"),
    verifyCreation: (request, proof) => verify(request, proof, "created"),
    attestTerminal: (request, phase, outcome) => attest(request, phase, outcome),
    verifyTerminal: (request, phase, outcome, proof) => verify(request, proof, phase, outcome),
  };
}
