# Automatic Smart Assembly synchronization

The native Frontier server mirrors completed, chain-enabled assemblies to the
Sui Localnet at `127.0.0.1:9000`. It starts a serialized reconciliation worker
after loading the game store and scans every five seconds. An empty game store
produces no assembly or character transactions. New assemblies are picked up
when construction completes, including direct placement and GM spawning.

Prepare the current deployment with `FrontierWorld.ps1 sync`, then launch the
server normally with `StartFrontierServer.ps1`. The launcher supplies the private
world configuration. No separate sync command is required while playing.
`EVEJS_SUI_ASSEMBLY_SYNC_ENABLED=false` disables the worker. It is disabled in
isolated tests and for non-Frontier server profiles.

The mirror covers:

- Network Nodes, storage units, gates, turrets, and generic chain-enabled assemblies.
- Deterministic game IDs, Character ownership, names, and revealed coordinates.
- Fuel quantities, supported fuel efficiencies, and online/offline status.
- Reciprocal gate links and unlinking, using server-signed distance proofs.
- Owner and guest storage inventories, aggregated by item type as required by Move.
- Removal of matching assemblies previously tracked by this runtime, after their chain
  inventories, links, fuel, and dependent assemblies have been cleared.

Local game state remains authoritative. Gameplay updates locally, then the
worker converges the blockchain asynchronously. A contract failure is logged
and retried; it does not roll back the game action. Watch `[SuiAssemblySync]`
server log entries for transaction digests, completion, and errors.

The worker uses the same deterministic `dev` account wallets as the local
client, with the synchronized admin account sponsoring transactions. It verifies
the chain identity and deployment artifacts before submissions. Signed transaction
bytes and signatures are journaled before sending; uncertain submissions are
reconciled or replayed with exactly the same bytes after restart. Only one worker
may own a runtime directory.

Receipts and tracked identities are stored next to `gamestore.sqlite`, under
`sui-assembly-sync`, with separate files for each chain/package. State files
include current errors; tracked assembly snapshots include anchor attempts, describe requested state, and
are not receipts confirming every field. The transaction journal records the last
confirmed digest. A full runtime wipe discards tracking of the old world. The
worker does not enumerate and delete unrelated on-chain objects.

Contract constraints matter:

- **Unstable Fuel (77818):** EveJS's authored efficiency is 8%, while this world
  contract accepts 10–100%. The worker reports the conflict. D1 (10%) and D2
  (15%) are supported; it never silently changes the authored percentage.
- Online Network Nodes require fuel. Attached online assemblies require an
  online node. Storage inventory changes require the storage and its fueled
  node temporarily online; the worker restores the requested status afterward.
- Assemblies initially attach to the nearest completed node with the same owner
  and solar system. Equal-distance ambiguity is an error. Once recorded, this
  binding is retained even if a closer node is built later.
- Existing ownership, location, capacity, type, or binding conflicts are errors.
  Move cannot reclaim a deleted derived object ID. Reusing game IDs after a
  game-store wipe may require a fresh Localnet deployment and another world sync.
- The current local store has no ownership mapping for open on-chain storage
  inventory. Nonempty unmapped partitions are reported as errors.
- Volume and capacity use the same integer micro-m³ scale (1,000,000 per m³)
  to preserve fractional game volumes. This is the local bridge's conversion
  policy, not an additional contract requirement.

Validation uses isolated snapshots, mocked chain effects, transaction recovery
tests, and read-only Localnet simulation. It does not seed the user's game store.
