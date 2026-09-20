# NPC identities on Sui Localnet

Native NPCs have durable pilot identities independent of their current ships. The `npcPilotIdentities` ledger assigns a positive `gameCharacterId` from **1,500,000,000 through 1,599,999,999** and stores each pilot's faction, logical spawn slot, current ship, incarnation count, and Sui provisioning state. Human character allocation skips this range.

The runtime exposes the persistent ID as `npcCharacterID`. Normal NPC `characterID` and `pilotCharacterID` remain zero because existing engine behavior uses those fields to distinguish player-controlled ships. Ship/entity IDs in the `980…` range remain separate: death destroys the ship, and a later incarnation receives another ship ID while retaining its NPC character ID.

## Faction keys and wallets

Faction identity uses `factionID-factionStringOnlyID`. A missing numeric ID becomes `0`; a missing string becomes the reserved marker `none`:

| Source faction | Key |
| --- | --- |
| Numeric faction 500012 | `500012-none` |
| String-only Osa | `0-osa` |
| Numeric and string identity | `500012-blood-raiders` |
| Unaffiliated | `0-none` |

Numeric IDs must fit unsigned 32-bit integers. String IDs are trimmed and lowercased, must start with an ASCII letter or digit, and may contain letters, digits, underscores, and hyphens, up to 96 characters. The literal string `none` is reserved. Invalid identifiers fail validation; they are not truncated or silently merged.

One deterministic Localnet wallet is derived for each canonical faction key using the hash namespace `<tenant>:npc-faction:<key>`. This namespace separates faction wallets from player account wallets. These predictable development keys are intended for Localnet, not funded public-network wallets.

World synchronization gives every faction listed in `npc-factions.config.json` the same configured SUI operating budget. The shipped `suiWalletFunding.budgetMist` is `10000000000` MIST (10 SUI) per wallet. This is an idempotent minimum balance: sync transfers only each wallet's deficit in one admin-signed transaction and never removes externally received SUI from a wallet that is already above the target. Numeric factions use `<factionID>-none`, string-only factions use `0-<factionKey>`, and a faction with both components uses `<factionID>-<factionKey>`.

Funding always flows from the synchronized world admin account. If the admin cannot cover all deficits plus the configured gas reserve, sync can request SUI from the Localnet faucet for the admin and then retry the admin-funded transaction. The faucet never funds faction wallets directly. `faucetEnabled`, `gasReserveMist`, and `maxFaucetRequests` are explicit settings in the same config. If funding fails or any wallet remains below budget, `FrontierWorld.ps1 sync` fails and marks the synchronized world unavailable instead of advertising an incomplete setup. A repeat sync safely reconciles a transaction whose result was previously uncertain.

For inspection without transfers, run `npm run frontier:npc:fund -- --dry-run`. It reports the number of under-budget wallets and required MIST without calling the faucet, signing, or submitting. `FrontierWorld.ps1 sync -DryRun` reports that funding would occur without changing files or balances. `-SkipNpcFactionFunding` exists only for isolated tests and explicit recovery workflows.

Every NPC pilot receives its own Sui Character and wallet-owned PlayerProfile, even though its faction shares a wallet address. Provisioning does not create a local human character or player account. The ledger retains the object IDs, world/chain identity, and transaction state needed for reconciliation.

The custom `world::npc` module also creates a shared `NpcProfile` for each NPC. This is the authoritative on-chain NPC classification and lifecycle record; the compatible Character and PlayerProfile remain available to existing readers. `NpcProfileKey { character_id: ID }` derives the profile under the world ObjectRegistry, while a dynamic marker on the Character links to the profile. The registry binds each tenant/faction pair to an immutable wallet address. The contract accepts only the reserved NPC game-character range, and human provisioning rejects that range.

The NPC worker must verify this custom profile and its identity; an ordinary Character/PlayerProfile pair alone cannot count as a confirmed NPC. Deployments lacking `world::npc` fail provisioning rather than silently using unmarked player profiles. Legacy on-chain NPC Characters can be registered through the admin-authorized `register_profile` operation when their reserved ID, faction wallet, and current identity match.

The string component comes from `factionStringOnlyID` when explicitly supplied, otherwise the existing `npcFactionKey`/`frontierFactionKey` profile metadata. The numeric component is the NPC profile's faction ID. This wallet grouping does not redefine the contracts' tribe IDs: NPC Characters use the current world provisioning tribe setting.

## Respawning and logical slots

Reusing a logical slot in the same system and faction reacquires the same pilot. A live pilot cannot simultaneously occupy two ships. A different faction at the same slot receives a different identity. Hull/profile changes can retain the pilot when the faction and logical slot are unchanged.

Automatic spawn authorities supply slots scoped to their owner:

- Belt rats: system, belt, vacant group ordinal, and member index. A partially surviving group keeps its ordinal until its final member leaves.
- Startup authorities: system, startup rule, anchor, group ordinal, and member index. Exact EverMore formations use their individual layout slots. Persisted dormant groups retain occupancy.
- Landscape NPCs: system, landscape site, and entry index.
- Dungeon encounters: system, site, private instance, encounter, and entry index. A new private instance deliberately receives distinct pilots.
- Hive NPCs: system, site/private instance, hive controller, and entry index.
- Drifter reinforcements: parent pilot slot, successful request ordinal, and member index. Failed requests retry the same ordinal.

The native group spawner appends `:member:<zero-based index>` to `options.npcIdentitySlot`. A direct single-entity spawn uses its supplied slot unchanged. Manual/GM spawns without an explicit slot receive a fresh identity. Callers that want a later spawn to represent the same pilot must supply the same slot and release the prior incarnation through normal NPC destruction/removal first.

This feature preserves existing spawn eligibility, cooldowns, and respawn policy. It supplies stable identities when an existing spawn authority creates another incarnation; it does not introduce automatic respawning for content that previously had none.

Durable NPCs created before this feature may lack the original logical slot. Such records acquire a `legacy:<entityID>` identity during materialization and retain that pilot on later materializations. This cannot automatically identify the future replacement emitted by an authoritative spawner under a different logical key. Stable cross-death reuse starts with newly spawned, authoritatively keyed NPCs unless the original source slot can be reconstructed explicitly.

## Provisioning and resets

The background NPC provisioning worker starts for Frontier when `npcPilotIdentitiesEnabled` and `suiNpcCharacterProvisioningEnabled` are enabled; both default to true. Local pilot allocation is durable independently of transient ships and provisioning completion. Chain work is reconciled asynchronously, so Localnet availability does not have to gate NPC spawning.

The corresponding environment overrides are `EVEJS_NPC_PILOT_IDENTITIES_ENABLED` and `EVEJS_SUI_NPC_CHARACTER_PROVISIONING_ENABLED`. For example, these PowerShell settings keep local NPC identities enabled while pausing chain provisioning for the next server process:

```powershell
$env:EVEJS_NPC_PILOT_IDENTITIES_ENABLED = "true"
$env:EVEJS_SUI_NPC_CHARACTER_PROVISIONING_ENABLED = "false"
```

Set the second flag to `"true"` and restart the Frontier server to enable provisioning again. The normal Sui Localnet/world configuration must point at the current deployed contracts.

Death preserves the NPC's Character, PlayerProfile, and NpcProfile. Do not delete those on-chain objects as a respawn mechanism: derived Character identity cannot simply be recreated after deletion in the same registry. The runtime exposes the additional profile ID as `npcSuiNpcProfileObjectID`.

The worker mirrors incarnation, current entity ID (`0` when absent), and deaths into `NpcProfile`; the contract tracks its revision and retirement state. Lifecycle updates use an expected revision and monotonic counters; respawning preserves the profile while advancing its incarnation. Retirement is an explicit permanent contract action, not the normal death path. It stops future profile updates; it does not itself stop the game's spawn authorities. Current Character mutation entry points reject changes to marked NPC identity. Historical package bytecode remains callable after a Sui upgrade, so these guards cannot retroactively restrict the original package's entry points.

If historical bytecode or an external administrator deletes the parent Character, its separate NpcProfile may remain. That profile is not proof that the Character still exists. Reconciliation must reject the missing parent; it cannot recreate the already claimed Character ID in the same registry. Repair requires an explicit administrative migration or a new world, not an automatic delete-and-recreate retry.

An explicit runtime-data reset clears the identity ledger along with runtime NPC data and therefore discards its pilot-to-slot assignments. Normal process restarts retain them. Localnet regenesis requires reprovisioning Character/Profile objects against the current world and registry; the canonical faction wallet address remains deterministic for the same tenant and faction key, while object IDs may change. Keep the ledger if existing NPC character IDs must survive a Localnet reset.

## Deploying the custom NPC module

After syncing a deployment, run `npm run frontier:npc:verify` from the EveJS repository to build the tools and perform a read-only Localnet smoke check. It uses the synchronized world and NPC metadata, simulates the server's NPC creation transaction with validation enabled, checks profile types, faction ownership and identity events, and confirms no simulated objects were committed. It never signs or submits a transaction. Optional arguments such as `--world-config PATH`, `--build 3502403`, or `--npc-id 1599999999` can be passed after `--`. Access to the protected local world configuration is required; private keys are never printed.

Compiling these sources does not modify an already deployed world. A fresh world deployment containing `world::npc` uses the base world package for both NPC calls and NPC type identities. For a compatible upgrade, keep the original world package, ObjectRegistry, AdminACL, Character, and `TenantItemId` identities. Configure the NPC implementation separately:

| Setting | Purpose |
| --- | --- |
| `EVEJS_SUI_NPC_PACKAGE_ID` | Latest package containing the NPC call implementations |
| `EVEJS_SUI_NPC_TYPE_ORIGIN` | First package that introduced `npc::NpcProfile` and `npc::NpcProfileKey` |
| `EVEJS_SUI_NPC_CONFIG_PATH` | Optional explicit deployment JSON path |

With neither file nor overrides, both NPC IDs default to the base package. For the first upgrade introducing the module, a package override alone also supplies the type origin. For subsequent upgrades, retain that first origin explicitly. Calls use the latest implementation; derived profile IDs and type checks use the origin.

Alternatively, place public `npc-deployment.json` next to the synchronized `world.private.json` selected by `EVEJS_SUI_WORLD_CONFIG_PATH`:

```json
{
  "schemaVersion": 1,
  "chainId": "CHAIN_IDENTIFIER",
  "worldPackageId": "0xORIGINAL_WORLD_PACKAGE",
  "objectRegistryId": "0xORIGINAL_REGISTRY",
  "adminAclId": "0xORIGINAL_ACL",
  "packageId": "0xLATEST_NPC_IMPLEMENTATION",
  "typeOrigin": "0xFIRST_PACKAGE_CONTAINING_NPC"
}
```

Replace placeholders with verified deployed values. The chain and original world IDs must match the synchronized base world. Environment package/origin overrides take precedence per field, but an invalid file is always rejected. The conventional sibling is optional; an explicitly selected file must exist. The config snapshot is checked again before submission so a deployment change cannot redirect an already prepared operation.

Store the authoritative public manifest at `world-contracts/deployments/localnet/npc-deployment.json` in the selected efctl workspace. `FrontierWorld.ps1 sync` snapshots it alongside the original deployment artifacts, validates its schema and chain/base-world bindings, and writes the sanitized runtime fields to the sibling file above before marking the world ready. The manifest addresses must be full nonzero 32-byte Sui addresses. Extra fields are not copied. `sync -DryRun` validates and reports without changing either destination.

Malformed or mismatched NPC metadata makes synchronization fail closed. If the source manifest is absent and no destination manifest exists, synchronization retains its legacy base-package behavior. If a destination already exists, the missing source is an error: sync preserves the old NPC metadata for recovery but marks the base-world config unavailable. Restore the matching authoritative manifest, or explicitly reconcile the deployment before removing obsolete metadata; do not silently discard pending signed NPC journals.

`FrontierWorld.ps1 sync` still validates the original deployment JSON, publication metadata, and their hashes. Retain those base artifacts when applying a manual upgrade and record upgrade publication metadata separately. Replacing the base `packageId` with a newer implementation breaks existing type/derived-ID checks. `deploy-world.sh` performs a fresh publish and cleans deployment artifacts; it is not an upgrade command. Synchronization copies verified deployment settings; it does not publish, upgrade, reset Localnet, or replace the world registry.

## Verification

From the repository root, build the runtime and tests, then run the focused regression suite:

```powershell
npm run build
npm run test:frontier-npc-identities
```

The test runner creates an isolated game store using the selected Frontier build's runtime/static fixtures. It checks persistent allocation, native spawn/death/re-materialization, startup and belt slots, faction wallets, provisioning/reconciliation, and worker retry behavior. Its mocked chain tests do not submit live Sui transactions.
