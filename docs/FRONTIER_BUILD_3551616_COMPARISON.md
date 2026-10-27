# Build 3551616 compared with build 3640684

Recorded: 2026-10-27. Direction throughout: **3640684 baseline → supplied
3551616 target**. This is an offline client and data comparison; it does not
select a new runtime or migrate the server world.

The supplied client identifies itself as **`//frontier/2026-px-events`**.
It is an earlier, separate branch from 3640684's `//frontier/cycle-7`.
It includes substantially more indexed assets and local geography, preserves
the landscape placement file exactly, and differs in flight input, docking
presentation, progression, mining reconciliation and content catalogs.
Its bundled geographic sources disagree about celestial identities. The
matching public gameplay request schemas support potential reuse of existing
adapters, but the repository's exact build guards prevent a configuration-only
switch from preserving current 3640684 behavior.

## Inputs and identity

Baseline:

```text
/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier
```

Supplied target:

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle7x-Umb-3551616/EVE Frontier
```

| Identity | Baseline | Target |
| --- | --- | --- |
| Compared profile | `stillness` | `stillness` |
| `start.ini` build / sync | 3640684 / 3640684 | 3551616 / 3551616 |
| Version | 20.04 | 20.04 |
| Codename | cycle-7 | 2026-px-events |
| Branch | `//frontier/cycle-7` | `//frontier/2026-px-events` |
| MachoNet / Universe schema | 489 / 14 | 489 / 14 |
| `code.ccp` bytes | 119,398,148 | 118,673,614 |
| `code.ccp` SHA-256 | `2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c` | `77538f08bfa798fc87846606570dc09fd22d14a9781af3c6106758c78b4c1426` |

The supplied root also contains **Utopia build 3366068**, version 20.04,
branch `//frontier/v2026.05`. Its separate app index contains 244 entries,
all matching installed size and MD5, and its resource index has 47,709
logical entries. That secondary profile is inventoried separately and is
excluded from the 3551616 semantic comparisons below. Shared `ResFiles/`
contents are therefore not, by themselves, an inventory of build 3551616;
the selected profile's indexes determine membership.

## Resource and native changes

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical `resfileindex.txt` resources | 47,405 | 53,128 | 5,745 | 22 | 92 | 47,291 |
| Indexed app files | 259 | 260 | 1 | 0 | 150 | 109 |
| Installed files under `bin64/` | 251 | 252 | 1 | 0 | 143 | 108 |

Resource equality uses indexed MD5 and uncompressed length. All 5,837
target added/changed resource payloads were checked directly: **5,837 match,
zero missing or mismatched**, totaling 7,016,133,237 uncompressed bytes.
This byte total describes the selected payloads, not a download or patch size.
All indexed app files also match their installed MD5 and length in each build.
Every installed `bin64/` file was SHA-256 hashed. Both code archives pass ZIP
CRC checks. The permanent [evidence](FRONTIER_BUILD_3551616_COMPARISON_EVIDENCE.json)
preserves the complete logical added/removed/changed inventories.

Added resources include 3,329 files under `dx9/model/`, 753 under
`graphics/generic/`, 266 under `graphics/shared_texture/`, 312 UI textures,
and many character/portrait animations. Within the model additions are 926
kitbash resources, 534 asteroid resources, 707 space-object hull definitions
and 169 ship resources. These counts describe packaging; they do not
establish new playable ships or activated features.

Changes include rift/cloud effects, docking-point graphics, tractor effects,
localization and static catalogs. Removed logical paths include three audio
media, 11 Vestiges character/clone assets, `docking_point_fx.black`, a test
rift asset and two UI textures. Full paths are in the evidence.

The sole added app/native file is `bin64/staticdata/mapObjects.db`:
34,799,616 bytes, SHA-256
`2de18e32ed869b9cd04645f5b2ab68819e6a72145ac44b1c17af1bd9c7c464a9`.

Three of 16 `carbon.json` library declarations change:

| Library | Baseline | Target |
| --- | --- | --- |
| `carbon_destiny` | `frontier-destiny/v3.0.2-0-g01b25da` | `frontier-destiny/new-flights-mode-time-fix` |
| `carbon_audio` | `audio/v9.1.0-0-g214099b` | `audio/v8.6.1-0-g967e011` |
| `carbon_trinity` | `trinity/v6.0.1-0-g5f6c64bd` | `trinity/v6.0.0-0-gae5680b3` |

`_destiny.pyd` changes from 2,131,632 to 1,948,336 bytes and all its PE
sections differ. However, **36 of the 143 hash-changed native files have
identical raw PE sections**, including `blue.pyd`, `exefile.exe` and
`python312.dll`; their differences lie outside those sections. The remaining
107 have section differences. Whole-file hashes must not be interpreted as
143 independently changed native features. Section equality also does not
establish complete binary or runtime equivalence or validate signature trust.

The target `blue.pyd` SHA-256 is
`b68c027f48143a8feb3371108298ce45b474961b5d7b40b1c3bb88e92588d359`.
The repository has no `blue-pyd.3551616.patch.json` profile.
`tools/frontier-client/frontier_windows_client.py:139` requires an exact
build profile, while the existing 3640684 profile also requires its exact
source SHA-256. Identical PE sections do not satisfy those existing checks;
a target profile would require separate verification.

## Landscape and encounter content

All **114 baseline and 141 target static payloads** exist and match indexed
MD5 and length: 27 paths added, 24 changed, 90 identical, none removed.
Exact matching native loaders decoded the landscape family and 16 shared
catalogs. Their hashes, decode manifests and row-level changes are retained.

`landscape.fsdbinary` is byte-identical, with all decoded rows equal:
**23,846 systems, 47,110 belts, 22,257 Trojans and 136,443 authored sites**.
Every site preserves its ID, position and ecosystem. The five landscape-family
schema fingerprints remain equal, but encounter content changes beneath those
unchanged placements:

| Table | Baseline | Target | Actual differences |
| --- | ---: | ---: | --- |
| Ecosystems | 35 | 35 | IDs 23, 43, 44, 45 change |
| Dungeon templates | 393 | 393 | 10 changed; none added/removed |
| Authored dungeon objects | 61,960 | 62,018 | Net +58 |
| Dungeon asset manipulations | 199 | 198 | ID 1466893 removed; shared rows equal |
| Dungeon environment templates | 2 | 2 | Equal |

Starter Creche ecosystem 23 adds tag `ruins`. Graven Works (43) reduces
broken-pattern minimum/maximum 3 → 2, reduces dungeon 14477 occurrences
2 → 1 and adds dungeon 14492 to that pattern list. Longwatch Redoubt (44)
reduces broken-pattern minimum/maximum 4 → 2. Dustline Waystation (45)
changes broken minimum/maximum 2 → 1 and natural minimum/maximum 1 → 0.
These are authored parameters, not measured live spawn counts.

Changed dungeon IDs are **14001, 14008, 14125, 14126, 14127, 14479, 14498,
14508, 14509, 14530**. Examples: starter dungeon 14125 has 400 → 451 objects
and one → zero top-level triggers; dungeon 14479 has 68 → 77 objects;
14509 has 38 → 36. Dungeon 14498 changes entry type **91302 → 83889**.
Other changes affect room objects and their fields.

## Geographic sources and identity conflicts

The target restores locally bundled `.static` geography and starmap resources
absent from the 3640684 index. It also bundles additional legacy `.fsdbinary`
geography. These sources must be assessed independently.

| Decoded target `.static` / cache content | Count |
| --- | ---: |
| Systems / system-content records | 24,026 / 24,026 |
| Regions / constellations | 274 / 2,163 |
| Jump records / stargate objects | 3,536 / 7,072 |
| Stars / planet references | 24,026 / 83,130 |
| SQLite celestial records / NPC stations | 448,477 / 229 |

The 83,130 planet references are 83,130 unique IDs, with no duplicate or
multiple-system planet IDs. Stars have 24,026 unique IDs and no planet-ID
overlap. Checked system/region/constellation membership, system centers,
selected starmap fields, system/content planet lists, jump endpoints and
reciprocal gate destinations agree within the `.static`/cache family.

**Planet identities conflict with `mapObjects.db`.** Of the 83,130
system-content planet IDs, **68,864 are missing** from SQLite,
**14,250 exist in another system**, and only **16 match the system**.
Separately, 11,115 existing IDs disagree on type; this overlaps the ownership
counts. Example: system-content system **30000006** owns planet **42000004**,
while SQLite assigns that planet ID to **30000005**. SQLite contains 51,047
planet rows. These are verified source conflicts, not a missing-payload claim.

The unchanged landscape aligns with SQLite: **all 98,809 checked direct
celestial-boundary/planet-reference occurrences resolve in the same system**.
This includes all 76,538 belt-boundary and 22,252 Trojan-parent occurrences
listed as unresolved in the earlier temporary 3640684 profile assessment.
Against only target `.static` planets plus primary stars, the same references
yield **19 same-system, 23,907 wrong-system and 74,883 absent** occurrences.
These are reference occurrences, not unique parents or belt counts; the
second check excludes other stellar/scene object kinds.

This makes the SQLite snapshot a concrete source for investigating the
temporary profile's missing parents. It does not establish a consistent
replacement galaxy: combining static planet geometry and SQLite-aligned
landscape references by numeric ID would use incompatible identities.
Preserve authored positions and record an explicit authority/crosswalk before
producing a replacement world. The current composed runtime world is a
separate artifact from these raw client sources.

The legacy `.fsdbinary` optimized root headers report **24,426 solar systems,
284 regions, 2,213 constellations, 83,257 planets, 147,060 moons, 98 NPC
stations, 6,876 stargates and 824 collision rows**. Their matching native
loaders are absent, so these are verified header counts; their fields and
relationships were not decoded. This is a third, distinct inventory whose
identity compatibility remains unverified.
Added generated-blueprint class/property/set tables likewise have 31/20/19
root rows without matching installed loaders.

The complete `.static` system-content decode found three positive-infinity
source values: `star.statistics.mass` in systems **30000001–30000003**.
They are preserved as explicit `{"$float":"inf"}` tags in JSON, with no
nonfinite geometry positions found. All 24,026 rows decode successfully with
that explicit representation; the masses require treatment before exporting
a finite runtime catalog.

## Field-level catalog changes

Sixteen shared catalogs were decoded independently with each build's exact
native loader. The evidence includes every removed/added row and changed field,
plus named/keyed dogma and recipe comparisons.

| Catalog | Baseline | Target | Shared rows changed |
| --- | ---: | ---: | ---: |
| Types | 32,925 | 32,894 | 2 |
| Dogma attributes | 2,799 | 2,792 | 15 |
| Dogma effects | 3,049 | 3,049 | 1 |
| Type dogma | 15,185 | 15,185 | 32 |
| Space components by type | 9,180 | 9,179 | 9 |
| Industry blueprints | 299 | 298 | 18 |
| Industry facilities | 16 | 16 | 5 |
| Objective task types | 57 | 53 | 2 |
| Objective types | 67 | 63 | 15 |
| Type lists | 433 | 433 | 6 |

The 31 removed types are unpublished baseline records: **97705
`Char_OmoVestiges`** and **98024–98053**, the 30 Stack Slice variants. There
are no target-only types. Heat Trap **95812** changes icon **27828 → 16**;
Debris **99014** changes graphic **28264 → 28096**. Graphic 35789 and icon
27828 are absent from their respective catalogs.

Dogma changes include removal of directional scanner rotation-speed attribute
**6468**, NPC tracking limits **6472/6473**, and turret fire-ramp parameters
**6489–6492**. EM signature attribute **6094** becomes stackable, passive scan
attributes **6139/6168/6171/6173** become unpublished, and some `highIsGood`
metadata changes. EM Scrambler **95763** signature reduction changes
**−50 → −60**; effect **12972** changes `isWarpSafe` **1 → 0**.

Type dogma removes the corresponding scanner/tracking/turret fields. Watcher,
Grave and Fell Watcher **83566/92503/92504** change kinetic, thermal and
explosive resonance **0.05 → 0.01**. Mycena **94167/95504** effective range
changes **150,000 → 300,000**; Collier **97209** and Shifter **97261** change
**150,000 → 99,975**. These are packaged client values, not measured server AI.

Wreckage **95349/95762** salvage output changes Debris **99014 → 88764
(Salvaged Materials)**; **95350/97353** switch to Cargo Debris **99003**;
**95359/95361** switch to **99013/99012** respectively. Debris 99014 loses its
space-component row. Eight dock/refuge types lose `proximityInteraction`.
Network Node **88092** increases Printed Circuits, Carbon Weave and Thermal
Composites construction quantities **8 → 10** each.

Representative industry changes:

| Blueprint / operation | Baseline → target |
| --- | --- |
| **1181**, D1 Fuel | Water Ice input **208 → 275** |
| **1627**, Hydrocarbon Residue → D1 Fuel | Removed: 21 residue → 75 fuel, runtime 14 |
| **1003**, Carbon Weave | Residue input **17 → 25** |
| **1020**, Carbon Weave | Tholin input **2,100 → 2,800** |
| **1500**, Cinderwrack | Runtime **10 → 35**; Silicon Dust output **5 → 2**, Nickel-Iron **2 → 1** |
| **1499**, Debris | Input **10 → 5**; Salvaged Materials output **6 → 3**, Aromatic Carbon Weave **2 → 1**; Nickel-Iron/Silicon outputs absent |
| **1561**, Emergency Container | 4 Debris replaced by 4 Cargo Debris |
| **1622/1623**, Printer/Refinery | Construction inputs change; complete quantities in evidence |

Five facility rows change blueprint availability. Field Printer **87162** adds
**1497/1498/1523**. Refinery **88063**, Material Processor **95486** and
Refinery **97518** add those IDs and remove **1627**; the latter two also add
**1186**. Heavy Refinery **88064** removes **1627**. Shared listed blueprint
run limits remain equal.

Objective task types **104–107** (Status Effect, Status Effect Antidote,
Items Mined, Control Hint) are absent. Objective types **176, 180, 182, 183**
(Low on fuel (creche), Understand status effects, Cut Debris, Refine Debris)
are absent; 15 shared objectives and chain **106** change. Objective-chain/type
schema fingerprints differ and were decoded with their own build's loader.
Atom **731**, Ship Within Range Of Dungeon Object, is absent; node graph
**937** changes. New-features catalog count **0 → 11** reflects dated
announcement records and does not establish current feature activation.

Recipe/recipe-input/output/transform, trait/property and Creation-template
payloads remain identical by verified content hash. These recipe-family tables
are distinct from the changed `industry_blueprints` catalog above.

## Python inventory and interpretation

| Measure | Baseline | Target / difference |
| --- | ---: | ---: |
| ZIP entries | 11,684 | 11,602 |
| Unique member names | 11,679 | 11,597 |
| Shared unique names | — | 11,594 |
| Added / removed unique names | — | 3 / 85 |
| Shared members with structural code/constant changes | — | 351 |
| Shared members differing only in excluded compilation metadata | — | 11,243 |
| Unique `frontier/` names | 1,628 | 1,586 |
| Added / removed / structurally changed `frontier/` names | — | 2 / 44 / 196 |
| Bytecode parse failures | — | 0 |

All shared members differ as raw bytes. The structural comparison uses
CPython 3.12, preserves instructions, constants, names, argument layout,
flags and exception tables, and excludes source filenames and line metadata.
The counts describe code structure, not a count of changed gameplay features.

Both archives have five duplicated names: `const.pyc`,
`eveLocalization/__init__.pyc`, `more_itertools/__init__.pyc`,
`more_itertools/more.pyc`, and `more_itertools/recipes.pyc`. Unique-name
comparisons use the last ZIP entry for each name. All ten corresponding
occurrence pairs were also structurally compared and are equal across builds;
duplicate resolution hides no additional structural change here.

The three target-only members are `eveclientqatools/obstruction_cost.pyc`,
`frontier/character_creation/demo.pyc`, and
`frontier/docking_point/client/status_panel.pyc`. Removed families include
Python RCS/flight-latency helpers, newer command/wheel helpers, FPS reporting,
some weave ceremony/UI modules and generated internal protocol types.
`frontier/beta.pyc` has identical normalized code and direct assignments.
That does not imply equal defaults inside every subsystem; the navigation
subsystem has a different fallback input scheme.

## Verified workflow differences

Source lines below are embedded bytecode source lines. Paths are relative to
`frontier/` except explicitly qualified members. Saved settings and runtime
flags can override compiled defaults.

| Workflow | Baseline → target evidence | Implication |
| --- | --- | --- |
| Flight defaults | `navigation/client/beta.pyc:49` defaults to **AIM_FLIGHT** instead of choosing A/AIM_FLIGHT by user-ID parity. `navigation/const.pyc:8` uses **0.25 speed steps** instead of ramp 0.5 / wheel 0.02. Integration retains `CmdSetSpeedFraction` but lacks the explicit request throttler (`:601`). | Input defaults and request frequency differ alongside the different native Destiny build. |
| Flight RPCs | Pitch, roll, brake and heading leaf handlers in `navigation/client/integration.pyc:623/678/690/702` are structurally equal. | Retain those exact command contracts; equality does not establish native prediction compatibility. |
| Active scanning | `hud/scanner/state.pyc:344` uses Ctrl+mouse wheel for angle adjustment; newer keyboard-angle helpers are absent. Scanning adapter `signatures_and_scanning/client/scanning_service.pyc:150` retains scan calls but lacks explicit MODULE_OFFLINE/MODULE_BUSY conversions. | Controls and rejection presentation differ; scanning remains packaged. |
| Dock selection | `docking_point/client/docking_point_svc.pyc:395/440/472` scans nearby ports every 2 seconds, shows approach readout within 200m, and can auto-select within 80m while preserving non-port selections. New `status_panel.pyc` renders the readout. | These are client UI thresholds; they do not prove server docking ranges. |
| Dock timing / restore | Target `_undock_from_frame:881` calls undock directly; baseline can defer until dock commit using `_undock_at_commit`. Restore (`:1138`) keeps the server query but changes status presentation. Capability/manual-dock/refuel leaf methods remain equal. | Check cancel/commit timing and reconnect presentation separately. |
| Voxel mining | Target `_reconcile_mined_set:1132` in `spacecomponents/client/components/compositeasteroid.pyc` keeps visual bit replay but lacks native grid replay and `OnCompositeMinedSetChanged`. Per-voxel notice and mined-set fetch leaves remain equal. `_fetch_recipe:53` caches returned `None`, unlike baseline. | Incremental mining is present; missing-recipe retry, bulk resync and native collision replay differ. |
| Regolith | `spacecomponents/common/regolith_collapse.pyc:26` uses modulo family mapping without newer already-legacy/REEF/Metallic exceptions. Scoop begin/cancel and the entire CRRegolith module remain structurally equal. | Review type mapping independently of the preserved pickup RPCs. |
| Weapons | `skillshot/client/controller.pyc:222/237` falls back to the first fitted single-shot module (`[:1]`); baseline can collect all. Target uses one auto-fire boolean instead of per-module IDs. `aimed_action/client/convergence.pyc:20` sets `MIN_ACCEPT_RANGE_METERS=300.0`. | Focus, multi-weapon toggling and close-range reporting differ; this does not establish a server firing minimum. |
| Exploration | `ResolvedSystemSvc.ensure_system_hydrated:784` lacks the known/current-system guard and refusal cache; related location/moon wrappers are absent. Messenger, UniverseDelta and schema metadata remain equal, schema **14**. | Expect different refusal/retry behavior; the exploration API remains required. |
| Progression | Weave container `character/client/weave/container.pyc:170/179` uses direct panel transfers and lacks newer drag/hover/ceremony behavior. `split_for_weaving:113` lacks `prepick`. | Crown UI/adapters differ; this does not establish removal of server progression. |
| Status | `status_effect/client/service.pyc` lacks newer session-reset/session-change handlers. | Reconnect and character-switch refresh need acceptance checks. |
| Gateway configuration | `publicGateway/grpc/connectionConfig.pyc:19` parses textual secure-env settings using stripped lowercase enabled synonyms; baseline uses `bool(string)`. It honors `frontierPublicGatewayIsSecure`, defaults true, and compiles `.pub.evefrontier.com` host suffix. | Textual false/0 and archived fallback endpoint selection differ. Endpoint liveness was not queried. |

MachoNet remains **489** with its whole version module equal. Main
`frontier/beta.pyc` remains equal, while subsystem flags differ: compass adds
`multi_star_enabled` default true and HUD lacks `threat_corner_brackets`.
Scoop progress changes helper signature/return shape, but its new range helper
is not called by that progress body; this does not establish distance-driven
server pickup or a changed BeginScoop/CancelScoop protocol.

## Gateway and generated protocol contracts

| Scope | Baseline | Target | Identical files | Changed | Baseline-only |
| --- | ---: | ---: | ---: | ---: | ---: |
| Public `eve_public` descriptors | 182 | 180 | 178 | 2 | 2 |
| Internal `eve` descriptors | 700 | 687 | 679 | 8 | 13 |

All descriptors extract without failures. Fresh public descriptor extraction
agrees with an independent constant-only extraction, and the fresh 3640684
descriptor-set bytes match the prior audit. No client bytecode is executed
for descriptor extraction.

All **106 public messages named `*Request`**, all six public services and
their nine methods are exactly equal. Public fields decrease 1,215 → 1,195;
messages decrease 600 → 594; all 33 enums remain equal. The exact public
changes are:

- Heartbeat and FPS telemetry descriptor files are absent.
- Flight analytics includes target-only `Thrusted`; baseline `Braked`,
  `AimflightEngaged`, and `AimflightDisengaged` are absent. These are distinct
  event names, so consumers using their type URLs must distinguish them.
- `eve_public.internal_gateway.Response` lacks optional `bool drain = 4`.
  The remaining fields and service methods are equal.

The ordinary `public.proto` and `gateway.proto` envelopes are identical.
`Notice.TargetGroup.user` remains **sint32 field 3**. Matching schemas support
adapter reuse after deliberate profile selection; they do not establish
working authentication, visibility, feature activation or gameplay.

Internal descriptor changes cover composite asteroid models/events, docking
point models/events, game-access entitlements, NPC harvest events and typed
progression/memory definitions. Their absence does not prove that the
corresponding player workflows are absent. Concrete changed internal payloads
include `ItemsScooped`: baseline reserves field 4 and uses `scooped_items = 5`
with an item-and-attributes wrapper; target uses `items = 4` containing generic
item identifiers. Prepared sponsored transactions lack the newer execute-token
fields. Progression events lack newer shell/crown/depth fields, and internal
`eve.gateway.Response.drain` is absent. Full descriptor/field-number changes
are retained in the evidence.

## Current server compatibility implications

Changing `clientBuild` to 3551616 alone does not select the implemented
3640684 behavior. Fresh inspection confirms that
`server/src/_secondary/express/gatewayServices/frontierContractProfile.ts:5`
returns early for this target. The base public gateway declares notice user
field 3 as `int64` at `publicGatewayLocal.ts:166`, while both clients require
`sint32`. Encoding user 42 with the base root yields **`18 2a`**, which the
target decodes as **21**; the correct bytes are **`18 54`**.

Other verified gateway guards include economy dispatch
(`frontierEconomyGatewayService.ts:23,34`), trusted notice routing and request
identity (`publicGatewayLocal.ts:1283,1308,1792,2165,2171`), failed-request
empty-success recovery (`:2236`) and Events.Publish's early empty ACK (`:2397`).
The latter skips wallet-report event decoding, authentication and routing for
a non-3640684 configured build. These are findings in current working-tree
source, with source hashes/excerpts retained in the evidence.

Native/archive staging, runtime build selection and raw data provenance need
separate treatment. A new compatibility profile can reuse verified equal
contracts while keeping extracted data's original source identity. Catalog,
world and durable-state revisions must describe the actual selected sources;
relabeling the existing 3640684 data would not establish a 3551616 export.

## Evidence, reproduction and limits

The permanent [comparison evidence](FRONTIER_BUILD_3551616_COMPARISON_EVIDENCE.json)
contains input identities/hashes, complete manifest deltas, normalized Python
inventories, descriptor differences, selected workflow evidence, static/catalog
comparisons and verification receipts. Full decoded tables, disassemblies,
descriptor exports and analysis scripts are local under
`_local/build-comparison-3640684-to-3551616/`.

Reproduce the manifest/native comparison from the repository root:

```sh
python3 tools/frontier-static/compare-client-manifests.py \
  --baseline '/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier' \
  --target '/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle7x-Umb-3551616/EVE Frontier' \
  --out _local/build-comparison-3640684-to-3551616/manifest-comparison.json
python3 _local/build-comparison-3640684-to-3551616/verify_inventory.py
python3 _local/build-comparison-3640684-to-3551616/compare_pe_sections.py
```

The local contracts directory contains exact `request-BUILD.json` inputs for
`tools/frontier-contracts/dump_frontier_contracts.py`, `compare.py` and
`check_gateway.py`. Local bytecode and native static runners use preserved
Windows CPython 3.12 in disposable Wine prefixes; client roots and interpreter
are mounted read-only. Native data loaders decode data, while Python workflow
comparisons inspect code objects without running client logic.

No client or server session was started, no chain transaction was submitted,
and no client files, launch defaults, configuration, or runtime databases were
changed by this analysis. Native rendering, prediction, mining collision,
pickup, docking and end-to-end target acceptance remain untested.
