# Network Node energy grids

Completed Smart Assemblies automatically attach to the nearest completed Network Node owned by the same character in the same solar system, within 80,000 metres in three dimensions. The radius boundary is inclusive. Equal distances use the lower item ID. A saved connection stays with its node while valid.

Energy costs come from the deployed Sui world's `EnergyConfig.assembly_energy` table. The assembly sync worker reads and validates every page before replacing the shared cache. It does not write balance settings. Missing type entries cost zero, matching `energy::assembly_energy`; an unavailable table prevents new online transitions until synchronization succeeds. A transient read failure keeps the last valid table for the same deployment. Switching deployments clears it.

The node's authored `smartAnchor.maxEnergyCapacity` defines its budget (1,000 in build 3502403). Only online assemblies reserve energy. Online preparation and execution both check the node, fuel, radius, and remaining capacity; pending signatures do not reserve energy. Offline transitions release capacity. Fuel continues burning at the existing fuel-type rate independently of energy demand. Fuel loss or removal of a valid power source takes dependent assemblies offline. A lower configured capacity/cost change that overloads a grid retains assemblies in item-ID order and takes excess consumers offline.

The embedded monitor's Network topology tab shows the grid, current use, available energy, and nearby assemblies. The `/evejs/energy` API uses a separate signed-wallet authorization scope and the active in-game character. Connection changes are serialized with chain synchronization, require ownership and the current solar system, and require the assembly offline. Manual disconnection persists and disables automatic reconnection.

The deployed Move contract cannot detach an already anchored assembly without removing its Network Node. Such bindings are preserved; the monitor disables Disconnect and explains the restriction. Previously unanchored assemblies can be connected or disconnected locally before synchronization anchors them.

Relevant checks: `frontierNetworkNodeEnergy.test`, `frontierAssemblyEnergyConfig.test`, `frontierSmartAssemblyEnergyApi.test`, `frontierSuiAssemblyEnergy.test`, and the Sui assembly snapshot tests, plus the monitor's energy client/proxy tests.
