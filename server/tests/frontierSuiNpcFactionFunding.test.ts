import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalConfiguredNpcFactionKey,
  fundSuiNpcFactionWallets,
  normalizeNpcFactionFundingConfig,
  resolveConfiguredNpcFactionWallets,
} from "../src/services/frontier/suiNpcFactionFunding";

const ADMIN = `0x${"a".repeat(64)}`;
const CONFIG = {
  enabled: true,
  budgetMist: "10000000000",
  faucetEnabled: true,
  gasReserveMist: "100000000",
  maxFaucetRequests: 3,
};
const FACTIONS = [
  { factionID: 500012, name: "Blood Raiders" },
  { factionKey: "osa", name: "Osa" },
  { factionID: 500025, factionKey: "okryda", name: "Okryda" },
];

class FakeTransaction {
  gas = { kind: "GasCoin" };
  pure = { u64: (value: bigint) => value };
  gasBudget = 0n;
  sender = "";
  transfers: Array<{ amount: bigint; address: string }> = [];

  setGasBudget(value: bigint) { this.gasBudget = BigInt(value); }
  splitCoins(_coin: unknown, amounts: bigint[]) {
    return amounts.map(amount => ({ amount }));
  }
  transferObjects(coins: Array<{ amount: bigint }>, address: string) {
    this.transfers.push({ amount: coins[0].amount, address });
  }
  setSender(value: string) { this.sender = value; }
}

function fixture(options: { adminBalance?: bigint; walletBalances?: bigint[]; fail?: boolean } = {}) {
  const wallets = resolveConfiguredNpcFactionWallets(FACTIONS, "dev");
  const balances = new Map<string, bigint>([
    [ADMIN, options.adminBalance ?? 100_000_000_000n],
    ...wallets.map((wallet, index) => [wallet.walletAddress, options.walletBalances?.[index] ?? 0n] as [string, bigint]),
  ]);
  const transactions: FakeTransaction[] = [];
  const client = {
    async getBalance({ owner }: { owner: string }) {
      return { balance: { balance: String(balances.get(owner) ?? 0n) } };
    },
    async signAndExecuteTransaction({ transaction }: { transaction: FakeTransaction }) {
      transactions.push(transaction);
      if (options.fail) {
        return { $kind: "FailedTransaction", FailedTransaction: { status: { error: { message: "rejected" } } } };
      }
      const total = transaction.transfers.reduce((sum, transfer) => sum + transfer.amount, 0n);
      balances.set(ADMIN, (balances.get(ADMIN) || 0n) - total - 1n);
      for (const transfer of transaction.transfers) {
        balances.set(transfer.address, (balances.get(transfer.address) || 0n) + transfer.amount);
      }
      return {
        $kind: "Transaction",
        Transaction: { digest: "funding-digest", status: { success: true } },
      };
    },
    async waitForTransaction({ result }: any) { return result; },
  };
  return { wallets, balances, transactions, client };
}

test("configured faction keys use factionID-factionStringOnlyID and distinct deterministic wallets", () => {
  assert.equal(canonicalConfiguredNpcFactionKey(FACTIONS[0]), "500012-none");
  assert.equal(canonicalConfiguredNpcFactionKey(FACTIONS[1]), "0-osa");
  assert.equal(canonicalConfiguredNpcFactionKey(FACTIONS[2]), "500025-okryda");
  const wallets = resolveConfiguredNpcFactionWallets(FACTIONS, "dev");
  assert.equal(new Set(wallets.map(wallet => wallet.walletAddress)).size, 3);
  assert.deepEqual(wallets.map(wallet => wallet.factionKey), [
    "500012-none", "0-osa", "500025-okryda",
  ]);
});

test("funding configuration requires safe canonical u64 MIST strings", () => {
  assert.deepEqual(normalizeNpcFactionFundingConfig(CONFIG), CONFIG);
  for (const budgetMist of [0, "01", "-1", "18446744073709551616", 10_000_000_000]) {
    assert.throws(
      () => normalizeNpcFactionFundingConfig({ ...CONFIG, budgetMist }),
      /budgetMist/,
    );
  }
  assert.throws(
    () => normalizeNpcFactionFundingConfig({ ...CONFIG, maxFaucetRequests: 21 }),
    /maxFaucetRequests/,
  );
});

test("sync tops every underfunded faction up to one target and is idempotent", async () => {
  const f = fixture({ walletBalances: [0n, 5_000_000_000n, 12_000_000_000n] });
  const input = {
    client: f.client as any,
    adminSigner: { toSuiAddress: () => ADMIN },
    tenant: "dev",
    factions: FACTIONS,
    config: CONFIG,
    transactionFactory: () => new FakeTransaction() as any,
  };
  const first = await fundSuiNpcFactionWallets(input);
  assert.equal(first.fundedFactionCount, 2);
  assert.equal(first.pendingFactionCount, 0);
  assert.equal(first.transferredMist, "15000000000");
  assert.equal(first.transactionDigest, "funding-digest");
  assert.deepEqual(first.wallets.map(wallet => wallet.balanceMist), [
    "10000000000", "10000000000", "12000000000",
  ]);
  assert.deepEqual(f.transactions[0].transfers.map(transfer => transfer.amount), [
    10_000_000_000n, 5_000_000_000n,
  ]);
  const second = await fundSuiNpcFactionWallets(input);
  assert.equal(second.fundedFactionCount, 0);
  assert.equal(second.transferredMist, "0");
  assert.equal(second.transactionDigest, null);
  assert.equal(f.transactions.length, 1);
});

test("dry-run reports equal-budget deficits without using faucet or submitting", async () => {
  const f = fixture({ adminBalance: 1n, walletBalances: [0n, 5_000_000_000n, 12_000_000_000n] });
  let faucetCalled = false;
  const result = await fundSuiNpcFactionWallets({
    client: f.client as any,
    adminSigner: { toSuiAddress: () => ADMIN },
    tenant: "dev",
    factions: FACTIONS,
    config: CONFIG,
    dryRun: true,
    transactionFactory: () => new FakeTransaction() as any,
    requestFaucet: async () => { faucetCalled = true; throw new Error("must not call faucet"); },
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.pendingFactionCount, 2);
  assert.equal(result.requiredTransferMist, "15000000000");
  assert.equal(result.fundedFactionCount, 0);
  assert.equal(faucetCalled, false);
  assert.equal(f.transactions.length, 0);
});

test("Localnet faucet replenishes only the admin before the admin funds factions", async () => {
  const f = fixture({ adminBalance: 1n, walletBalances: [0n, 0n, 0n] });
  const faucetRecipients: string[] = [];
  const result = await fundSuiNpcFactionWallets({
    client: f.client as any,
    adminSigner: { toSuiAddress: () => ADMIN },
    tenant: "dev",
    factions: FACTIONS,
    config: CONFIG,
    transactionFactory: () => new FakeTransaction() as any,
    requestFaucet: async ({ recipient }) => {
      faucetRecipients.push(recipient);
      f.balances.set(ADMIN, 100_000_000_000n);
      return { status: "Success", coins_sent: [] };
    },
  });
  assert.deepEqual(faucetRecipients, [ADMIN]);
  assert.equal(result.faucetRequests, 1);
  assert.equal(result.fundedFactionCount, 3);
  assert.ok(result.wallets.every(wallet => wallet.balanceMist === CONFIG.budgetMist));
});

test("insufficient admin balance fails closed when the faucet cannot cover the budget", async () => {
  const f = fixture({ adminBalance: 1n });
  await assert.rejects(
    fundSuiNpcFactionWallets({
      client: f.client as any,
      adminSigner: { toSuiAddress: () => ADMIN },
      tenant: "dev",
      factions: FACTIONS,
      config: { ...CONFIG, maxFaucetRequests: 1 },
      transactionFactory: () => new FakeTransaction() as any,
      requestFaucet: async () => ({ status: "Success", coins_sent: [] }),
    }),
    /Admin account has 1 MIST/,
  );
  assert.equal(f.transactions.length, 0);
});

test("failed funding transaction is never reported as a synchronized budget", async () => {
  const f = fixture({ fail: true });
  await assert.rejects(
    fundSuiNpcFactionWallets({
      client: f.client as any,
      adminSigner: { toSuiAddress: () => ADMIN },
      tenant: "dev",
      factions: FACTIONS,
      config: CONFIG,
      transactionFactory: () => new FakeTransaction() as any,
    }),
    /NPC faction funding failed: rejected/,
  );
});
