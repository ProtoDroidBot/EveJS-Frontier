# Network Node energy grids

Completed Smart Assemblies automatically attach to the nearest completed Network Node owned by the same character in the same solar system, within 80,000 metres in three dimensions. The radius boundary is inclusive. Equal distances use the lower item ID. A saved connection stays with its node while valid.

The authoritative balance source is `world-contracts/config/assembly-energy.json` in the pinned submodule. It contains every build-3502403 on-chain Smart Assembly, including explicit zero-cost types. World configuration reconciles the positive entries into Sui's `EnergyConfig.assembly_energy` table and removes stale, changed, or intentionally zero-cost rows. `FrontierWorld.ps1 sync` validates and fingerprints the same manifest into `world.private.json`.

The assembly sync worker reads every on-chain table page and requires the chain, synchronized manifest, and extracted client component catalog to agree before replacing the shared cache. It never writes balance settings. Missing table entries are accepted only where the manifest explicitly specifies zero, matching `energy::assembly_energy`; missing positive entries, obsolete IDs, changed costs, or a stale manifest prevent new online transitions until world configuration and synchronization succeed. A transient read failure keeps the last valid table for the same deployment. Switching deployments clears it.

The node's authored `smartAnchor.maxEnergyCapacity` defines its initial budget (1,000 in build 3502403). With chain synchronization enabled, the node's confirmed `EnergySource` supplies maximum production, current production, and `total_reserved_energy`. Available energy is `max(0, current production - reserved energy)`. The worker imports these counters alongside fuel and status, refreshes them after reconciliation, and invalidates old counters when a transaction commits or the deployment changes. Grid status requests wait for a fresh chain read; unavailable chain state cannot fall back to local totals.

Only confirmed online transitions reserve energy, and confirmed offline transitions release it. Online checks use the node's confirmed available energy and the current type cost, allowing for other committed online requests waiting for chain confirmation so simultaneous native commits cannot overbook the grid. Pending signatures do not hold capacity, and pending local transitions do not reserve or release the displayed total. The contract stores aggregate reservations only, so per-assembly rows show current configured costs, while the node total reflects actual reservations. Changing type costs does not recompute existing reservations. Without chain synchronization, local accounting retains assemblies in item-ID order and takes excess consumers offline when a cost change overloads the grid.

Fuel continues burning at the existing fuel-type rate independently of energy demand. Fuel loss or removal of a valid power source takes dependent assemblies offline.

The Network Node fuel slot is a virtual structure fuel bay (inventory flag 172),
not a second set of ordinary item rows. Dropping accepted inventory stacks into
the slot atomically consumes those rows and updates the local/Sui-backed reserve;
withdrawing fuel atomically materializes a normal stack and deducts the reserve.
Smart Storage and Industry use these same operations in both directions, with
the usual ownership, 5 km interaction, single-fuel-type, volume-capacity, and
pending-chain checks. This avoids duplicated fuel or partial transfers after a
write failure.

Grid responses expose the independent fuel level and power-usage band described
in `FRONTIER_SMART_ASSEMBLY_REQUESTS.md`. Every state transition is also written
to the shared assembly signal journal. Failed reservations publish an explicit
over-power-limit signal even though the rejected load is never added to the
confirmed energy total.

The embedded monitor's Network topology tab shows the grid, current use, available energy, and nearby assemblies. The `/evejs/energy` API uses a separate signed-wallet authorization scope and the active in-game character. Connection changes are serialized with chain synchronization, require ownership and the current solar system, and require the assembly offline. Manual disconnection persists and disables automatic reconnection.

The deployed Move contract cannot detach an already anchored assembly without removing its Network Node. Such bindings are preserved; the monitor disables Disconnect and explains the restriction. Previously unanchored assemblies can be connected or disconnected locally before synchronization anchors them.

## Temporary remote-scanning interface

Until the dedicated scanning Smart Assembly and Creation module are authored,
an owned, online Network Node is the authenticated scanner source. Its maximum
solar-system reach is configured by
`EVEJS_FRONTIER_NETWORK_NODE_SCAN_RANGE_JUMPS` and measured along stargate
connections. The dApp may choose any range from zero through that maximum and
uses the returned reachable-system list instead of trusting a client-authored
route distance.

The existing signed-wallet API exposes:

- `POST /evejs/energy/:networkNodeID/scanning/config`
- `POST /evejs/energy/:networkNodeID/scanning/start`
- `POST /evejs/energy/:networkNodeID/scanning/:scanID/status`
- `POST /evejs/energy/:networkNodeID/scanning/:scanID/result`
- `POST /evejs/energy/:networkNodeID/scanning/:scanID/cancel`

Jobs and signature blooms are durable and idempotent. Cold surveys query the
persistent system index without creating a scene; deep surveys may share a
controlled system warm-up. Results contain sparse aggregate heat cells, sites,
and resource fields, never remote Destiny balls, warp points, or targetable
contacts. Ships and bases are actor-blind: player and NPC sources use the same
public classes and no owner, character, faction, NPC, or entity identity is
serialized. The source resolver is deliberately generic so moving the Sui
contract to the future scanning assembly does not change job or result schemas.

No `world::network_node::NetworkNode` layout or deployed Move package is changed
for this temporary interface. Ownership is still established by the existing
signed-wallet Network Node flow, while reach, cost reservation, cooldown, job
state, warm-up, and redacted results are server authorities. Run
`npm run test:frontier-remote-scanning` for the focused server-package checks.

Relevant checks: `frontierNetworkNodeEnergy.test`, `frontierNetworkNodeFuel.test`,
`frontierSmartStorageUnit.test`, `frontierIndustryInventory.test`,
`frontierSmartAssemblyRequests.test`, `frontierAssemblyEnergyConfig.test`,
`frontierSmartAssemblyEnergyApi.test`, `frontierSuiAssemblyEnergy.test`, and the
Sui assembly snapshot tests, plus `frontierRemoteSystemScanning.test` and the
monitor's energy client/proxy tests.
