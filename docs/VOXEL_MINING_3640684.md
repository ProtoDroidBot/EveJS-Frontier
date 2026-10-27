# Voxel mining and scoop pickup — build 3640684

Implemented 2026-10-26 for the selected `3502403-MOD4-STUFF1` world. This is a
server-authored mining adaptation for the supplied cycle-7 client. The offline
contract and isolated server tests are evidence for the implementation; live
Windows client acceptance is still required.

## Enabled behavior

When `clientBuild` is exactly `3640684`, `miningEnabled` and
`voxelMiningEnabled` are true, supported ore asteroids are presented as target
type **95899** (Composite Asteroid). Older profiles retain their existing
mining behavior. This change does not select a new handshake/client profile or
launch either the client or server.

Mining modules, authoritative held-beam hits and mining drones consume the
selected voxel's ore. A partial extraction leaves that voxel visible; exhausting
it removes that cell, updates server collision geometry and emits
`OnCompositeVoxelMined(itemID, voxelIndex)`. Mining creates public scoopable
regolith with integer `CRRegolith.oreUnits`; it does **not** put the ore into a
ship's inventory. A full hold therefore does not prevent extraction.

The client's existing scoop action calls bound ship `BeginScoop(itemID)`.
The server checks the current ship/session, instance scope, visibility, range,
fragment availability and hold capacity, then acquires an exclusive claim.
It pulls the fragment and completes a channel before granting ore. The client
calls `CancelScoop(itemID)` to release it. Server-side cancellation also handles
disconnect, changing ships, warp/cloak/docking, loss of visibility/scope, moving
out of range, and failed capacity or persistence checks. Repeated begin calls
do not restart the channel; another pilot cannot cancel or complete the claim.

| Contract | Implemented value |
| --- | --- |
| `compositeAsteroidMgr.GetCompositeRecipe(itemID)` | Explicit target-compatible recipe dictionary, scoped to visible local entities |
| `GetCompositeMinedSet(itemID)` | `None` for an intact model; otherwise zlib-compressed LSB-first bits over original compact grid indices |
| Incremental carving | `OnCompositeVoxelMined(itemID, index)` to eligible observers; late join/reconnect fetches the complete mined set |
| Regolith | Verified target ore type, integer `oreUnits`, dynamic ball, scoped AddBalls/SetState/removal |
| `BeginScoop` result | `(pull_delay, channel_duration)` in relative 100-nanosecond simulation-time ticks |
| Maximum scoop distance | 2,500 m surface distance, matching the target public-scoop fallback |
| Pull and channel | 1,000 m/s pull to 800 m surface distance, then 1.5 seconds in simulation time |
| Destination | A compatible mining hold with room for the whole fragment, otherwise cargo; capacity is rechecked at completion |
| Pickup credit | Fragment consumption and inventory grant in one SQLite transaction |

The implementation uses the target's basic pull velocity, stop distance and
channel duration. It does not claim to reproduce every native acceleration,
slowdown, drift or visual easing parameter. No keyboard binding is assigned by
the server.

## World and material mapping

The eight existing base ore identities remain unchanged. Their legacy carrier
types become the new composite visual; collectible and inventory type IDs stay
the same. The material labels below are explicit server recipe policy, not a
claim that retail cycle-7 uses these exact recipes or quantities.

| Legacy carrier | Ore / regolith type | Target name | Recipe material |
| --- | --- | --- | --- |
| 91374 | 77800 | Crustal Anorthosite Crystals | feldspar |
| 91375 | 77810 | Massive Ataxite Matrix | ptpd |
| 91376 | 78426 | Native Reef Nodules | iridosmine |
| 91377 | 77811 | Hydrated Gossan Matrix | sulfide |
| 91378 | 78446 | Primitive Rime Shards | methane |
| 91379 | 78447 | Primordial Anthraxolite Sludge | kerogen |
| 91380 | 78448 | Irradiated Anthraxolite Veins | aromatic |
| 91381 | 78449 | Irradiated Cryoconite Nodules | tholin |

The catalog snapshot contains all **64** target regolith types and **2**
composite types, with their verified component flags, groups, graphics,
dimensions and public scoop policy. Automatic legacy-world conversion is
limited to the eight established base identities. Unknown legacy ores, grade
variants, unrelated decorative rocks, gas, ice and salvage are not silently
remapped. Explicit `voxelMiningPolicy.materialsByTypeID` mappings may opt a
verified target regolith into a supported material recipe with density,
porosity, toughness and gate tier. Missing retail substrate resources prevent
automatic reconstruction of retail grade balance. Existing unmapped mining
behavior remains available.

Four bounded shapes are baked using the original target's pure Python geometry
functions, with fixed explicit nonzero seeds. Every original grid coordinate
and index is preserved. Recipes use a single material and scale to the existing
asteroid radius. Converted bodies have a fixed identity orientation. The
remaining legacy ore quantity at first voxel activation is distributed across
the original cells; zero-allocation cells are absent in both client replay and
server hit testing. Existing lens/module compatibility and yield/waste/critical
calculations remain authoritative. A cycle is capped to its struck cell's
remaining ore; critical bonuses are recorded separately from source depletion.

## Persistence and failure recovery

`voxelMiningState`, owned by `service:mining`, stores a world/system/asteroid
identity, immutable recipe descriptor/hash, remaining and per-cell quantities,
removed cells and fragment receipts. Models share baked grids in memory; the
full coordinate array is not duplicated into persistence. Intact asteroids
are registered durably only when first mined.

Extraction updates the asteroid and creates its fragments in one SQLite
transaction. Pickup updates the fragment receipt and normal inventory rows in
one transaction. Ownership-scoped opaque row proposals prevent a mining writer
from gaining general inventory write access. Pending older table writes are
flushed first; cache/index publication follows successful commit. An abort
leaves the source and cargo unchanged. Item-ID high-water state is flushed
before fragment publication.

Loose fragments and partially depleted cells survive restart. Pull positions
are checkpointed once per simulation second and on cancellation. Claims are
process-scoped with a five-minute wall-clock lease; restart releases old
claims, while consumed receipts remain to prevent repeated grants. Temporary
write failures retain cancellation tokens and retry after storage recovers.
Public pickup permits any eligible nearby pilot, while dungeon/AIR scope
metadata is inherited from the resource.

Voxel depletion is durable for the configured world revision. Configurable
fragment expiry and asteroid respawn are implemented and disabled by default.
Expiry skips active pickup claims and persists terminal receipts. Respawn
requires full depletion and the configured delay, preserves old fragment
receipts, increments generation/revision and restores geometry. Fragment caps
reject extraction before consuming ore. Defaults preserve uncollected material.
Changing the revision creates a separate namespace; it does not migrate old
receipts or authorize deleting world state. The immutable exploration export
is unchanged and is not used to transport carved geometry.

## Configuration and verification

The new settings are:

```text
EVEJS_VOXEL_MINING_ENABLED=true
EVEJS_VOXEL_MINING_WORLD_REVISION=3502403-MOD4-STUFF1/3640684-voxel-v1
EVEJS_VOXEL_SCOOP_RANGE_METERS=2500
```

They apply only when `EVEJS_CLIENT_BUILD=3640684` (or the corresponding config
value). The rest of the target's handshake, static-data and staging settings
must still be selected consistently. Existing launch defaults are preserved.

The `voxelMiningPolicy` object also supports `fragmentExpiryMs` (default 0),
`respawnDelayMs` (0), `maxFragmentsPerSystem` (10,000),
`maxFragmentsPerAsteroid` (1,000), `materialsByTypeID` and `minerTierByTypeID`.
Configured toughness scales extraction yield and gate tier requires an eligible
miner. Density/porosity are validated substrate metadata; this does not migrate
all inventory mass or fractional quantity accounting.

After installing the repository's dependencies:

```sh
npm run build:server
npm run build:tests
npm run build:tools
npm run test:frontier-voxel-mining
```

For the exact-client oracle, set `FRONTIER_COMPOSITE_CLIENT_ARCHIVE` to the
supplied `stillness/code.ccp` and `FRONTIER_PYTHON312` to a Python **3.12**
executable. The test reports a skip if these inputs are unavailable; a skipped
oracle is not client verification. Both exporters read the supplied installation
without importing its native modules or modifying its files:

```sh
python3.12 tools/frontier-static/export-composite-mining.py --archive /path/to/stillness/code.ccp --out /tmp/composite-templates.json
python3.12 tools/frontier-static/export-voxel-catalog.py --client-root /path/to/EVE-Frontier --output /tmp/voxel-catalog.json
```

Tests cover target recipe/grid/bitset/ray agreement, CR serialization,
server collision holes, partial depletion, no inventory before pickup,
claims/timing/cancel/range/scope/capacity, rollback, replay and restart.
SQLite tests inject a failure during the second table write and verify both
disk and cache, then reopen state in another process to check duplicate pickup.

Recorded verification on 2026-10-26: server, test and tooling TypeScript builds
passed; **43 focused tests passed with zero skips**, including the original
3640684 bytecode oracle. Existing mining-respawn, held-beam routing/service and
space-collision regressions produced **76 passes and 4 fixture-dependent skips**.
Each focused suite runs in its own attested disposable store and module cache;
no live game state was changed. Loose regolith is explicitly rejected as a
mining target, preventing extracted stock from becoming a new resource body.

Exact collision cubes are coalesced into adjacent lattice runs: the four
initial templates require 95–119 collision boxes instead of 862–939. Tests
check occupied volume, boundaries and carved gaps across all four templates;
client recipe indices are unchanged.

## Remaining acceptance and compatibility work

- Run the 3640684 native client against a disposable candidate: inspect chunk
  removal, hit targeting, pull/channel visuals, cargo gain, reconnect/late join
  and concurrent pickup. Offline bytecode tests do not prove native rendering.
- Initial/late-join collision boxes and server collision geometry reflect mined
  cells. Carving also replaces the native ball through the existing visibility
  path to refresh its collision tail. Server dispatch is tested; flying/shooting
  through a new hole on a connected native client remains an acceptance check.
- Import remaining authored ore/vein/grade mappings and retail substrate
  density, toughness and gate-tier policy if retail balance is required. This
  implementation deliberately preserves legacy stock/yields and existing lens
  compatibility rather than claiming a retail hardness/density simulation.
- Tune the implemented respawn, expiry and fragment limits against live load.
- The broader [F01–F21 server implementation](FRONTIER_3640684_IMPLEMENTATION.md)
  includes the gateway envelope fix and the remaining service domains.
