# Replace the temporary galaxy with 3572727 geography for client 3640684

Investigated 2026-10-27. **Keep client/runtime build 3640684. Use the mutually
consistent 3572727 FSD geography as the new world authority, without joining
its object IDs to the packaged `mapObjects.db`.** Add an explicit source
adapter and a new world revision; retain the existing client stage, Macho 489,
schema-14 encoder and gateway contracts.

The [implementation record](FRONTIER_3572727_IMPLEMENTATION.md) now documents
the completed source adapters, built candidate and full isolated validation.
The investigation and original worklist below explain those decisions.
The current world has not been switched; native client acceptance and any
later state migration remain separate.

## What the conflict actually means

The supplied build contains different physical snapshots, not a reversible ID
renumbering. Its FSD `systems`, `solarsystemcontent`, region/constellation data
and jump topology agree with one another. The packaged SQLite database
represents a different celestial population and geometry.

| Check | Result |
| --- | ---: |
| Systems with different planet counts between FSD and SQLite | 15,847 of 24,026 |
| Canonical planets assigned to another SQLite system | 38,592 of 42,223 |
| Canonical planets absent from SQLite | 117 |
| Canonical planets with any exact same-system XYZ match in SQLite | 68 |
| Unique host-star/planet-index diagnostic pairs | 29,873 |
| Those pairs with equal XYZ / equal type | 68 / 7,860 |
| Stars with equal ID, owner and type | 32,850 |
| Stars whose positions nevertheless differ | 15,542 |
| Canonical gates / SQLite gates | 11,728 / 9,564 |
| Canonical gate IDs retaining SQLite owner / position | 7 / 6 |

System **30000017**, for example, has four SQLite planets but one FSD planet.
Planet **42000034** changes type from 13 to 2015 and changes position from
approximately `(-3.699e9, -3.952e9, 2.716e10)` to
`(7.519e9, -2.916e9, -1.633e11)` metres. System **30000018** changes from one
SQLite planet to three FSD planets. Matching planet index, numeric offsets or
nearest position cannot reconstruct equivalent objects across these worlds.

The ordinal-pair median separation is approximately **121.9 billion metres**.
Only 70 pairs match within relative XYZ tolerance `1e-6`; this is not floating
point serialization noise. Exact-position matches retain the same IDs; no
renumbered exact physical planet was found by that check.

## Corrected stellar and landscape interpretation

The initial comparison checked primary stars only. The full source contains
**32,850 stars**, including **8,824 companions**, in **7,037 multiple-star
systems**. Including every `stellarObjects` entry corrects the earlier
landscape-reference counts:

| Landscape references against canonical FSD owners | Same system | Wrong system | Absent |
| --- | ---: | ---: | ---: |
| Shared 3640684 landscape: 98,809 occurrences | 46,544 | 42,271 | 9,994 |
| Full 3572727 landscape: 99,490 occurrences | 47,225 | 42,271 | 9,994 |

The **23,846 shared landscape rows** are unchanged from the 3640684 snapshot
and their parent references match the old SQLite world. In contrast, **all
681 direct references in the 156 added rows match the new FSD world**. The
added **323 belts** pass direct-parent checks and **96 Trojans** also pass
canonical Lagrange-parent checks.
The earlier 252 wrong-system references against SQLite are explained by these
new rows belonging to the new snapshot.

Even a same-system ID needs physical validation before carrying an old anchor
forward. Requiring matching ID, owner, group/type, XYZ and radius admits only
**1,782 stars, 62 planets and 166 moons** under the strict parent-geometry test.
This does not establish equality of every stellar/orbital property.
The embedded FSD schema explains some star-radius differences: it stores
Float32 radii. An explicit exact Float32 projection rule raises the star count
to 1,980; an arbitrary position epsilon is not justified.

Old Trojans also require the actual Lagrange point to remain the same. Thirty
old Trojan planet parents pass strict physical identity, but only **23 Trojans**
pass the additional Lagrange ownership/type/position checks. For example,
planet 42004524 remains physically identical while its L4/L5 IDs exchange
positions, moving each identified point approximately **990.9 billion metres**.
A planet-only check would falsely accept those anchors.

Under the conservative strict predicate, **689 old belts** have every direct
anchor proven and **23 old Trojans** have both planet and Lagrange point proven.
Adding the new canonical rows gives **1,012 fully proven referenced belts and
119 Trojans**. Another 48 old belts have no explicit direct references and are
outside that parent-proof count.
These are complete-parent proof counts, not a claim that other authored sites
must be discarded or that native encounter placement has been accepted.

## Why the 3640684 client can stay

The normal client map and planet-rendering path consumes server-supplied
`UniverseDelta` data through `ResolvedSystemSvc`, `UniverseIndex` and cfg shims.
`Planet.LoadPlanet` resolves a scene object's CRData item ID through
`cfg.mapSolarSystemContentCache.celestials`; missing data skips the model.
Therefore scene and exploration IDs, types and geometry must come from one
selected world. Copying the incompatible SQLite database into the client does
not solve that requirement.

The exact client has schema-14 `CompanionSuns`, planet `HostCelestialId`, moons
and Lagrange points. Normalize the primary stellar entry into `sun` and the
remaining entries into `companionSuns`; retain the authored primary position
and each planet's actual host, which may be a companion. Do not flatten all
hosts to the primary star or put every star at the origin.

An offline fixture used the existing server encoder and the **unmodified
3640684 generated decoder**. It round-tripped **1,145 field checks** over eight
systems, including a changed planet system, no planets, moons, a noncentral
primary, three stars, a companion-hosted planet, the new landscape snapshot,
Lagrange points and gates. The payload is 14,568 bytes. This proves the checked wire
conversion; it does not establish a running world, rendering or physics.

All **12 canonical star/planet/moon/gate type IDs** and **five Lagrange type IDs**
exist in the exact 3640684 type catalog, with their referenced graphic metadata.
Lagrange type selection is established by the client's 1-based point-index
constants, `88163..88167`. All **211,115** source points satisfy the explicit
ID/index conversion and independent L1–L5 geometry checks, without a SQLite
join. The conversion rule is a validated source-data policy, not a claim that
the original generator was recovered.

Schema-14 Sun does not transmit the complete new stellar orbital metadata.
Keep that metadata in the source artifact, but do not claim that preserving it
enables new orbital animation. NPC stations also need the existing station
reference/cached-object channel: `UniverseDelta` has no station table. Canonical
FSD supplies **224** stations, all type **85226**, whose type and graphic metadata
exist in 3640684. Their canonical parents and Lagrange links close correctly.
Only 15 of their IDs retain the SQLite system and only four retain its position;
use canonical records for their placement. The five SQLite-only station IDs
64000225–64000229 are not canonical replacement stations.

All 70,884 canonical moons lack an explicit `OrbitIndex`. Declare a new display
ordinal/name policy, such as 1-based sorted canonical moon ID within each
planet; the maximum 12 moons fits the existing uint8 slot. Preserve IDs and
positions and do not borrow old SQLite indices or accidentally emit only `M0`
fallback labels. This is a local display policy, not an identity crosswalk.

## Recommended source and content policy

Use **3572727 canonical FSD** for hierarchy, global centers, all stars, planets,
moons, Lagrange points and reciprocal gates. Keep source build **3572727** and
target build **3640684** separate in the manifest. Preserve exact coordinates
in metres; do not apply the map renderer's display transform during export.

For the initial replacement, retain the **3640684-compatible ecosystem,
dungeon, type and local allocation-policy catalogs**, and explicitly compose
them with the 3572727 landscape placements. Both placement exports use the
same 35 ecosystem IDs; their only ecosystem-row difference is the Starter
Creche's extra `ruins` tag. This keeps the requested geography change separate
from a new gameplay/content-catalog port. Record all source fingerprints and
conversion policies rather than relabeling the current temporary artifact.

All **137,368 target site IDs, system IDs and authored local positions** can be
retained as placement data. Classify shared versus newly authored rows and
admit parent links only when proven for that snapshot. Preserve unresolved
source anchors in the report. Keep unanchored encounter origins at their
authored positions; omit unsafe map rings/Trojan hierarchy where a required
parent cannot be proven. Never bind a reused ID to a physically changed planet,
move a site to a nearest planet, or claim complete native landscape fidelity.
Retain conservative exploration completeness flags.

A blanket 3572727 dungeon upgrade is unnecessary and has a separate blocker:
**seven referenced types are absent from the 3640684 catalog**. They occur in
dungeons **14138, 14468 and 14472**: 93459, 93989, 94086, 94151, 94166, 94182,
97234. None of the 35 target ecosystems directly references those templates,
but other direct invocation paths may. Retain the compatible 3640684 versions
or quarantine complete unsupported templates; do not silently strip their
unknown objects. Other target templates can be reviewed separately later.

This can replace the legacy galaxy authority. A fully native landscape for
the regenerated galaxy still needs compatible authored content or a separately
chosen regeneration policy for inherited placements; no lossless crosswalk
was established for those old parents.

## Implementation work needed before activation

| Boundary | Required change |
| --- | --- |
| `tools/frontier-static/export-exploration-world.py` | Add a canonical 3572727 adapter without SQLite metadata joins. Preserve all stellar entries, FSD host IDs and orbital/planet data. Derive Lagrange type/index by the validated source policy. Keep the existing legacy adapter. |
| `server/src/services/frontier/explorationWorld.ts` | Retain `targetBuild: 3640684`; admit a fingerprinted canonical-source profile as well as the legacy source. Derive bundle tags from that profile and a new typed content hash. Preserve graph/schema checks. |
| Landscape builder and `temporaryLandscapeProfile.ts` | Add an explicitly composed replacement content profile bound to the new base-world revision. Carry source-specific placement/catalog provenance and verified/unresolved anchor decisions. Do not widen old hardcoded hashes. |
| `explorationReferenceData.ts` and shared reference-data selection | Project the new world without inheriting old names, orbit parents, indices, radii or other metadata solely by numeric ID. Import/classify stations explicitly and prevent old belts/sites/stations from leaking through fallback supplements. |
| Voxel, landscape encounter and dungeon identities | Bind persistent state to the new base-world and content revisions, including the case with no temporary sidecar. Preserve the old profile's receipts and state. |
| `StartFrontierServer.ps1` / `.sh` and store ownership | Add a world-profile/revision selector with separate runtime/generated roots. Both current launchers key these roots by client build, so keeping 3640684 otherwise reuses its old store. |

The current exporter cannot be used by changing two arguments: it imports
SQLite names, hosts, star positions and Lagrange types. A read-only reproducer
fails at its first planet-bearing target system:

```text
ValueError: System 30000004 has missing/misowned map object 42000001
```

A proposed artifact identity is source profile
`3572727-canonical-fsd-v1`, target `3640684`, plus a base-world revision,
content revision, conversion-policy revision and catalog-source fingerprints.
Use a new immutable output directory, such as
`_local/frontier-worlds/3572727-for-3640684/<revision>/`; the existing runtime
loader will correctly reject that source until the adapter/validator work is
implemented. No runnable replacement artifact was created by this investigation.

## Validation, migration and rollback

1. Generate a new base-world artifact and complete anchor report. Require
   unique IDs, closed host/moon/Lagrange relationships, reciprocal gates,
   finite coordinates, compatible type/graphic references and exact hashes.
2. Check every exported system through the schema-14 encoder; extend the
   existing bounded exact-client decoder proof to the full artifact. Check
   scene/reference-table positions and IDs against the same source, including
   companion-hosted planets and all station placements.
3. Run an isolated candidate with **clientBuild 3640684** and a **new store
   root**. Verify map/detail/reveal/reconnect, rendering, travel, gate energy,
   docking/refueling, encounters, discovery and voxel pickup. Preserve the
   existing 3640684 stage and native/gateway profiles. Use separate listener
   ports when another server is running; a separate store does not isolate ports.
4. Choose a fresh-world activation or rehearse an explicit migration on copies.
   Reused IDs represent different objects: audit bookmarks, structures,
   occupancy, docking points, ships/characters, station/item locations and
   chain references. Do not carry mining depletion, discoveries or encounters
   into the new world solely because system or planet IDs match.
5. Stop the selected server and take a consistent complete-store backup before
   a later activation. Select the new immutable artifacts and profile-owned
   runtime, then restart. Keep the previous artifacts/runtime selection intact;
   rollback selects those originals and restarts, without deleting state.

The investigation does not justify an in-place migration or a new client patch.
Client-native rendering/physics and operational activation remain acceptance
work after the explicit data-source support is implemented.

## Evidence and reproducibility

The [evidence JSON](FRONTIER_3572727_GALAXY_REPLACEMENT_EVIDENCE.json) records
source hashes, full-star conflict analysis, physical-parent tests, canonical
closure, type checks, Lagrange policy, source-code boundaries and the exact
3640684 decoder result. Detailed scripts and outputs are under
`_local/planet-mapping-3572727/`.

The bounded proof can be rebuilt with `compatibility/build_fixture.py`, encoded
using `server/src/services/frontier/explorationUniverseEncoder.js`, then checked
with `compatibility/check_client_decoder.py` under Python 3.12. The preserved
fixture and payload are fingerprinted in the evidence. The earlier
[build comparison](FRONTIER_BUILD_3572727_COMPARISON.md) retains the original
manifest, contract and resource inventory.
