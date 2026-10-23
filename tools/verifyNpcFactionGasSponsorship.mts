#!/usr/bin/env node
/** Localnet smoke test: an admin-authorized Move call paid by an NPC faction wallet. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase58, toHex } from "@mysten/sui/utils";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(resolve(root, "world-contracts/deployments/localnet/world-features.v1.json"), "utf8"));
const config = JSON.parse(readFileSync(resolve(root, "npc-factions.config.json"), "utf8"));
const faction = config.factions[0];
const factionKey = process.argv[2] || `${faction.factionID}-${faction.factionKey || "none"}`;
if (!/^(0|[1-9][0-9]*)-[a-z0-9][a-z0-9_-]{0,95}$/.test(factionKey)) {
  throw new Error("Faction key must be <factionID>-<factionStringOnlyID>");
}
const adminLine = readFileSync(resolve(root, "world-contracts/.env"), "utf8")
  .split(/\r?\n/).find(line => line.startsWith("ADMIN_PRIVATE_KEY="));
if (!adminLine) throw new Error("The efctl Localnet admin key is missing");
const parsedKey = decodeSuiPrivateKey(adminLine.slice("ADMIN_PRIVATE_KEY=".length));
if (parsedKey.scheme !== "ED25519") throw new Error("The Localnet admin key is not Ed25519");
const admin = Ed25519Keypair.fromSecretKey(parsedKey.secretKey);
const factionSeed = createHash("sha512").update(`dev:npc-faction:${factionKey}`, "utf8").digest("hex");
const payer = Ed25519Keypair.deriveKeypairFromSeed(factionSeed);
const adminAddress = admin.toSuiAddress();
const payerAddress = payer.toSuiAddress();
if (adminAddress === payerAddress) throw new Error("The faction gas payer must be distinct from admin");

const client = new SuiGrpcClient({ baseUrl: "http://127.0.0.1:9000", network: "localnet" });
const { chainIdentifier } = await client.getChainIdentifier();
const genesisDigest = fromBase58(chainIdentifier);
if (genesisDigest.length !== 32) throw new Error("Localnet returned an invalid genesis digest");
const chainId = toHex(genesisDigest.slice(0, 4));
if (chainId !== deployment.chainId) throw new Error("Deployment manifest does not match Localnet");
const coin = (await client.listCoins({ owner: payerAddress, coinType: "0x2::sui::SUI", limit: 1 })).objects[0];
if (!coin || BigInt(coin.balance) < 100_000_000n) throw new Error("Faction has no usable gas coin");
const gasPayment = [{ objectId: coin.objectId, version: coin.version, digest: coin.digest }];
const target = `${deployment.world.packageId}::access::verify_sponsor`;
const acl = deployment.world.adminAclId;

function transaction(sender) {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasOwner(payerAddress);
  tx.setGasPayment(gasPayment);
  tx.setGasBudget(100_000_000);
  tx.moveCall({ target, arguments: [tx.object(acl)] });
  return tx;
}

// A faction wallet alone must not acquire ACL authority by being the gas payer.
const deniedBytes = await transaction(payerAddress).build({ client });
const denied = await client.simulateTransaction({ transaction: deniedBytes });
if (denied.$kind !== "FailedTransaction" || denied.FailedTransaction.status.success !== false ||
    denied.FailedTransaction.status.error.$kind !== "MoveAbort") {
  throw new Error("Faction-only ACL simulation unexpectedly passed or failed for another reason");
}

// The admin supplies authority; the faction supplies only SUI gas.
const bytes = await transaction(adminAddress).build({ client });
const approved = await client.simulateTransaction({ transaction: bytes });
if (approved.$kind !== "Transaction" || approved.Transaction.status.success !== true) {
  throw new Error("Admin/faction ACL simulation failed");
}
const signatures = [
  (await admin.signTransaction(bytes)).signature,
  (await payer.signTransaction(bytes)).signature,
];
const sent = await client.executeTransaction({
  transaction: bytes,
  signatures,
  include: { transaction: true },
});
if (sent.$kind !== "Transaction" || sent.Transaction.status.success !== true) {
  throw new Error("Faction-paid ACL transaction execution failed");
}
const confirmed = await client.waitForTransaction({
  digest: sent.Transaction.digest,
  include: { transaction: true },
});
if (confirmed.$kind !== "Transaction" || confirmed.Transaction.status.success !== true ||
    confirmed.Transaction.transaction?.sender !== adminAddress ||
    confirmed.Transaction.transaction?.gasData?.owner !== payerAddress) {
  throw new Error("Faction-paid ACL transaction did not confirm as expected");
}
const receipt = confirmed.Transaction;
console.log(JSON.stringify({
  chainId,
  worldPackageId: deployment.world.packageId,
  factionKey,
  adminAddress,
  gasOwnerAddress: payerAddress,
  factionOnlyDryRun: "failure",
  sponsoredDryRun: "success",
  digest: receipt.digest,
  status: "success",
}));
