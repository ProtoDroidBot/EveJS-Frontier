# Frontier build 3640684 port plan

**Status: F01–F21 server implementation added; native client acceptance and promotion pending.**  
Recorded: 2026-10-23. Updated: 2026-10-26. Repository reference: `bef5e36`.

The subsequent [3640684 feature audit](FRONTIER_BUILD_3640684_FEATURE_AUDIT.md)
compares actual target bytecode/descriptors with the pre-implementation server.
The user subsequently authorized the **entire F01–F21 backlog**. The current
[implementation record](FRONTIER_3640684_IMPLEMENTATION.md) describes the added
services, local policy choices, persistent state, tests and remaining evidence
boundaries. Native gameplay acceptance remains pending.

Follow-up on 2026-10-23: the user authorized a scoped, read-only investigation
of server-fed galaxy data. The [galaxy-data findings](FRONTIER_BUILD_3640684_GALAXY_DATA.md)
confirm the target client's exploration API, FlatBuffer universe model, and
map consumers. The subsequent user instruction released the hold and requested
implementation of this API. See [Exploration API](EXPLORATION_API.md) for setup,
implemented behavior, verification, and remaining limitations.

**Selected approach:** use the galaxy and solar-system data from
`3502403-MOD4-STUFF1` as the world authority and deliver it to client `3640684`
through `eve_public.exploration.api.GetKnownUniverse`, `GetSystemDetail`, and
`UniverseRevealNotice`, with the target `UniverseDelta` FlatBuffer layout.
The user selected this approach after the investigation. Source selection
is settled; the exporter and API implement that conversion, while full client
and gameplay compatibility remain unproven. This is
a legacy/custom world served to a cycle-7 client, not a claim to reproduce
the official cycle-7 galaxy.

The goal is to port the current EveJS Frontier functionality to the supplied
cycle-7 client using that selected legacy world. This document records
source-level planning, dependencies,
work packages, and future acceptance criteria. It is not a compatibility
report or evidence that the target build works.

The original hold is released for all server implementation and offline
validation in this plan. Work includes exploration, voxel mining/scoop and the
remaining audited feature domains. The target build has not been promoted,
and offline checks do not establish native gameplay acceptance.

## Target and evidence boundary

The supplied installation is:

```text
/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier
```

Its client build directory is `stillness/`; the installation contains a
sibling `ResFiles/` cache and `index_stillness.txt`. Read as ordinary text,
`stillness/start.ini` identifies:

| Field | Supplied value |
| --- | --- |
| Application | `FRONTIER` |
| Build / sync | `3640684` / `3640684` |
| Version | `20.04` |
| Codename / branch | `cycle-7` / `//frontier/cycle-7` |
| Region | `ccp` |

The directory contains Windows `bin64/exefile.exe`, `blue.pyd`, and
`python312.dll`. This describes the supplied client, not the globally latest
release or a verified runtime. The original planning pass did not examine
bytecode or validate compatibility. The follow-up records exact archive and
member hashes and inspects only the galaxy-related bytecode and descriptors.
The implementation adds decoded legacy FSD/world checks, exact universe wire
checks and an exact-build native patch profile verified on disposable copies.
Native launch and live compatibility remain unvalidated.
The later feature audit independently confirms target MachoNet version `489`;
version `20.04` alone did not establish that result. The birthday, general
Python bytecode contract and remaining RPC behavior still require their own checks.

The repository baseline is the
[3502403 Windows port candidate](FRONTIER_BUILD_3502403.md), from cycle 6.
Its documented Frontier handshake values are `V20.04@ccp`, MachoNet `489`,
and birthday `170472`; these were comparison inputs. Target MachoNet `489`
has since been independently confirmed; do not infer the other values from it.
The last documented Windows gameplay acceptance is `3474408`, and the
macOS baseline is `3467658`. Historical counts, hashes, and test results
must not be reused as acceptance evidence for `3640684`.

The selected world-source build directory is:

```text
/home/ludus/EveJS-Frontier/clientbuilds/3502403-MOD4-STUFF1/EVE Frontier/stillness
```

Resolve its geography resources through its own `resfileindex.txt`, parent
`index_stillness.txt`, and sibling `ResFiles/`. Keep the exact modified source
label as well as build `3502403`; another installation with the same build
number is not an interchangeable source. Its resource inventory is recorded
in the galaxy-data report; export validation is recorded in the API guide.

Existing local changes were present before this task: the
`smart-assembly-control` submodule was modified and `clientbuilds/` was
untracked, with a `3502403-MOD4-STUFF1` tree. Preserve them. The modified
client is now the selected geography source; it is not a clean target-build
executable source or authoritative source of official cycle-7 locations.

## Authorization and remaining decisions

The user authorized the entire 3640684 port backlog on 2026-10-26. Its server
implementation is recorded separately from the original planning and acceptance
criteria below. Existing worlds, installed client files, certificates and
chain deployments have not been migrated. Launch scripts now select cycle-7
when build 3640684 is explicitly requested; existing defaults remain.

Decision record (the selected world source does not need to be chosen again):

| Decision | Needed outcome | Current state |
| --- | --- | --- |
| Release the hold | User explicitly resumes implementation and/or validation, with any narrower scope recorded | **Released for the entire 3640684 backlog** |
| World authority | Use `3502403-MOD4-STUFF1` galaxy and solar-system data through the new exploration API | **Selected by user**; explicit exported artifact required |
| Discovery policy | Define initial user/character visibility, charted versus visited state, detail access, and detection rules for the selected legacy world | Starter/character hydration and visited detail are implemented; scanning feeds persistent thermal/EM discovery. See the API guide for the exact knowledge model. |
| Runtime platform | Confirm whether acceptance targets Linux/Bottles, native Windows, or both | Supplied installation is Windows in Bottles; gameplay support unproven |
| Feature baseline | Preserve current repository features; identify which custom-client additions must carry over | Current repository is the planning baseline; custom client changes need later inventory |
| Mutable world policy | Fresh isolated candidate world or an explicit migration of an existing world | Undecided; no reset or migration implied |

Do not put dates on implementation or acceptance until the compatibility
inventory and runtime scope are understood. The remaining data dependency
is cross-cycle catalog and simulation compatibility, not a search for a different galaxy.

## Selected legacy world and data composition

Use the selected `3502403-MOD4-STUFF1` source for region/constellation/system
identity, centers, hierarchy, gate topology, and authored local placements.
Use `3640684` for executable/protocol compatibility and target type, graphic,
localization, and gameplay catalogs. Old placements that reference catalogs
must resolve through explicit compatibility mappings; selecting an old
galaxy does not select the entire old type/Dogma database for the new client.

The target flow (export and exploration delivery implemented; catalog crosswalks
and simulation migration still pending) is:

```text
3502403-MOD4-STUFF1 geography + local-content references
       + 3640684 catalogs/contracts + explicit compatibility crosswalks
       -> versioned canonical legacy world
          -> exploration API / UniverseDelta pages, detail, notices
          -> existing location/map RPCs and server simulation
```

The map, scene loader, routes, jump ranges, NPCs, remote scanning, bootstrap
placement, and assembly placement must use the same canonical world. Do not
serve old galaxy coordinates while the simulation uses a different topology
or object-to-system mapping. Resolve conflicts by source ownership or a
recorded conversion rule, not an implicit last-write-wins merge.

Preserve these identities independently in future manifests: source build
`3502403`, exact source label `3502403-MOD4-STUFF1`, source file digests,
target client build `3640684`, converter revision, target universe schema,
world revision, and compatibility-map revision. Map each accepted world
revision to a distinct bundle version using the target's semantic-version
representation. The source label is provenance, not a literal replacement
for the protobuf semantic-version message. Bundle identity, `UniverseDelta.Sequence`,
knowledge revision, and schema version are separate values.

The existing pipeline assumes client-owned geography:

| Current source | Assumption relevant to the port |
| --- | --- |
| `tools/frontier-static/lib/frontier-client-discovery.mts` | General client discovery requires `bin64/staticdata/mapObjects.db` along with archives, manifests, certificates, and collision data |
| `tools/frontier-static/extract-frontier-static.mts` | `REQUIRED_RESOURCES` includes systems, regions, constellations, jumps, location cache, and solar-system content; request construction resolves the entire set |
| `tools/frontier-static/dump_frontier_static.py` | `export_universe_tables` writes `mapSolarSystems.jsonl.position` directly from `system.center`; it also reads topology, content, and the map-object database |
| `tools/frontier-static/validate-frontier-static.mts` | A complete snapshot requires map/system/location outputs and checks their relationships |
| `tools/DatabaseCreator/database-creator.ts` | `solarSystemRecord` consumes the exported position; bootstrap selection and generated world tables depend on system and station records |
| `tools/frontier-static/build-frontier-database.mts` | Generation checks complete snapshot counts, bootstrap references, and build-specific world authority |

Those assumptions require adaptation to two source roots. The `3640684`
catalog/contract path must not require the old map files to exist in the
target installation. The legacy-world path must resolve old geography from
its own indexes, not substitute target cache entries with similar names.
Retain source-specific manifests and create a composed target snapshot only
after its required fields and references are accounted for. Do not bypass
completeness checks by removing required files from a validator.

No target static-file geography restoration is planned: the delivery path
is the exploration API. No wholesale old archive/catalog copy or silent
relabeling of an old snapshot as a native `3640684` export is planned.
Missing source data must remain explicit, without fabricated positions or
zero-vector substitutes. Existing extractor defaults (including `5778` for
temperature and zeros for optional fields) must not masquerade as observed
values in the new mapping. Preserve missingness before applying any
documented, field-specific default.

### Required mapping register

This register retains the full port requirements. The exploration exporter
and adapter now implement the core hierarchy, centers, local celestial and
gate projections, version binding, and discovery policy. The API guide
records delivered fields and omissions; this register must not be read as
claiming that cross-cycle catalogs or all simulation consumers are mapped.

| ID | Selected source / meaning | Destination and required rule | Compatibility work still needed |
| --- | --- | --- | --- |
| M1 | Region/constellation static IDs, centers, names, and parent links | `UniverseDelta.Regions` / `Constellations`; preserve IDs, centers, and constellation-to-region membership | Inspect actual row shapes; require complete parent relationships and uint64-safe ID handling |
| M2 | `systems.static` key, `regionID`, `constellationID` | `SolarSystem.Id`, `RegionId`, `ConstellationId`; retain legacy IDs as the default | Audit collision/range constraints across wire IDs, server tables, sessions, and persistent references; any necessary remap must be global and explicit |
| M3 | `system.center` / exported `mapSolarSystems.position` | `SolarSystem.Center`, three Float64 values | Establish source units/axes and retain world-space coordinates. Do not preapply the client's `(-X,-Y,+Z) * 1.5e-15` map-display transform or use local celestial coordinates |
| M4 | System/region/constellation names and localization IDs | Literal `Name` plus `NameId` where target-compatible | Old name IDs may resolve differently or be missing. Define literal-name versus localization-remap behavior for each consumer; preserve original names in source records |
| M5 | Content radius, system security status/class, `sunTypeID` | `RadiusM`, `Security` (Float32), `SecurityClass`, `SunTypeId` | Verify radius units, numeric conversion, and target type meaning/availability; missing values are not genuine zero values |
| M6 | `frostLine`, `habitableZone`, star statistics temperature | `FrostLineM`, `HabitableZoneInnerM` / `OuterM`, `SunTemperatureK` | Check zone representation/order/units and optional source presence; do not propagate exporter-generated fallback values as source evidence |
| M7 | `mapObjects.db.celestials` joined with `solarsystemcontent.static` | Nested sun, planet/moon and other local content, retaining object IDs, types, local positions, radii and orbit relationships | Complete the exact nested schema map; reconcile duplicate records and field ownership; keep local positions distinct from M3 |
| M8 | Gate ID, type, local position, destination gate and gate ownership | `SolarSystem.Stargates` with destination gate/system references; related gate adjacency in `Neighbours` | Reconcile `jumps.static` with gate content, validate reciprocal links, and reject dangling destinations; preserve gate-local versus galaxy endpoint coordinates |
| M9 | Old distance resources and geometric relationships | Potential inputs to `GabrielNeighbours` (neighbor IDs and distances; confirm exact nested fields) | No direct mapping established. Determine graph semantics, distance units, and whether a documented derivation from legacy centers is needed; do not equate gate adjacency with geometric neighbors |
| M10 | Old `locationcache.static` and world object membership | Canonical object-to-system lookup for legacy RPCs, scenes and exploration detail | Reconcile against the selected world; target location-cache entries do not override legacy membership merely because IDs match. This table supplies no galaxy positions |
| M11 | Stations, Lagrange points, asteroid belts, landscapes, dungeon/site placements | Server world records plus the appropriate target-supported local-detail representation | Station/site/Lagrange nesting and delivery channels are not fully mapped. Preserve bootstrap and local content without inventing a generic FlatBuffer mapping or assigning all content to `StellarObjects` |
| M12 | Old type/group/graphic/localization/faction/dungeon references | Explicit crosswalk into compatible target catalogs; include target template references for authored sites | Same numeric ID is not proof of same meaning. Record identity mapping, replacement, retained local addition, or blocked content; never silently drop required world records |
| M13 | Selected source digest + conversion/crosswalk revision | Canonical world revision; protobuf `bundle_version` and FlatBuffer `BundleVersion`; schema 14 layout | Define consistent version formatting and invalidation. Keep client build, world version, schema, `Sequence`, and knowledge revision distinct |
| M14 | Server discovery state, not a geography file | `RevealLevel`, scope flags, explored-ID vectors, `SystemKnowledge`, and notices | Define starter visibility, charted/visited policy, allowed detail, thermal/EM detection and persistence. A full old map does not mean every character has visited it |
| M15 | Legacy asteroid/belt/site placement and ore references; target voxel-like asteroid/vein definitions | Separate resource placement, mutable mined geometry/depletion, collectible material and successful tractor pickup into their appropriate target contracts | Implemented for eight base ore IDs using target composite/regolith components, four exact client-derived grids, durable cells/fragments and channeled pickup. Remaining grade/vein/substrate balance mappings and native collision-tail acceptance are tracked in [Voxel mining](VOXEL_MINING_3640684.md) |

Additional target fields need a source-or-unsupported decision: `Luminosity`,
faction/description/sun-flare/wormhole/effect IDs, system classification flags,
secondary/companion suns, `StellarObjects`, `Interacting`, and thermal/EM
signal and rung fields. Some may exist in the original old records but be
lost by the current JSONL projection. Field presence in the target schema
does not prove the source contains a value. Inventory those source fields
before assigning defaults or declaring a feature supported.

### Exploration API mapping and lifecycle

| Operation | Planned source and response behavior | Required contract details |
| --- | --- | --- |
| `GetKnownUniverse` | Page a visibility-filtered projection of the canonical legacy world into `UniverseDelta` region/constellation/system vectors | Match `page`, `bundle_version`, `payload`, `next_page`, `total_systems`, and `knowledge` descriptors; support distinct pre-character user and character contexts |
| `GetSystemDetail` | Resolve `solar_system.sequential` against the same world revision and send the authorized local detail in a delta payload | Keep charted position distinct from visited/full detail; map denied, unknown, stale, and temporarily unavailable cases to the actual client error contract |
| `UniverseRevealNotice` | Publish authorized knowledge/detail changes from the same world and discovery state | Match bundle version, payload and knowledge fields; deliver through the gateway's notice path rather than inventing a legacy notification |

Plan stable, bounded pagination pinned to a world revision and a defined
knowledge view, advancing tokens and explicit termination. Sort region,
constellation, and system IDs strictly and remove duplicate rows; send
parent records before or with the systems that need them. Define behavior
for stale cursors, source/version changes, retries, reconnects, duplicate
notices, and character switches so data cannot mix across worlds or users.
The meanings of `total_systems`, FlatBuffer `Complete`/`Sequence`, and
knowledge completeness/revision need a recorded contract; they are not
interchangeable counters or flags.

The client clears caches on bundle changes and drops reveal notices from a
conflicting established bundle. Keep response and payload identity coherent,
and align page/detail/notice views. `Charted = 0` and `Visited = 1` are known;
`CelestialScopeFull`, `LagrangeScopeFull`, `OreScopeFull`, and explored-ID
vectors must reflect both actual delivered coverage and discovery policy.
Do not expose missing content as an authoritative empty/full result.

### Compatibility gap register

The API guide records focused implementation and offline results. Remaining
gaps below still prevent full client-port acceptance.

| Gap | Current evidence / uncertainty | Required resolution and related package |
| --- | --- | --- |
| G1: exploration provider | Gateway dispatch, descriptors, schema-14 encoder and notices are implemented | Live target-client delivery still requires V5 |
| G2: extraction composition | Dedicated legacy exploration exporter now reads the selected old dataset and records provenance | General target-catalog/world database composition remains under P1/P2 |
| G3: incomplete field map | Top-level universe/system fields are known; all nested local-content layouts, old optional fields and exact error codes are not | Finish M1–M15, including source/default/unsupported decisions and target consumer requirements, before claiming coverage under P2/P4 |
| G4: cross-cycle references | Type/graphic/name/faction/template IDs may be missing or changed; modified source may contain local additions | Produce explicit crosswalks and blocked-record inventory under P2/P5; do not broaden permissions or import all old catalog behavior |
| G5: geometry/topology | Raw centers, local coordinates, jump links and geometric neighbor data represent different things | Establish units, axes, precision and graph mapping, then check complete hierarchy and references under P2; use the same geometry in P5 runtime consumers |
| G6: disclosure and state | Starter/character visibility, visited-only detail and persistent knowledge are implemented; thermal/EM detection remains empty | Integrate actual scanning progression under P5; validate errors in the running target client |
| G7: delivery consistency | Bounded signed cursors, bundle binding, scoped notices and per-world state are implemented | Verify reconnect/cache behavior with the live target client under V5 |
| G8: runtime coverage | A galaxy map does not establish bootstrap, stations, rendered local scenes, travel, resource sites or NPC behavior | Reconcile canonical world consumers, content channels, and feature limits under P5; preserve local and galaxy coordinate separation |
| G9: persisted world identity | Existing stores and Sui links may be bound to old assumptions rather than this exact source revision | Choose fresh isolated state or an explicit mapping/migration; bind stores to world revision under P6 |
| G10: acceptance unproven | Selected-world export and wire payloads have offline checks, but no live Windows/Bottles acceptance | Complete the remaining V1–V6 gates; offline decoding is not live acceptance |
| G11: voxel mining and collection | Core F02/F03 implemented for eight legacy base ores: exact target-generated geometry, cell removal/replay, regolith, timed pickup and atomic persistence | Complete remaining ore/vein/grade and substrate balance mappings; verify native rendering and incremental collision-tail behavior. See [implementation and acceptance gaps](VOXEL_MINING_3640684.md). |
| G12: shared gateway wire drift | Target user notice target is sint32; current server int64 encoding changes user 42 to 21 when decoded by the target. Some identifier widths also differ | F01: correct envelope/identity/dependency schemas and test actual target encoders/decoders, separately from domain protobuf tests |
| G13: missing player command/services | New flight commands, magnetic docking points, Digital Chemistry, complexity skills, and several gate/IFF/publication operations have no matching implementation | F04–F07/F12–F14: implement target request/results/notices and authoritative state under P4/P5 |
| G14: incomplete progression and economics | Memory/ascension/crown/medical operations are stubs/refusals; relay/feral trading and currency exchange mutations are missing | F08–F11: implement persistence, validation, transactions and UI state updates; retain existing functional industry/equipment behavior |
| G15: conditional feature policy | Lagrange claims, pack entitlements, smart kill reports, Cycle Hub and native wallet/event workflows are absent or partial, with enablement/authority decisions unresolved | F15–F19: establish local profile requirements, then implement selected workflows or explicitly document their unavailability |

The source selection removes the missing-source decision. Cross-cycle content
compatibility, simulation consistency and live acceptance remain outstanding.
No replacement cycle-7 geography search is required for this legacy-world port.

## Verified feature backlog — 2026-10-26

The [feature audit](FRONTIER_BUILD_3640684_FEATURE_AUDIT.md) contains exact
client symbols, server paths, wire counterexamples and supported baselines.
IDs below are shared with that report; this table is the actionable port work,
not a claim that every conditional client module must be enabled.

| ID | Current server implementation | Remaining compatibility boundary |
| --- | --- | --- |
| F01 | Exact shared gateway contracts, target identifier widths, authenticated request/event/notice routing and private delivery | Native login and notice-consumer acceptance; remote authentication needs a provider |
| F02–F03 | Persistent composite mining, scoopable regolith, atomic pickup, native collision replacement and configurable lifecycle/grade policy | Missing retail substrate resources and full ore mappings; native carving/pickup acceptance |
| F04 | Pitch/roll rates, braking, heading, independent axes, persisted state and Destiny echoes | Native prediction and interpolation acceptance |
| F05 | Dock capabilities, reservation/approach/settling/undock, recovery, cargo access and stock-backed refueling | Native port workflow acceptance |
| F06 | Authored chemistry recipes, previews, escrow, timed jobs, refunds, outputs and completion notices | Whole inventory units; general fractional stock/mass migration remains separate |
| F07–F09 | Complexity/vault, memories/ascension/crowns/shells, medical kits/remedies and trait integration | Configure shell recipes and local progression policy; native UI acceptance |
| F10–F11 | Relay purchases, feral-data sale and signed LUX/EVE ledger conversions with atomic receipts | Explicit local prices/rates; external chain authority requires a real provider |
| F12 | Target gate rebuild/fuel contracts, material accounting, energy reservation/refund and state projection | Initial fuel for imported active gates is emulator policy; native travel acceptance |
| F13–F14 | Authorized transponders, publication/revocation and lifecycle-aware discovery | Native visibility/UI acceptance |
| F15–F16 | Persistent authorized Lagrange occupancy and configured/durable construction entitlements | Configure pack requirements and grants; native claim UI acceptance |
| F17 | Authoritative kill provenance, wallet/participant checks and duplicate-safe local receipts | External reporting requires confirmed backend receipts |
| F18 | Founder entitlement, configured activity objectives, achievement and trusted upload-result notices | Configure objectives/entitlements; no invented upload provider |
| F19 | Wallet binding, real Sui signature checks and meaningful event processing | Official JWT/Enoki proofs require configured authority; native signer acceptance |
| F20 | Canonical geography, scan discovery, mutable resource summaries and decoded target landscape/ecosystem/dungeon integration | [Temporary content profile](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md) retains all 136,443 authored site positions on matched legacy systems; unresolved planet links are omitted per user choice. [Resource/NPC allocation and triggers](FRONTIER_3640684_LANDSCAPE_POLICIES.md) use native rules with versioned temporary defaults for missing budgets/rosters. Replace when full era 6 cycle 7 files arrive; native acceptance remains pending. |
| F21 | Exact native/code profiles, build-selected cycle-7 handshake and verified disposable staging | Native Windows/Bottles launch and gameplay acceptance; defaults are not promoted |

See [implementation details and validation](FRONTIER_3640684_IMPLEMENTATION.md)
for the local policy choices and concrete remaining boundaries. The original
work packages below remain acceptance criteria, rather than a current list of
unimplemented services. Preserve older-profile behavior, and keep QA tools,
client-only HUD changes and hidden legacy EVE features outside this backlog.

## Full-port work packages

P2/P4 exploration export, encoding, delivery and state work is implemented as
recorded in the API guide. The other work and broader acceptance requirements
below remain a plan; implementation of the API alone does not complete them.

### P1 — Establish exact inputs and the cycle-7 difference inventory

Preserve both the target installation and
selected legacy-world installation; prepare isolated analysis/staging
locations only when work resumes.

- Record exact source hashes and provenance for `start.ini`, `code.ccp`, the
  manifest, executable, native module, indexes, CA bundles, loader binaries,
  collision bundle, and resources used by the port. Resolve cache entries
  from the selected installation's indexes.
- Fingerprint the selected `3502403-MOD4-STUFF1` geography sources and its
  indexes separately, including map objects, systems/hierarchy, gate/jump
  content, local placements, and referenced templates. Do not substitute
  historical stock-3502403 hashes/counts for this modified source.
- Check actual layout requirements before running the current all-or-nothing
  discovery path; account for changed or missing files with explicit
  capabilities, not placeholder files. Confirm archive/bytecode and native
  loader versions before interpreting them.
- Compare target modules, descriptors, static schemas, and authored IDs with
  a provenance-recorded `3502403` baseline. Track added, removed, and changed
  surfaces separately from local modifications in the old custom client.
- Produce a target evidence inventory and a change matrix: observed change,
  affected consumer, planned action, and unknowns. Keep every unsupported
  assumption visible. Do not assume the small changes documented between
  earlier cycle-6 builds apply across the cycle boundary.

Primary files: `tools/frontier-static/lib/frontier-client-discovery.mts`,
`tools/frontier-static/lib/frontier-python.mts`,
`tools/frontier-contracts/export-frontier-contracts.mts`,
`tools/frontier-contracts/dump_frontier_contracts.py`.

Completion artifact: a build-specific input inventory and comparison record;
no claim of gameplay acceptance.

### P2 — Convert the selected legacy world and compose target authority

Depends on P1; world-source selection is complete. Design the two-input
composition and complete M1–M15 before changing extraction behavior.

- Adapt resource discovery and extraction to cycle-7 layouts and schemas.
  Keep missing optional catalogs distinct from missing required authority.
- Read world geography and local placements from `3502403-MOD4-STUFF1`;
  combine them with compatible `3640684` catalogs through explicit ID and
  field mappings. Preserve legacy identity and missingness, reject unresolved
  required references, and record target-specific substitutions.
- Retain separate raw source exports/manifests and produce a canonical world
  plus composed server data. Share that world with the P4 encoder and P5
  runtime consumers; do not create an independent map-only copy.
- Resolve G2–G5: full hierarchy and coordinates, nested local content,
  topology/geometric neighbors, names/assets, and fields absent from the
  current exporter. Classify every required mapping as direct, transformed,
  explicitly unsupported, or blocked, with source evidence and consequences.
- Review types/groups/categories, Dogma, typelist nested/tag rules, Creation
  parts/modules/hardpoints/templates, industry facilities/blueprints,
  materials, space components, localization, collision assets, dungeons,
  ecosystems, landscapes, celestial content, and topology.
- Preserve schema-v2 typelist semantics and server authorization boundaries.
  Audit configured type/list IDs instead of assuming cycle-6 values survive.
- Review Rift/Tallyport/Relay assertions and bootstrap choices against the
  selected modified world and target catalog compatibility. Scope checks to
  the world revision; do not just add `3640684` to `RIFT_AUTHORITY_BUILDS` or
  impose stock-3502403 world counts on the modified source.
- Resolve local additions explicitly: Physics Gun authority is currently
  injected only for `3502403` in `database-creator.ts`, with a matching
  count exception in `build-frontier-database.mts`. Decide its target source
  type and collision-free ID before carrying it forward.

Primary files: `tools/frontier-static/extract-frontier-static.mts`,
`dump_frontier_static.py`, `extract-industry-static.py`,
`validate-frontier-static.mts`, `audit-frontier-references.mts`,
`type-list-audit.mts`, `build-frontier-database.mts`, and
`tools/DatabaseCreator/database-creator.ts`.

Completion artifacts: M1–M15 field map, compatibility crosswalks and blocked
records, versioned canonical legacy world, composed target snapshot, and
generated store candidate, with later validation evidence. Keep existing
build outputs intact. None of these conversion artifacts exists as a result
of this documentation update.

### P3 — Port staging, launch, and exact client adapters

Depends on P1 and the runtime-platform decision; final end-to-end acceptance
also depends on P2 and P4–P6.

The supplied Bottles path does not make the existing shell launchers Linux
launchers. `StageFrontierClient.ps1`, `StartFrontierServer.ps1`, and
`PlayFrontier.ps1` require Windows; the `.sh` staging/launch workflow uses
macOS `EVE.app`/`blue.so` conventions. Static extraction already has an
explicit Wine bridge in `lib/frontier-python.mts`; reuse and assess it before
creating another bridge. Contract decoding and native FSD loading have
different interpreter requirements.

- For Linux/Bottles scope, specify runner/prefix selection, Flatpak-visible
  paths, Linux/Windows path translation, staged resource access, process
  ownership, logs, settings isolation, local endpoints, and cleanup/rollback.
  Keep loader probes separate from the user's gameplay prefix where possible.
  Preserve ownership and source/stage separation guarantees from the Windows
  workflow when adapting them to Linux filesystem semantics.
- For native Windows scope, retain the existing staged-copy workflow and its
  ownership checks. Record platform acceptance separately.
- Establish an exact `3640684` native profile and archive/module profiles only
  from target analysis. Retain failure on unknown input and partial patch
  states, transactional backup/restore, and source/stage separation.
- Inventory every active adapter and decide retain, rewrite, retire, or
  blocked. Include docking/features, Creation transforms/presets, fitting,
  inventory, industry storage, map lifecycle/scene, action bars, NPC menus,
  skillshots, turret tracking, collision VFX, asteroid scale, dungeon
  holograms, and Physics Gun. Do not bulk-copy old offsets or hashes.
- Follow `tools/frontier-client/AGENTS.md`: isolate optional failures within
  operations, preserve usable original paths, and keep denied mutations
  explicit. Later checks must exercise failure isolation where material.
- Review local CA/manifest and redirect handling for the chosen runtime;
  stage changes without modifying the supplied retail source or shared cache.

Primary files: `SetupFrontierWindows.ps1`, `StageFrontierClient.ps1`,
`StartFrontierServer.ps1`, `PlayFrontier.ps1`, `StopFrontier.ps1`,
`tools/frontier-client/frontier_windows_client.py`,
`patch_frontier_client.py`, the `patch_frontier_*` helpers and adapters,
and `tools/frontier-static/lib/frontier-python.mts`.

Completion artifact: an explicitly selected `3640684` staged-client candidate
and documented platform workflow, with recoverable changes and later checks.
Keep existing defaults until the promotion decision.

### P4 — Port transport, session, RPC, and gateway contracts

Depends on the P1 target contract inventory; the exploration provider also
depends on P2's canonical legacy world. Derive target MachoNet,
birthday, release/codename, challenge handling, framing, marshal, and Python
object shapes from exact-client evidence. Scope changes to the Frontier
profile; retain the separate conventional EVE Online configuration.

- Compare service names, method arguments/results, notifications, session
  transitions, cached objects, and error contracts. Track every changed call
  to its server consumer before deciding implementation scope.
- Review CRData, slim-item, ball and state-stream encoding, binding order,
  movement updates, and undock behavior; `carbon.json` or a version string
  alone cannot establish Destiny compatibility.
- Compare public protobuf field numbers, types, labels, maps, enums, and
  request/response envelopes against actual target descriptors. Cover core,
  gate, Network Node, storage, and any changed active service.
- Implement the now-identified `eve_public.exploration.api` messages:
  `GetKnownUniverse`, `GetSystemDetail`, and `UniverseRevealNotice`. Encode
  the target `UniverseDelta` FlatBuffer layout (bundled schema version 14),
  with coordinates/hierarchy, page tokens, bundle identity, ordered IDs,
  local-detail scope, and discovery state. Initial user-scoped loading and
  character-scoped requests need separate handling. Legacy map rowsets and
  the existing map-tags CDN response do not provide this contract. See the
  exploration lifecycle and G1/G3/G6/G7 above for the selected-world design,
  and the scoped report for exact fields and consumer evidence.
- Extend the existing gateway registration and request/notice handling with
  an exploration provider backed by the canonical world and separate
  persistent knowledge state. Keep serialization and visibility policy
  distinct; specify unsupported/error replies before enabling clients.
- Assess TLS, HTTP/2/gRPC, asynchronous notifications, XMPP, wallet/token
  context, and local redirect behavior without assuming that descriptor
  parity proves transport or authentication behavior.

Primary files: `server/src/network/tcp/handshake.ts`,
`handshakeCompatibility.ts`, `packetFraming.ts`, `utils/marshal.ts`,
`server/src/network/packetDispatcher.ts`, `clientSession.ts`,
`server/src/space/destiny/stream/`,
`server/src/services/ship/destinyCompatibility.ts`,
`server/src/_secondary/express/publicGatewayLocal.ts`, and
`server/src/_secondary/express/gatewayServices/`.

Completion artifact: a reviewed target call/descriptor matrix and narrowly
scoped compatibility changes, with later fixtures pinned to `3640684`.

### P5 — Reconcile gameplay, world consumers, and Sui integration

Depends on P2 and P4, with P3 required for client acceptance.

- Reconcile character creation, clone/shell/refuge selection, Creation fitting
  and abilities, charges/reload, inventory, berthing/docking, combat/HUD,
  temperature/status, and scanning models against target contracts.
- Port voxel-like asteroid/vein mining and separate tractor collection using
  the requirements below; exploration resource placement alone does not
  implement mining or material pickup.
- Reconcile construction/deployment, ownership/access, energy/fuel, storage,
  gate links, industry facilities/blueprints/job lanes, and notifications.
  Missing or changed authored IDs must not widen permissions.
- Route map, travel, range, scene placement, remote scans, and NPC behavior
  through the selected canonical legacy world, including existing location
  and map RPCs. Reconcile bootstrap, stations, sites and assemblies with the
  same IDs and positions used by exploration detail. Separate galaxy
  coordinates from in-system scene coordinates and gate-hop reach.
- Audit authored references in `frontier-dungeon-*.json`,
  `frontier-landscape-spawns.json`, `npc-*.config.json`, and runtime settings.
  Decide how unsupported cycle-7 features are surfaced; do not blanket-enable
  client features without server behavior.
- Compare client-facing changes with current `world-contracts`,
  `builder-scaffold`, and `smart-assembly-control` interfaces. Preserve
  package/object/world IDs and assembly linkage unless a separately planned
  migration requires changes. A client port does not by itself require a
  chain deployment or submodule update.

Primary files: `server/src/services/frontier/` (Creation, deployment,
industry, berthing, scanning, jump-drive, and Sui services),
`server/src/space/worldData.ts`, `server/src/services/_shared/referenceData.ts`,
`server/src/services/map/mapService.ts`, and `server/src/space/` scene/NPC code.

Completion artifact: a feature matrix marking each current feature supported,
changed, intentionally deferred, or blocked, with reasons and later evidence.

#### Asteroid/vein mining and tractor collection

User observation recorded 2026-10-26 for build `3640684`: asteroids behave as
voxel-like entities, mining can remove chunks, and mining an asteroid or vein
does not immediately award ore. A separate key-triggered tractor action picks
up the material. The subsequent feature audit corroborates this with target
`compositeAsteroidMgr.GetCompositeRecipe/GetCompositeMinedSet`, voxel-change
notices, `CRRegolith.oreUnits`, and ship-access `BeginScoop/CancelScoop` calls.
The user subsequently requested implementation. The server now provides
`compositeAsteroidMgr`, exact target-generated recipe grids/mined bits, per-cell
extraction, incremental notices, persistent regolith and channeled pickup.
Supported asteroids no longer credit cargo at extraction. Mining modules,
held beams and mining drones use the same voxel authority. SQLite commits
fragment creation with depletion and consumption with inventory credit.

See [Voxel mining implementation](VOXEL_MINING_3640684.md) for the eight base
ore mappings, activation settings, contracts and reproducible tests. Converted
asteroids use fixed identity orientation and preserve legacy ore quantities.
Unknown/grade ore mappings, retail substrate density/toughness/gate balance,
automatic respawn/expiry and native incremental collision-tail acceptance
remain open. Existing nonmapped resources and older client profiles retain
legacy mining. A keyboard binding has not been guessed or reassigned.

Remaining acceptance work (the original requirements below now have focused
implementation and offline tests where covered):

- Identify resource/vein types and geometry inputs, mining hit/removal messages,
  depletion rules, and how geometry changes reach nearby clients and late
  joiners. Preserve partial removal; do not treat every mined object as a
  static sphere or remove the entire asteroid on the first successful hit.
- Identify how collectible material is represented and maps to ore type and
  quantity. Separate extraction/depletion from collection: inventory credit
  follows a successful server-authorized pickup, with retry/concurrent-pickup
  handling that cannot award the same material twice.
- Map the tractor action and its eligibility, range, capacity, cancellation
  and failure behavior from the target contracts. Do not guess a key binding
  or assume the existing inventory-transfer/mining path already matches it.
- Define persistence and lifecycle rules for partially mined geometry and
  uncollected material, including restart, despawn and respawn semantics.
  Keep these mutable records separate from the immutable exploration artifact
  and its bundle revision. Determine which updates use scene replication
  versus exploration discovery; do not assume `UniverseDelta` transports
  mining geometry changes.
- Validate visible chunk removal, no ore award before pickup, successful
  pickup and matching inventory gain, rejected/duplicate/concurrent pickup,
  cargo-full behavior, partial depletion, and reconnect/late-join consistency.
  Define remaining cases from the actual target lifecycle before testing.

The current exploration export omits asteroid belts and ore sites and leaves
`OreScopeFull` false. Its successful map/detail checks therefore provide no
mining, voxel geometry or tractor-pickup acceptance evidence.

### P6 — Isolate candidate state and design any migration

Depends on P2, P4, and P5. Prefer a fresh disposable candidate for initial
acceptance; this is not permission to reset or replace an existing world.

Retain the established build-scoped layout when artifacts are later created:

```text
_local/frontier-sde/3640684/
_local/frontier-contracts/3640684/
_local/frontier-gameStore/3640684/data/
_local/frontier-runtime/3640684/gameStore/
```

These are proposed target-build roots, not source provenance. Keep raw
`3502403-MOD4-STUFF1` exports separately identified; never rename them into
these roots as though they came from the new client. Bind composed artifacts
and runtime ownership metadata to the selected source label, world revision,
crosswalk revision, and target build. A matching `3640684` build number alone
must not authorize reuse of another world snapshot. Refuse mismatched state
until a fresh-world or explicit migration decision resolves it.

- Preserve the complete previous store, including SQLite and companion
  files/assets, using a consistent stopped or supported backup procedure.
- Enumerate character/station/system placement, ships and inventory, fitted
  types, bookmarks, assemblies, jobs, custom/dungeon/rift sites, NPC state,
  scan journals, gate links, discovery/visited state, page cursors, and Sui
  references requiring mappings or invalidation. Include partially mined
  asteroid/vein state, uncollected material and pickup transaction identity
  once their target lifecycle is established. Include docking-point state,
  chemistry jobs, skill complexity/vault, memories/crowns, occupancy claims,
  entitlements and trading/exchange/report transaction IDs from F05–F19.
  Retained world IDs do not
  establish that all persistent type and location references are compatible.
- Specify explicit retain/remap/quarantine/reject decisions for missing IDs
  and positions. Do not relocate players or silently discard state.
- Rehearse migration and rollback on disposable copies only after the hold
  is released. Keep the old client stage, data roots, and launcher selection
  available throughout candidate acceptance.

Primary files: `server/src/gameStore/storeRoot.ts`, `tableOwnership.ts`,
`index.ts`, `exportPlayers.ts`, `importPlayers.ts`,
`playerTransferShared.ts`, and `StartFrontierServer.ps1`.

Completion artifact: either a documented fresh-world decision or an explicit
migration mapping and rollback procedure, followed by later rehearsal results.

## Full-port validation and promotion gates

The following is the full-port checklist. Focused exploration checks are
recorded separately in the API guide. Each result must identify the exact client build,
input hashes, world-data revision, runtime platform, and any skips.

| Gate | Planned evidence and relevant existing coverage |
| --- | --- |
| V1: source and stage | Exact input/profile matches; patch/check/idempotency/restore on temporary copies; original source preserved; `tools/frontier-client/test/` and Windows runner coverage, plus Linux/Bottles coverage if in scope |
| V2: static and world authority | Exact modified-source hashes, deterministic M1–M15 conversion/crosswalks, missingness and completeness, IDs/references, coordinate conventions, topology, bootstrap/content and typelist parity; no reliance on stock-3502403 counts; static/reference/database validators after adaptation |
| V3: build and offline contracts | Handshake/framing/marshal and exact target descriptors, including F01 envelope zigzag/wide IDs and F02–F19 request/result/notice fixtures; the original envelope incompatibility is fixed and covered by the target profile tests. Use `frontierHandshakeProfile.test.ts`, `frontierClientContracts.test.ts`, `frontierActualGatewayContracts.test.ts`, `frontierPublicGatewayAsync.test.ts` plus target-derived coverage for new work |
| V4: isolated server regressions | Disposable target world, explicit `3640684`; existing feature regressions plus voxel/depletion/scoop accounting, flight echoes, docking-point permissions, chemistry jobs, skills/progression/medical state, trade/exchange, publication/IFF/gate adapters, selected conditional features, persistence and migration |
| V5: live client acceptance | On each claimed platform: staged trust/login/selection, map/detail/reveal and rendered space, all new manual controls, visible asteroid chunk removal and collection before ore credit, docking-point/refuel, chemistry/progression/medical/trader UI loops, existing Creation/inventory/gates/industry/scanning, selected conditional workflows, reconnect/restart persistence and rollback |
| V6: promotion | Evidence review, documented feature limitations, chosen migration policy, then an explicit decision to change defaults and publish build notes |

Specific later exploration acceptance must cover:

1. Deterministic conversion of the selected modified source and complete
   parent/reference mapping, including nonzero source coordinates and
   explicit missing-data cases; no fabricated geographic defaults.
2. Exact protobuf/FlatBuffer layout and ID-width round trips for selected
   records, sorted vectors and nested detail, plus at least two stable pages
   with advancing/terminating tokens and consistent bundle identity.
3. User-scoped starter data, character-scoped known universe and allowed
   detail, refused/unknown/retryable cases, and correct disclosure/completeness
   flags. Offline exploration fixtures now cover these API cases; live client
   error handling remains to be accepted.
4. A reveal update, duplicate/reconnect handling, character changes, stale
   cursors, bundle invalidation, and knowledge persistence without mixing
   world revisions or treating all charted systems as visited.
5. A live isolated legacy-world sample whose rendered galaxy centers,
   local object placement, gate destinations, and server range/travel behavior
   agree with the canonical source, followed by full-world acceptance.

For V3, supply `EVEJS_FRONTIER_CONTRACT_INDEX` pointing at the exact target
export: `frontierActualGatewayContracts.test.ts` otherwise intentionally
skips when the local export is missing. A passing run with unintended skips
is not target-contract acceptance.

For V4, `scripts/Tests/run-frontier-server-tests.ts` requires build-scoped
static and runtime inputs and delegates to the isolated runner. Explicitly
select `3640684` and use a disposable baseline; do not let its current
`3502403` default select old fixtures. Preserve conventional EVE Online
and supported older-profile coverage when shared code changes.

Do not equate offline success, Linux/Wine extraction success, or historical
Windows acceptance with live `3640684` gameplay. Keep native Windows and
Linux/Bottles acceptance records separate. Change launcher/test defaults
and write `FRONTIER_BUILD_3640684.md` only at the appropriate promotion
decision, with achieved gates and remaining limits stated precisely.

## Work order and handoff

P1 establishes the evidence needed for
the other work. P2 converts the selected legacy source; P3 and P4 contract
work can proceed alongside it once their target inputs and platform decisions
exist. P4 provider integration requires P2's canonical world. P5 follows
complete data and protocol work, and P6 follows the resulting
identity/behavior decisions. Candidate integration and V1–V5 precede V6.
The user's released hold covers the entire F01–F21 server backlog. See the
[implementation record](FRONTIER_3640684_IMPLEMENTATION.md) for completion
evidence, configured local policies and external/native acceptance boundaries.

The world source and exploration delivery path are settled. The highest
uncertainties are the completeness of the modified legacy data, cross-cycle
catalog/content compatibility, discovery policy, remaining protocol changes,
custom adapters, and Linux/Bottles support. Re-estimate scope after P1 and the
mapping inventory instead of treating this as a build-number update.

Original handoff: plan and README link; then the read-only galaxy report and
source-evidence JSON; then selection of `3502403-MOD4-STUFF1`. The subsequent
authorized implementation adds the exploration exporter, adapter, encoder,
gateway and knowledge runtime. See the API guide for commands and verification.
The latest feature audit adds actual-client service/notice evidence, offline
schema results and a concrete shared-envelope counterexample. Live target-client
acceptance and promotion have not been performed.
