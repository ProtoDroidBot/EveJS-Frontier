import { getNpcPilotIdentityStore } from "../../space/npc/npcPilotIdentityStore";
import {
  readLiveSuiChainIdentifier,
  resolveSuiCharacterWorld,
  type SuiCharacterWorld,
} from "./suiCharacterProvisioning";
import { suiGrpcClient } from "./suiGrpcClient";
import {
  prepareSuiNpcCharacterIdentity,
  provisionSuiNpcCharacter,
  type SuiNpcCharacterProvisioningOptions,
} from "./suiNpcCharacterProvisioning";

type Pilot = {
  characterID: number;
  characterName: string;
  factionKey: string;
  incarnation?: number;
  activeEntityID?: number | null;
  deaths?: number;
  sui?: Record<string, any>;
};
type IdentityStore = {
  list(): Pilot[];
  get(characterID: number): Pilot | null;
  update(characterID: number, updater: (pilot: Pilot) => Pilot): Pilot;
};
type WorkerOptions = {
  store?: IdentityStore;
  provision?: typeof provisionSuiNpcCharacter;
  provisioningOptions?: SuiNpcCharacterProvisioningOptions;
  resolveWorld?: () => SuiCharacterWorld;
  readChainId?: () => Promise<string | null>;
  now?: () => number;
  intervalMs?: number;
  batchSize?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  verifyIntervalMs?: number;
  report?: (message: string) => void;
  onSynced?: (pilot: Pilot) => void | Promise<void>;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

function positive(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function worldKey(identity: Partial<SuiCharacterWorld>) {
  return JSON.stringify([
    identity.packageId, identity.objectRegistryId, identity.adminAclId,
    identity.tenant, identity.tribeId,
  ]);
}

function errorCode(error: any) {
  // Do not copy arbitrary RPC errors, transaction bytes, or credentials to logs.
  return /^[A-Z0-9_]{1,80}$/.test(String(error?.code || ""))
    ? String(error.code) : "NPC_IDENTITY_SYNC_FAILED";
}

function lifecycle(pilot: Pilot) {
  return {
    incarnation: pilot.incarnation ?? 1,
    activeEntityID: pilot.activeEntityID ?? 0,
    deaths: pilot.deaths ?? 0,
  };
}

function lifecycleChanged(pilot: Pilot) {
  const desired = lifecycle(pilot);
  const confirmed = pilot.sui?.npcProfile;
  return !confirmed || Object.keys(desired).some(key => String(desired[key]) !== String(confirmed[key]));
}

export function isSuiNpcIdentitySyncEnabled(config: Record<string, any>) {
  return String(config.clientCompatibilityProfile || "").trim().toLowerCase() === "frontier" &&
    config.npcPilotIdentitiesEnabled !== false &&
    config.suiNpcCharacterProvisioningEnabled !== false;
}

/** Construction is inert; the server lifecycle explicitly starts this worker. */
export function createSuiNpcIdentitySyncWorker(options: WorkerOptions = {}) {
  const now = options.now || Date.now;
  const provision = options.provision || provisionSuiNpcCharacter;
  const provisioningOptions = options.provisioningOptions || {};
  const resolveWorld = options.resolveWorld || (() => resolveSuiCharacterWorld(
    provisioningOptions.world, provisioningOptions.env,
  ));
  const readChainId = options.readChainId || (() => readLiveSuiChainIdentifier(
    provisioningOptions.client || suiGrpcClient as any,
  ));
  const intervalMs = positive(options.intervalMs, 5_000);
  const batchSize = Math.min(100, positive(options.batchSize, 8));
  const retryBaseMs = positive(options.retryBaseMs, 5_000);
  const retryMaxMs = Math.max(retryBaseMs, positive(options.retryMaxMs, 300_000));
  const verifyIntervalMs = positive(options.verifyIntervalMs, 300_000);
  const schedule = options.setTimeout || setTimeout;
  const unschedule = options.clearTimeout || clearTimeout;
  let store = options.store;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<{ processed: number; confirmed: number; failed: number }> | null = null;
  let started = false;
  let stopping = false;
  let lastError = "";
  let lastRunAtMs = 0;

  function report(message: string) {
    if (message !== lastError) options.report?.(message);
    lastError = message;
  }

  async function reconcile() {
    const summary = { processed: 0, confirmed: 0, failed: 0 };
    store ||= getNpcPilotIdentityStore();
    const pilots = store.list();
    if (!pilots.length) return summary;
    const world = resolveWorld();
    const chainId = await readChainId();
    if (!chainId || !/^[0-9a-f]{8}$/.test(chainId)) {
      throw Object.assign(new Error("Localnet chain identity is unavailable"), { code: "NPC_CHAIN_UNAVAILABLE" });
    }
    const dueAt = (pilot: Pilot) => {
      const binding = pilot.sui || {};
      if ((binding.identity && worldKey(binding.identity) !== worldKey(world)) ||
        (binding.chainId && binding.chainId !== chainId)) return 0;
      return binding.status === "confirmed"
        ? (lifecycleChanged(pilot) ? 0 : Number(binding.lastVerifiedAtMs || 0) + verifyIntervalMs)
        : Number(binding.nextAttemptAtMs || 0);
    };
    // Oldest due first prevents repeatedly verifying the first batch while a
    // large faction's later pilots wait indefinitely for initial provisioning.
    pilots.sort((left, right) => dueAt(left) - dueAt(right) || left.characterID - right.characterID);
    for (const listed of pilots) {
      if (stopping || summary.processed >= batchSize) break;
      const pilot = store.get(listed.characterID);
      if (!pilot) continue;
      const previous = pilot.sui || {};
      const changed = Boolean(
        (previous.identity && worldKey(previous.identity) !== worldKey(world)) ||
        (previous.chainId && previous.chainId !== chainId),
      );
      const stamp = now();
      if (!changed && Number(previous.nextAttemptAtMs || 0) > stamp) continue;
      if (!changed && !lifecycleChanged(pilot) && previous.status === "confirmed" &&
        Number(previous.lastVerifiedAtMs || 0) + verifyIntervalMs > stamp) continue;
      summary.processed++;
      try {
        const input = {
          gameCharacterId: pilot.characterID,
          characterName: pilot.characterName,
          factionKey: pilot.factionKey,
          lifecycle: lifecycle(pilot),
        };
        if (!changed && previous.transactionDigest && !previous.identity) {
          throw Object.assign(new Error("Prepared NPC identity is missing"), { code: "PENDING_IDENTITY_MISSING" });
        }
        if (!changed && previous.status !== "confirmed" && previous.transactionDigest && !previous.chainId) {
          throw Object.assign(new Error("Prepared NPC chain identity is missing"), { code: "PENDING_TRANSACTION_CHAIN_UNKNOWN" });
        }
        // Archive a previous world's signed journal. It must never be replayed
        // against a new chain/registry even when a regenerated world reuses IDs.
        const { previousWorlds = [], ...oldBinding } = previous;
        const history = changed ? [...previousWorlds, oldBinding] : previousWorlds;
        const retrying = !changed && previous.status !== "confirmed";
        const identity = retrying && previous.identity
          ? previous.identity
          : prepareSuiNpcCharacterIdentity(input, { world, env: {} });
        const pending = retrying ? {
          transactionDigest: previous.transactionDigest,
          transactionBytesBase64: previous.transactionBytesBase64,
          transactionSignature: previous.transactionSignature,
        } : { transactionDigest: undefined, transactionBytesBase64: undefined, transactionSignature: undefined };
        store.update(pilot.characterID, current => ({
          ...current,
          sui: {
            ...(!changed ? previous : {}),
            ...identity, identity, chainId, status: "pending", ...pending,
            attempts: changed ? 0 : Number(previous.attempts || 0),
            previousWorlds: history,
          },
        }));
        const result = await provision({ ...input, identity, chainId, ...pending,
          npcWorld: changed ? undefined : previous.npcWorld,
          npcProfileJournal: changed ? undefined : previous.npcProfileJournal,
        }, {
          ...provisioningOptions,
          async onTransactionPrepared(prepared) {
            store!.update(pilot.characterID, current => ({
              ...current,
              sui: { ...current.sui, ...prepared, status: "pending" },
            }));
            await provisioningOptions.onTransactionPrepared?.(prepared);
          },
          async onCharacterProvisioned(character) {
            store!.update(pilot.characterID, current => ({
              ...current,
              sui: {
                ...current.sui, ...character, identity,
                characterTransactionDigest: character.transactionDigest,
                transactionDigest: undefined, transactionBytesBase64: undefined, transactionSignature: undefined,
                status: "pending",
              },
            }));
            await provisioningOptions.onCharacterProvisioned?.(character);
          },
          async onNpcProfileTransactionPrepared(journal) {
            store!.update(pilot.characterID, current => ({
              ...current, sui: { ...current.sui, npcProfileJournal: journal, status: "pending" },
            }));
            await provisioningOptions.onNpcProfileTransactionPrepared?.(journal);
          },
        });
        const confirmed = store.update(pilot.characterID, current => ({
          ...current,
          sui: {
            ...result, identity, chainId: result.chainId || chainId,
            status: "confirmed", attempts: 0, nextAttemptAtMs: 0,
            lastVerifiedAtMs: now(), previousWorlds: current.sui?.previousWorlds || [],
          },
        }));
        summary.confirmed++;
        try { await options.onSynced?.(confirmed); }
        catch { report(`NPC ${pilot.characterID}: RUNTIME_REFRESH_FAILED`); }
      } catch (error) {
        summary.failed++;
        const code = errorCode(error);
        store.update(pilot.characterID, current => {
          const binding = { ...current.sui };
          const attempts = Number(binding.attempts || 0) + 1;
          if ((error as any)?.npcProfileOperation) {
            if (code === "TRANSACTION_FAILED") {
              binding.lastFailedNpcProfileTransaction = binding.npcProfileJournal;
              delete binding.npcProfileJournal;
            }
          } else if (code === "TRANSACTION_FAILED") {
            binding.lastFailedTransaction = {
              transactionDigest: (error as any)?.transactionDigest || binding.transactionDigest,
              chainId: binding.chainId,
            };
            delete binding.transactionDigest;
            delete binding.transactionBytesBase64;
            delete binding.transactionSignature;
          } else if ((error as any)?.transactionDigest && !binding.transactionDigest) {
            binding.transactionDigest = (error as any).transactionDigest;
          }
          return { ...current, sui: {
            ...binding, status: "retry", attempts, lastErrorCode: code,
            nextAttemptAtMs: now() + Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(attempts - 1, 20)),
          } };
        });
        report(`NPC ${pilot.characterID}: ${code}`);
      }
    }
    return summary;
  }

  function runOnce() {
    if (running) return running;
    if (stopping) return Promise.resolve({ processed: 0, confirmed: 0, failed: 0 });
    running = reconcile().catch(error => {
      report(errorCode(error));
      return { processed: 0, confirmed: 0, failed: 1 };
    }).finally(() => { lastRunAtMs = now(); running = null; });
    return running;
  }

  function queueNext() {
    if (!started || stopping) return;
    timer = schedule(() => {
      timer = null;
      void runOnce().then(queueNext);
    }, intervalMs);
    timer.unref?.();
  }

  function start() {
    if (started) return;
    started = true;
    stopping = false;
    void runOnce().then(queueNext);
  }

  async function stop() {
    started = false;
    stopping = true;
    if (timer) unschedule(timer);
    timer = null;
    await running;
  }

  return { runOnce, start, stop, getStatus: () => ({ started, running: Boolean(running), lastRunAtMs, lastError }) };
}

let liveWorker: ReturnType<typeof createSuiNpcIdentitySyncWorker> | null = null;

export function startSuiNpcIdentitySync() {
  const config = require("../../config");
  if (!isSuiNpcIdentitySyncEnabled(config)) return null;
  if (!liveWorker) {
    const log = require("../../utils/logger");
    liveWorker = createSuiNpcIdentitySyncWorker({
      report: message => log.warn(`[SuiNpcIdentity] ${message}`),
      onSynced: pilot => require("../../space/npc/nativeNpcService").refreshNativeNpcPilotIdentity(pilot.characterID),
    });
  }
  liveWorker.start();
  return liveWorker;
}

export async function stopSuiNpcIdentitySync() {
  await liveWorker?.stop();
}
