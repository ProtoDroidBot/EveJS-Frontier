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

Base Assembly, Gate, Storage Unit, and Network Node calls target the synchronized
base-world package. Catapult and Smart Industry state are separate sidecars and
target the package/origin/registry triples in the synchronized combined
`npc-deployment.json` feature manifest. Assembly access and transponder objects
use the same split identity model in their own runtimes. A shared Object Registry
does not mean these modules share the base package address.

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

## Smart Storage Unit dApp transfers

Open a deployed Smart Storage Unit in the custom dApp and select **Storage**.
Connect the wallet belonging to the character currently logged into the local
game server. The server resolves that wallet to the live character and requires
the active ship to be in the same solar system and within 5 km of the unit.
Transfers require an online unit. Deposits select non-singleton stacks from the
active ship's cargo; withdrawals select item types from that character's storage
partition and return them to the active ship's cargo. Capacity, quantities,
ownership, and current access are checked again when the transfer executes.

The wallet signs an authorization for the exact prepared transfer. This
authorization is not a chain submission. The server atomically saves the game
inventory movement, publishes inventory updates to the client, and requests an
immediate pass of the existing assembly synchronization worker. Owner contents
use the StorageUnit capability; visitor contents use that visitor's Character
capability. The sponsored worker mints or burns the corresponding chain inventory
quantities through `storage_unit::game_item_to_chain_inventory` and
`storage_unit::chain_item_to_game_inventory`.

Game confirmation and chain synchronization are reported separately. A response
with `gameCommitted: true` means the inventory movement is already saved even if
the chain status is `pending` or `error`. `synced` requires a fresh read confirming
the requesting character's on-chain quantities match the current game inventory
and no uncertain chain transaction remains. `disabled` means the assembly worker
is disabled. **Sync chain** retries the mirror without moving the game items
again. RPC timeouts and contract failures remain visible while the five-second
worker continues retrying. Status reads and submissions share one serialized
queue, and inventory snapshots are checked again before a chain transaction is
journaled. Stale scans stop before a new submission; previously journaled
transactions keep their exact-byte recovery, followed by another reconciliation
against the latest saved game inventory.

Prepared authorizations expire after two minutes. Completed transfer UUIDs and
their replay receipts are held in server memory for 24 hours; repeating the same
signed UUID during that period returns the existing result without moving items
again. These HTTP/gateway replay receipts do not survive a server restart. The
game inventory and the chain transaction journal do survive, so the worker can
finish synchronization after restart without another deposit or withdrawal.

The dApp retains an uncertain signed transfer in the current browser tab's
session storage. If a response is lost, use **Check transfer result** to retry
that same UUID. If the server no longer recognizes it after a restart or receipt
expiry, refresh both inventories and inspect the quantities before dismissing
the unresolved operation. Preparing a new transfer would authorize another
movement; it is not a way to recover the previous transfer.

The dApp endpoints are served under `/evejs/storage` by the native Frontier
server. Requests authenticate the wallet session and expose only its own storage
partition. The default allowed browser origins are `https://localhost`,
`https://127.0.0.1`, and `https://dev.dapps.evefrontier.com`; set
`EVEJS_STORAGE_DAPP_ORIGINS` to a comma-separated allowlist when serving the dApp
from another origin.
