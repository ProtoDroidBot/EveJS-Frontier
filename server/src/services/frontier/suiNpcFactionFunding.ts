import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import { deriveLocalNpcFactionSuiWalletAddress } from "./suiNpcCharacterProvisioning";

type NpcFactionFundingConfig = {
  enabled: boolean;
  budgetMist: string;
  faucetEnabled: boolean;
  gasReserveMist: string;
  maxFaucetRequests: number;
};

type ConfiguredNpcFaction = {
  factionID?: unknown;
  factionKey?: unknown;
  name?: unknown;
};

type NpcFactionWalletBudget = {
  factionKey: string;
  factionName: string;
  walletAddress: string;
  balanceMist: bigint;
  deficitMist: bigint;
};

type NpcFactionFundingClient = {
  getBalance(options: { owner: string; signal?: AbortSignal }): Promise<any>;
  signAndExecuteTransaction(options: Record<string, any>): Promise<any>;
  waitForTransaction?(options: Record<string, any>): Promise<any>;
};

type NpcFactionFundingOptions = {
  client: NpcFactionFundingClient;
  adminSigner: any;
  tenant: string;
  factions: ConfiguredNpcFaction[];
  config: NpcFactionFundingConfig;
  faucetHost?: string;
  requestFaucet?: typeof requestSuiFromFaucetV2;
  transactionFactory?: () => Transaction;
  signal?: AbortSignal;
  dryRun?: boolean;
};

const U64_MAX = (1n << 64n) - 1n;

function canonicalMist(value: unknown, label: string, allowZero = false): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a canonical MIST integer string`);
  }
  const text = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new TypeError(`${label} must be a canonical MIST integer string`);
  }
  const amount = BigInt(text);
  if ((!allowZero && amount === 0n) || amount > U64_MAX) {
    throw new TypeError(`${label} must be ${allowZero ? "a" : "a positive"} u64 MIST amount`);
  }
  return amount.toString();
}

function normalizeNpcFactionFundingConfig(value: unknown): NpcFactionFundingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("suiWalletFunding must be an object");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.enabled !== "boolean") {
    throw new TypeError("suiWalletFunding.enabled must be a boolean");
  }
  if (typeof source.faucetEnabled !== "boolean") {
    throw new TypeError("suiWalletFunding.faucetEnabled must be a boolean");
  }
  const maxFaucetRequests = Number(source.maxFaucetRequests);
  if (!Number.isSafeInteger(maxFaucetRequests) || maxFaucetRequests < 0 || maxFaucetRequests > 20) {
    throw new TypeError("suiWalletFunding.maxFaucetRequests must be an integer from 0 through 20");
  }
  return {
    enabled: source.enabled,
    budgetMist: canonicalMist(source.budgetMist, "suiWalletFunding.budgetMist"),
    faucetEnabled: source.faucetEnabled,
    gasReserveMist: canonicalMist(source.gasReserveMist, "suiWalletFunding.gasReserveMist"),
    maxFaucetRequests,
  };
}

function canonicalConfiguredNpcFactionKey(faction: ConfiguredNpcFaction, index = 0): string {
  const rawID = faction?.factionID;
  const factionID = rawID == null ? 0 : Number(rawID);
  if (!Number.isSafeInteger(factionID) || factionID < 0 || factionID > 0xffffffff) {
    throw new TypeError(`factions[${index}].factionID must be a u32 integer`);
  }
  const rawKey = faction?.factionKey;
  const factionString = rawKey == null ? "none" : String(rawKey).trim().toLowerCase();
  if (factionString === "none" && rawKey != null) {
    throw new TypeError(`factions[${index}].factionKey reserves none for absence`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(factionString)) {
    throw new TypeError(`factions[${index}].factionKey is not a canonical NPC faction string`);
  }
  if (factionID === 0 && factionString === "none") {
    throw new TypeError(`factions[${index}] must define factionID or factionKey`);
  }
  return `${factionID}-${factionString}`;
}

function resolveConfiguredNpcFactionWallets(
  factions: ConfiguredNpcFaction[],
  tenant: string,
): Array<Omit<NpcFactionWalletBudget, "balanceMist" | "deficitMist">> {
  if (!Array.isArray(factions) || factions.length === 0) {
    throw new TypeError("At least one configured NPC faction is required for Sui funding");
  }
  const seenKeys = new Set<string>();
  const seenWallets = new Set<string>();
  return factions.map((faction, index) => {
    const factionKey = canonicalConfiguredNpcFactionKey(faction, index);
    if (seenKeys.has(factionKey)) {
      throw new TypeError(`Duplicate NPC faction funding key ${factionKey}`);
    }
    seenKeys.add(factionKey);
    const walletAddress = normalizeSuiAddress(
      deriveLocalNpcFactionSuiWalletAddress(factionKey, tenant),
    );
    if (seenWallets.has(walletAddress)) {
      throw new TypeError(`NPC faction wallets collide at ${walletAddress}`);
    }
    seenWallets.add(walletAddress);
    return {
      factionKey,
      factionName: String(faction.name || factionKey).trim() || factionKey,
      walletAddress,
    };
  });
}

function readBalanceMist(response: any, label: string): bigint {
  const value = response?.balance?.balance;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} returned an invalid SUI balance`);
  }
  return BigInt(value);
}

function fundingTransaction(
  deficits: NpcFactionWalletBudget[],
  gasBudgetMist: bigint,
  factory: () => Transaction = () => new Transaction(),
): Transaction {
  if (deficits.length === 0) {
    throw new TypeError("A funding transaction requires at least one deficit");
  }
  const transaction = factory();
  transaction.setGasBudget(gasBudgetMist);
  const coins = transaction.splitCoins(
    transaction.gas,
    deficits.map(entry => transaction.pure.u64(entry.deficitMist)),
  );
  deficits.forEach((entry, index) => {
    transaction.transferObjects([coins[index]], entry.walletAddress);
  });
  return transaction;
}

function transactionFailure(result: any): string | null {
  if (result?.$kind === "Transaction" && result.Transaction?.status?.success === true) {
    return null;
  }
  return result?.FailedTransaction?.status?.error?.message ||
    result?.Transaction?.status?.error?.message ||
    "the Sui transaction did not report success";
}

async function fundSuiNpcFactionWallets(options: NpcFactionFundingOptions) {
  const config = normalizeNpcFactionFundingConfig(options.config);
  const wallets = resolveConfiguredNpcFactionWallets(options.factions, options.tenant);
  const budgetMist = BigInt(config.budgetMist);
  const gasReserveMist = BigInt(config.gasReserveMist);
  const signal = options.signal || AbortSignal.timeout(120_000);
  const balance = async (owner: string, label: string) => readBalanceMist(
    await options.client.getBalance({ owner, signal }),
    label,
  );
  const adminAddress = normalizeSuiAddress(options.adminSigner.toSuiAddress());

  const observed = await Promise.all(wallets.map(async wallet => {
    const balanceMist = await balance(wallet.walletAddress, `Faction ${wallet.factionKey}`);
    return {
      ...wallet,
      balanceMist,
      deficitMist: balanceMist < budgetMist ? budgetMist - balanceMist : 0n,
    };
  }));
  const deficits = observed.filter(entry => entry.deficitMist > 0n);
  const totalDeficitMist = deficits.reduce((total, entry) => total + entry.deficitMist, 0n);
  let adminBalanceMist = await balance(adminAddress, "Admin account");
  let faucetRequests = 0;

  if (!config.enabled || deficits.length === 0 || options.dryRun) {
    return {
      enabled: config.enabled,
      dryRun: options.dryRun === true,
      budgetMist: budgetMist.toString(),
      gasReserveMist: gasReserveMist.toString(),
      adminAddress,
      adminBalanceMist: adminBalanceMist.toString(),
      factionCount: observed.length,
      fundedFactionCount: 0,
      pendingFactionCount: deficits.length,
      transferredMist: "0",
      requiredTransferMist: totalDeficitMist.toString(),
      faucetRequests,
      transactionDigest: null as string | null,
      wallets: observed.map(entry => ({
        factionKey: entry.factionKey,
        factionName: entry.factionName,
        walletAddress: entry.walletAddress,
        balanceMist: entry.balanceMist.toString(),
        transferredMist: "0",
      })),
    };
  }

  const requiredMist = totalDeficitMist + gasReserveMist;
  const faucet = options.requestFaucet || requestSuiFromFaucetV2;
  if (adminBalanceMist < requiredMist && config.faucetEnabled) {
    const host = options.faucetHost || getFaucetHost("localnet");
    while (adminBalanceMist < requiredMist && faucetRequests < config.maxFaucetRequests) {
      const response = await faucet({ host, recipient: adminAddress });
      faucetRequests += 1;
      const digests = (response.coins_sent || [])
        .map(coin => String(coin.transferTxDigest || "").trim())
        .filter(Boolean);
      if (options.client.waitForTransaction) {
        for (const digest of [...new Set(digests)]) {
          await options.client.waitForTransaction({ digest, timeout: 30_000, signal });
        }
      }
      adminBalanceMist = await balance(adminAddress, "Admin account after faucet request");
    }
  }
  if (adminBalanceMist < requiredMist) {
    throw new Error(
      `Admin account has ${adminBalanceMist} MIST but ${requiredMist} MIST is required ` +
      `for equal NPC faction budgets and gas${config.faucetEnabled ? " after Localnet faucet attempts" : ""}`,
    );
  }

  const transaction = fundingTransaction(
    deficits,
    gasReserveMist,
    options.transactionFactory,
  );
  transaction.setSender(adminAddress);
  const result = await options.client.signAndExecuteTransaction({
    transaction,
    signer: options.adminSigner,
    include: { effects: true },
    signal,
  });
  const failure = transactionFailure(result);
  if (failure) {
    throw new Error(`NPC faction funding failed: ${failure}`);
  }
  if (options.client.waitForTransaction) {
    await options.client.waitForTransaction({ result, timeout: 30_000, signal });
  }

  const finalBalances = await Promise.all(observed.map(entry =>
    balance(entry.walletAddress, `Funded faction ${entry.factionKey}`)));
  const belowBudget = finalBalances.findIndex(value => value < budgetMist);
  if (belowBudget >= 0) {
    throw new Error(`Faction ${observed[belowBudget].factionKey} remained below its SUI budget after funding`);
  }
  const digest = result.Transaction?.digest || null;
  return {
    enabled: true,
    dryRun: false,
    budgetMist: budgetMist.toString(),
    gasReserveMist: gasReserveMist.toString(),
    adminAddress,
    adminBalanceMist: adminBalanceMist.toString(),
    factionCount: observed.length,
    fundedFactionCount: deficits.length,
    pendingFactionCount: 0,
    transferredMist: totalDeficitMist.toString(),
    requiredTransferMist: "0",
    faucetRequests,
    transactionDigest: digest,
    wallets: observed.map((entry, index) => ({
      factionKey: entry.factionKey,
      factionName: entry.factionName,
      walletAddress: entry.walletAddress,
      balanceMist: finalBalances[index].toString(),
      transferredMist: entry.deficitMist.toString(),
    })),
  };
}

export {
  canonicalConfiguredNpcFactionKey,
  fundSuiNpcFactionWallets,
  fundingTransaction,
  normalizeNpcFactionFundingConfig,
  resolveConfiguredNpcFactionWallets,
  type ConfiguredNpcFaction,
  type NpcFactionFundingConfig,
  type NpcFactionFundingOptions,
};
