const BaseService = require("../baseService");
const { createHash } = require("crypto");
const { throwWrappedUserError } = require("../../common/machoErrors");
const TABLE = "frontierKillReports";

function createSmartKillReportRuntime(options: Record<string, any>) {
  const repo = options.repo, now = options.now || Date.now;
  function authorized(session, killID) {
    const id = Number(session?.characterID || session?.charid);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(killID) || killID <= 0) throw new Error("INVALID_KILL_REPORT");
    const record = options.getKillmail(killID);
    if (!record || ![record.victimCharacterID, record.finalCharacterID, ...(record.attackers || []).map(row => row.characterID)].some(value => Number(value) === id)) throw new Error("KILL_REPORT_ACCESS_DENIED");
    const wallet = options.getWallet(session);
    if (!/^0x[0-9a-fA-F]{64}$/.test(wallet || "")) throw new Error("KILL_REPORT_WALLET_REQUIRED");
    const profile = options.profile?.() || "local";
    if (profile !== "local" && !options.submitReport) throw new Error("KILL_REPORT_BACKEND_UNAVAILABLE");
    return { id, wallet: wallet.toLowerCase(), profile, record, key: `${profile}:${killID}` };
  }
  function read(key) {
    const ensured = repo.ensureTable(TABLE); if (ensured?.success === false) throw new Error("KILL_REPORT_STORE_UNAVAILABLE");
    const result = repo.read(TABLE, `/${key}`); return result?.success ? result.data : null;
  }
  function commit(key, row) {
    const result = repo.commitAtomicRowWrites([repo.prepareAtomicRowWrite(TABLE, key, row)]);
    if (!result?.success) throw new Error(result?.errorMsg || "KILL_REPORT_WRITE_FAILED");
  }
  function provenance(record) { return createHash("sha256").update(JSON.stringify(record)).digest("hex"); }
  function assertProvenance(row, hash) {
    if (row && row.provenanceHash !== hash) throw new Error("KILL_REPORT_PROVENANCE_CHANGED");
  }
  async function reportKill(session, killID) {
    const auth = authorized(session, killID), previous = read(auth.key);
    const provenanceHash = provenance(auth.record);
    assertProvenance(previous, provenanceHash);
    if (previous?.status === "accepted") return previous;
    const row = previous || { version: 1, killID, profile: auth.profile, reporterCharacterID: auth.id, wallet: auth.wallet,
      provenanceHash, idempotencyKey: createHash("sha256").update(`${auth.profile}:${killID}:${provenanceHash}`).digest("hex"),
      status: "pending", createdAtMs: now() };
    if (!previous) commit(auth.key, row);
    // A configured external adapter must return a confirmed receipt for this
    // exact idempotency key. Local reporting is explicitly a server ledger.
    const receipt = auth.profile === "local" ? { backend: "local", reference: row.idempotencyKey,
      confirmed: true, idempotencyKey: row.idempotencyKey, provenanceHash: row.provenanceHash } :
      await options.submitReport({ ...row, killmail: auth.record });
    if (!receipt || receipt.backend !== auth.profile || receipt.confirmed !== true ||
      receipt.idempotencyKey !== row.idempotencyKey || receipt.provenanceHash !== row.provenanceHash ||
      typeof receipt.reference !== "string" || !receipt.reference.trim().length) throw new Error("KILL_REPORT_NOT_CONFIRMED");
    // The configured adapter can yield. Recheck live authorization and the
    // authoritative kill record before publishing its returned receipt.
    const refreshed = authorized(session, killID);
    if (refreshed.id !== auth.id || refreshed.wallet !== auth.wallet || refreshed.key !== auth.key) throw new Error("KILL_REPORT_AUTHORITY_CHANGED");
    assertProvenance(row, provenance(refreshed.record));
    const current = read(auth.key);
    assertProvenance(current, provenanceHash);
    if (!current || current.idempotencyKey !== row.idempotencyKey) throw new Error("KILL_REPORT_INTENT_CHANGED");
    if (current?.status === "accepted") return current;
    const accepted = { ...row, status: "accepted", receipt, acceptedAtMs: now() };
    commit(auth.key, accepted);
    return accepted;
  }
  function alreadyReported(session, killID) {
    const auth = authorized(session, killID), row = read(auth.key);
    assertProvenance(row, provenance(auth.record));
    return row?.status === "accepted";
  }
  return { reportKill, alreadyReported };
}

let production;
function getRuntime() {
  if (!production) production = createSmartKillReportRuntime({
    repo: require("../../gameStore/tableRepository").createTableRepository("service:frontier-claims", { strict: true }),
    getKillmail: require("../killmail/killmailState").getKillmailRecord,
    profile: () => require("../../config").frontierClaimsPolicy?.killReportingProfile || "local",
    getWallet(session) {
      const record = require("../character/characterState").getCharacterRecord(Number(session?.characterID || session?.charid));
      return record?.suiWalletAddress || record?.suiCharacterIdentity?.walletAddress || record?.suiIdentity?.walletAddress || "";
    },
  });
  return production;
}
class SmartKillMailService extends BaseService {
  declare runtime: any;
  constructor(options: Record<string, any> = {}) { super("smartKillMailService"); this.runtime = options.runtime; }
  async Handle_report_kill(args, session) {
    try { await (this.runtime || getRuntime()).reportKill(session, Number(args?.[0])); return null; }
    catch (error) { throwWrappedUserError("CustomNotify", { notify: error.message }); }
  }
  Handle_kill_already_reported(args, session) {
    try { return (this.runtime || getRuntime()).alreadyReported(session, Number(args?.[0])); }
    catch (error) { throwWrappedUserError("CustomNotify", { notify: error.message }); }
  }
}
module.exports = SmartKillMailService;
module.exports.createSmartKillReportRuntime = createSmartKillReportRuntime;
