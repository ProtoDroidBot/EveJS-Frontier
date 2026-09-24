#!/usr/bin/env node
/** Localnet smoke test: an admin-authorized Move call paid by an NPC faction wallet. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

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

const client = new SuiJsonRpcClient({ url: "http://127.0.0.1:9000", network: "localnet" });
const chainId = await client.getChainIdentifier();
if (chainId !== deployment.chainId) throw new Error("Deployment manifest does not match Localnet");
const coin = (await client.getCoins({ owner: payerAddress, coinType: "0x2::sui::SUI", limit: 1 })).data[0];
if (!coin || BigInt(coin.balance) < 100_000_000n) throw new Error("Faction has no usable gas coin");
const gasPayment = [{ objectId: coin.coinObjectId, version: coin.version, digest: coin.digest }];
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
const denied = await client.dryRunTransactionBlock({ transactionBlock: deniedBytes });
if (denied.effects?.status?.status !== "failure" ||
    !String(denied.effects.status.error || "").includes("MoveAbort")) {
  throw new Error(`Faction-only ACL dry-run unexpectedly passed or failed for another reason: ${JSON.stringify(denied.effects?.status)}`);
}

// The admin supplies authority; the faction supplies only SUI gas.
const bytes = await transaction(adminAddress).build({ client });
const approved = await client.dryRunTransactionBlock({ transactionBlock: bytes });
if (approved.effects?.status?.status !== "success") {
  throw new Error(`Admin/faction ACL dry-run failed: ${JSON.stringify(approved.effects?.status)}`);
}
const signatures = [
  (await admin.signTransaction(bytes)).signature,
  (await payer.signTransaction(bytes)).signature,
];
const sent = await client.executeTransactionBlock({
  transactionBlock: bytes,
  signature: signatures,
  options: { showEffects: true, showInput: true },
});
const receipt = await client.waitForTransaction({
  digest: sent.digest,
  options: { showEffects: true, showInput: true },
});
if (receipt.effects?.status?.status !== "success" ||
    receipt.transaction?.data?.sender !== adminAddress ||
    receipt.transaction?.data?.gasData?.owner !== payerAddress) {
  throw new Error(`Faction-paid ACL transaction did not confirm as expected: ${JSON.stringify(receipt)}`);
}
console.log(JSON.stringify({
  chainId,
  worldPackageId: deployment.world.packageId,
  factionKey,
  adminAddress,
  gasOwnerAddress: payerAddress,
  factionOnlyDryRun: denied.effects.status.status,
  sponsoredDryRun: approved.effects.status.status,
  digest: receipt.digest,
  status: receipt.effects.status.status,
}));
