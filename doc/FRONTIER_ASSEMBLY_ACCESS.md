# Frontier assembly access

Phase 3C provides a single durable access model for players and persistent NPCs.

## Runtime

`server/src/services/frontier/assemblyAccessRuntime.ts` owns the `assemblyAccessPolicies` game-store table. It provides:

- typed `player`, `npc`, `tribe`, and canonical faction principals;
- durable request, approval, denial, cancellation, grant, expiry, relinquishment, and revocation state;
- `gui.view`, `operate`, `inventory.deposit`, `inventory.withdraw`, `configure`, and `manage_access` capabilities;
- idempotency fingerprints that reject changed retries;
- capability, expiry, and delegation-depth attenuation;
- current tribe/faction membership resolution rather than copied member lists;
- monotonically revised policies and append-only public audit events;
- short-lived, actor/session/assembly-bound GUI tokens that are invalidated by policy changes; and
- automatic cancellation/revocation when an assembly is dismantled or administratively removed.

An owner has implicit capabilities and does not need a stored self-grant. A delegated manager can create only a subset of capabilities it currently holds. A child grant is unusable as soon as any parent grant expires or is revoked.

## Player and NPC integration

`smartAssemblyService.ts` exposes request, inbox, approval, denial, sharing, grant listing, revocation, relinquishment, audit, accessible-assembly, and GUI-session RPCs. The existing smart-assembly request bus now resolves `gui.view` or `operate` before listing or changing assembly work, while retaining its separate same-owner/cross-owner controls.

`server/src/space/npc/npcAssemblyAccessService.ts` derives the NPC principal from the active durable NPC entity. It rejects stale ship/incarnation bindings and secrets, and returns an `awaiting-assembly-access` checkpoint containing a stable wake-event key.

## Smart versus local assemblies

Portable and field assemblies use the local durable policy as authority. A smart-assembly grant is created as `local_projection_pending_chain` and is deliberately unusable. A registered Sui verifier must validate a public chain proof through `confirmGrantChainAuthority`; only then does the grant become `sui_confirmed` and enter access resolution.

The authoritative `<accessPackageId>::assembly_access` module derives one shared policy object per assembly and one shared grant object per `(policy, UUID)`. Owner issuance requires the assembly's exact `OwnerCap`; player and NPC delegation is capability-, expiry-, and depth-attenuating. The server derives policy, grant, and assembly object IDs from the synchronized Object Registry, type origin, tenant, and item ID, then fetches the live shared objects and verifies the full ancestor chain. Client-supplied object IDs are never authoritative.

Smart grants remain unusable until this verification promotes the local projection to `sui_confirmed`. Portable and field assemblies continue to use the equivalent durable local policy. The fresh-deployment writer verifies that the independently published `world_npc` and `world_assembly_access` outputs contain `npc` and `assembly_access` before emitting the combined runtime manifest.

`npc-deployment.json` carries independent `accessPackageId`, `accessTypeOrigin`, and `accessRegistryId` fields. A fresh split deployment sets the package and origin to the new `world_assembly_access` package and records its shared registry. An upgrade must set the call package to the latest implementation while preserving the first access package as its type origin and retaining the registry. NPC and access origins are deliberately not assumed to match. The current Localnet has this split package and registry active.

## Cross-owner custody

An access grant never changes item ownership. Cross-owner storage uses a separate two-part commit:

1. `<accessPackageId>::assembly_access` checks a direct, unexpired deposit or withdrawal grant and executes the Storage Unit move. Cross-storage transfers validate both grants in one Sui transaction and emit `AssemblyCustodyTransferred` bound to a 16-byte operation UUID, actor, source, destination, type, and quantity.
2. The server fetches the finalized successful transaction and matches that exact event before changing the game item owner/location. The item-table write embeds a durable operation fingerprint and receipt, so a retry returns the original result and changed reuse of the UUID is rejected.

Custody capabilities are owner-issued and non-delegable on chain. Both Storage Units must be online, belong to the same tenant, opt into the assembly-access extension, and the game-side assemblies must be online Sui-backed storage in the actor's current system. The server rechecks item ownership, location, type, quantity, and capacity after the asynchronous chain read and flushes the owner/location move before acknowledging success.

The native `Handle_transfer_cross_owner_inventory` RPC supports ship-to-storage deposit, storage-to-ship withdrawal, and storage-to-storage transfer. Player-facing GUI controls and wallet transaction signing still require client work; server/NPC callers and external transaction builders can use the implemented boundary on a deployment whose access package, type origin, and registry have been synchronized and verified.

## Remaining client work

The Frontier client still needs request/inbox/share/revoke controls, capability-aware assembly panels, and wallet signing for the prepared Sui access/custody transactions. The server and contract surfaces are complete and fail closed when the access module has not been published and synchronized.
