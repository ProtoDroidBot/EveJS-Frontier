# Network Node energy grids

Completed Smart Assemblies automatically attach to the nearest completed Network Node owned by the same character in the same solar system, within 80,000 metres in three dimensions. The radius boundary is inclusive. Equal distances use the lower item ID. A saved connection stays with its node while valid.

Energy costs come from the deployed Sui world's `EnergyConfig.assembly_energy` table. The assembly sync worker reads and validates every page before replacing the shared cache. It does not write balance settings. Missing type entries cost zero, matching `energy::assembly_energy`; an unavailable table prevents new online transitions until synchronization succeeds. A transient read failure keeps the last valid table for the same deployment. Switching deployments clears it.

The node's authored `smartAnchor.maxEnergyCapacity` defines its initial budget (1,000 in build 3502403). With chain synchronization enabled, the node's confirmed `EnergySource` supplies maximum production, current production, and `total_reserved_energy`. Available energy is `max(0, current production - reserved energy)`. The worker imports these counters alongside fuel and status, refreshes them after reconciliation, and invalidates old counters when a transaction commits or the deployment changes. Grid status requests wait for a fresh chain read; unavailable chain state cannot fall back to local totals.

Only confirmed online transitions reserve energy, and confirmed offline transitions release it. Online checks use the node's confirmed available energy and the current type cost, allowing for other committed online requests waiting for chain confirmation so simultaneous native commits cannot overbook the grid. Pending signatures do not hold capacity, and pending local transitions do not reserve or release the displayed total. The contract stores aggregate reservations only, so per-assembly rows show current configured costs, while the node total reflects actual reservations. Changing type costs does not recompute existing reservations. Without chain synchronization, local accounting retains assemblies in item-ID order and takes excess consumers offline when a cost change overloads the grid.

Fuel continues burning at the existing fuel-type rate independently of energy demand. Fuel loss or removal of a valid power source takes dependent assemblies offline.

The embedded monitor's Network topology tab shows the grid, current use, available energy, and nearby assemblies. The `/evejs/energy` API uses a separate signed-wallet authorization scope and the active in-game character. Connection changes are serialized with chain synchronization, require ownership and the current solar system, and require the assembly offline. Manual disconnection persists and disables automatic reconnection.

The deployed Move contract cannot detach an already anchored assembly without removing its Network Node. Such bindings are preserved; the monitor disables Disconnect and explains the restriction. Previously unanchored assemblies can be connected or disconnected locally before synchronization anchors them.

Relevant checks: `frontierNetworkNodeEnergy.test`, `frontierAssemblyEnergyConfig.test`, `frontierSmartAssemblyEnergyApi.test`, `frontierSuiAssemblyEnergy.test`, and the Sui assembly snapshot tests, plus the monitor's energy client/proxy tests.
