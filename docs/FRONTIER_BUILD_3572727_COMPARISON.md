# Build 3572727 compared with the 3640684 temporary profile

Recorded: 2026-10-27. Direction throughout: **3640684 baseline → supplied
3572727 client**. This is an analysis and data-source assessment; it does not
activate a client, replace a world, or establish live gameplay acceptance.

Follow-up investigation: the [galaxy replacement design](FRONTIER_3572727_GALAXY_REPLACEMENT.md)
traces the physical snapshot conflicts and retains client 3640684. Its complete
stellar audit refines the primary-star-only reference counts below, establishes
that the 156 added landscape rows match canonical FSD geography, and includes
an exact 3640684 decoder proof and content-catalog exceptions.

The supplied client restores locally bundled galaxy data missing from 3640684,
but identifies its own branch as **`//frontier/demo-tool-v2`**, rather than
`//frontier/cycle-7`. Its geographic sources contain conflicting planetary
identities, so they do not yet establish a consistent replacement world. It is
an earlier, separate branch with different native flight code, navigation
integration, mining reconciliation and content. Its
player-facing protobuf contracts largely match the implemented 3640684
contracts. Adopting its galaxy as a source and running its client are separate
decisions.

## Inputs and comparison boundaries

Baseline client:

```text
/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier
```

Supplied client:

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle7x-Lim-3572727/EVE Frontier
```

| Identity | Baseline | Supplied target |
| --- | --- | --- |
| `start.ini` build / sync | 3640684 / 3640684 | 3572727 / 3572727 |
| Version | 20.04 | 20.04 |
| Codename | cycle-7 | demo-tool-v2 |
| Branch | `//frontier/cycle-7` | `//frontier/demo-tool-v2` |
| MachoNet version from bytecode | 489 | 489 |
| `code.ccp` bytes | 119,398,148 | 119,330,175 |
| `code.ccp` SHA-256 | `2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c` | `eee139e55d95d75e897eb944c8045fb9ee1ef1b86a8672c2f453e1fffcde9f89` |

The baseline archive hash agrees with the earlier feature and landscape
audits. Both ZIP archives pass CRC verification. All indexed installed app
files match their own indexed MD5 and size: 259 baseline and 260 target.

The [temporary 3640684 profile](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md)
combines 3640684 landscape/ecosystem/dungeon data with the selected
`3502403-MOD4-STUFF1` galaxy. Its content revision is
`28f645382d93478a51ac393297bafc0252e91e0ce96bd6614e8596a654e6e44f`,
bound to legacy world revision
`2891c2ce747671b3e43dd20f886f4b8227bd19b9e8ac33c2112892c6b699c810`.
It preserves authored site positions and omits unresolved planetary parents.
That composed world is distinct from either original client installation.

## Resource and native inventory

| Scope | Baseline count | Target count | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources in `resfileindex.txt` | 47,405 | 48,126 | 746 | 25 | 71 | 47,309 |
| App manifest entries | 259 | 260 | 1 | 0 | 147 | 112 |
| Installed files recursively under `bin64/` | 251 | 252 | 1 | 0 | 141 | 110 |

Resource changes compare indexed content MD5 and length, independently of
packed size. Installed native files were hashed directly. These counts are
file counts, not feature coverage. The permanent
[evidence JSON](FRONTIER_BUILD_3572727_COMPARISON_EVIDENCE.json) preserves the
complete resource/app/native added, removed and changed lists.

The sole added app file is `bin64/staticdata/mapObjects.db`, 34,803,712 bytes,
SHA-256 `989883f198c92df9780b0d771ef3c93764c4559b46cf7c059733a02d7c389f3a`.
Resource additions include galaxy datasets, 314 UI textures, 266 files under
`graphics/shared_texture/`, and 131 files under `dx9/model/`. Changed content
includes localization, audio, rifts, docking-point graphics and static tables;
17 removed resource paths are audio media. The inventory does not establish
that every added visual asset is enabled.

Only two of the 16 `carbon.json` library declarations change:

| Library | Baseline | Target |
| --- | --- | --- |
| `carbon_destiny` | `frontier-destiny/v3.0.2-0-g01b25da` | `frontier-destiny/new-flights-mode-time-fix` |
| `carbon_audio` | `audio/v9.1.0-0-g214099b` | `audio/v8.6.1-0-g967e011` |

`_destiny.pyd` changes from 2,131,632 to 1,948,336 bytes. `blue.pyd`,
`exefile.exe`, the Python DLL and native data loaders also have different
hashes. The target `blue.pyd` SHA-256 is
`5fc6885c0d97a6087658750730b6d3308eb6cd4270cd99ec5e4910867739efbc`,
which differs from both the original and patched 3640684 binaries. The repo
has an exact 3640684 Windows profile, but no 3572727 profile.
`frontier_windows_client.py:139` selects the profile by build and rejects a
missing or mismatched profile. Neither the 3640684 native offsets nor its
patched archive should be relabeled as 3572727.

## Galaxy and landscape changes from the temporary profile

All 114 baseline and 127 target indexed static resources exist locally and
match their indexed size and MD5. Thirteen static paths are added, 24 change,
90 are identical and none are removed. The additions include `systems`,
`regions`, `constellations`, `jumps` and faction-ownership `.static`/`.schema`
files, `solarsystemcontent.static`, `starmapcache.pickle`, and
`universe_distances.fsdbinary`.

Exact target native loaders decoded the five landscape tables in a disposable
Windows Python 3.12 process. The target's Python FSD reader, with the existing
repository blue stub and normalization helper, also decoded its geographic
tables. The completed export has no decode errors. Its checked source files,
loader hashes, output counts and output hashes are retained locally.

| Geographic records decoded from target | Count |
| --- | ---: |
| Systems / system-content records | 24,026 / 24,026 |
| Regions / constellations | 274 / 2,163 |
| Jump records / stargate objects | 5,864 / 11,728 |
| Stars / planets in system-content records | 24,026 / 42,223 |
| SQLite celestial records / NPC stations | 448,477 / 229 |

System/region/constellation membership, selected cached system fields, system
centers, jump endpoints and reciprocal gate destinations pass the recorded
checks. **Planetary identity is inconsistent across the bundled sources:**

- `systems.static`, `starmapcache.pickle` and `solarsystemcontent.static` agree
  on their checked planet membership and system fields.
- Of 42,223 system-content planet references, 38,592 existing IDs belong to a
  different system in `mapObjects.db`, and 117 are missing. Separately,
  32,015 existing IDs disagree on type. These counts overlap and must not be
  summed.
- Example: system-content system **30000018** owns planet **42000035**,
  while `mapObjects.db` assigns that ID to system **30000017**.

This is a conflict between geographic authorities, not just a stale map-cache
claim or a decode failure. Source hashes and successful decoding do not make
the two ID mappings interchangeable.

The landscape comparison is particularly useful for the existing temporary
profile:

| Decoded content | Baseline 3640684 | Target 3572727 | Actual row differences |
| --- | ---: | ---: | --- |
| Landscape systems | 23,846 | 24,002 | All shared rows equal; 156 added |
| Authored sites | 136,443 | 137,368 | All shared sites equal; 925 added |
| Belts / Trojans | 47,110 / 22,257 | 47,433 / 22,353 | 323 / 96 added |
| Ecosystems | 35 | 35 | Only ID 23 changes: Starter Creche adds tag `ruins` |
| Dungeon templates | 393 | 396 | 3 added, 8 shared rows changed, none removed |
| Authored dungeon objects | 61,960 | 62,063 | Net +103 |
| Dungeon asset manipulations | 199 | 211 | 12 added; all shared rows equal |
| Dungeon environment templates | 2 | 2 | All equal |

All five landscape-family schema fingerprints remain identical across builds.
The added dungeons are **14468, 14469, 14472**. Changed existing dungeon IDs
are **14001, 14008, 14125, 14126, 14127, 14138, 14479, 14498**. Changes affect
room content, some triggers, and dungeon 14498's entry type. An unchanged
placement row does not imply unchanged encounter content beneath its ecosystem.

All 136,443 existing sites preserve their IDs, positions and ecosystems.
More significantly, **all 98,809 tested celestial-boundary/planet-reference
occurrences in the baseline landscape resolve to the same system in the
target SQLite database**, with none missing. This includes all **76,538
unmapped belt-boundary occurrences** and **22,252 unmapped Trojan-parent
occurrences** rechecked from the temporary mapping report. Boundary occurrences
are not belt counts: one belt can contribute several references.

That establishes a concrete source for resolving the temporary profile's
planet-parent mismatch. It does not yet establish a reconciled world:

- The 156 added target landscape systems contain **252 wrong-system parent
  occurrences** against the same SQLite authority, although no tested IDs are
  absent there.
- Against the canonical `.static` star/planet owners, the baseline landscape's
  98,809 tested references yield **28,738 same-system, 42,271 wrong-system,
  27,800 absent** occurrences. Target landscape yields **29,333 same-system,
  42,271 wrong-system, 27,886 absent** out of 99,490 tested occurrences. This
  particular comparison covers canonical planets and primary stars, rather
  than every possible scene object.

Consequently, combining static planet geometry with SQLite-aligned landscape
parents solely by numeric ID would place content against incompatible parents.
Preserve authored positions and record explicit mappings or unresolved links;
do not move content to a guessed nearest planet.

Other catalogs need separate reconciliation. `types.fsdbinary` root count
changes **32,925 → 32,905**; atoms **376 → 375**; Creation templates **5 → 8**;
objective task types **57 → 54** and objective types **67 → 64**. Objective-chain
and objective-type schema fingerprints also change, so their old decoders cannot
be assumed compatible. Type dogma, dogma attributes
and effects, Creation templates, space components, type lists, objective data
and blueprint content hashes differ. Blueprint count remains 299. Recipe,
recipe-input/output/transform, trait and property resources are identical by
verified content hash. These inventory/header findings do not establish the
meaning of every changed balance field or removed type; complete catalog
field-level semantics and native gameplay remain outside this report's proof.

## Python inventory and interpretation

| Measure | Baseline | Target / difference |
| --- | ---: | ---: |
| ZIP entries | 11,684 | 11,665 |
| Unique member names | 11,679 | 11,660 |
| Shared unique names | — | 11,637 |
| Added / removed unique names | — | 23 / 42 |
| Shared names with structural code/constant changes | — | 277 |
| Shared names differing only in excluded compilation metadata | — | 11,360 |
| Unique `frontier/` member names | 1,628 | 1,616 |
| Added / removed / structurally changed `frontier/` names | — | 14 / 26 / 144 |
| Bytecode parse failures | — | 0 |

All shared members differ as raw bytes. The structural comparison uses
matching Python 3.12, preserving instructions, constants, names, argument
layout, flags and exception tables while excluding source filename and line
metadata. The 277 count describes structural differences, not 277 changed
features. Disassembly references below are embedded bytecode source lines.

Each archive contains five duplicated names: `const.pyc`,
`more_itertools/__init__.pyc`, `more_itertools/more.pyc`,
`more_itertools/recipes.pyc`, and `eveLocalization/__init__.pyc`.
Unique-name totals use `ZipFile.read(name)` resolution, which selects the last
entry. The duplicated entries differ within each archive. All ten corresponding
occurrence pairs were also compared separately and have identical normalized
code across builds; duplicate resolution hides no additional code change here.
Their fingerprints are retained in the evidence.

Direct constant assignments in `frontier/beta.pyc` have no differences.
Module or asset additions therefore do not establish a new default feature
profile. Demo-tool scenario/arena/gamepad-focus/kill-counter modules and a
`frontier/prototypes/race_track/` family are added. Newer Python RCS,
navigation-latency/driver/layout/motion helpers, saved-shortcut and wheel
helpers are absent from the target. These are branch differences; native
behavior and feature activation need separate verification.

## Verified client workflow differences

| Workflow | Baseline → target evidence | Implication |
| --- | --- | --- |
| Flight input | Target `frontier/navigation/const.pyc:8` replaces speed ramp `0.5` / wheel step `0.02` with speed-fraction step `0.25`; `navigation/client/beta.pyc:49` defaults to `InputScheme.A` instead of choosing by user-ID parity. | Check target bindings and speed response with its different native flight engine. |
| Flight RPCs | Leaf handlers for `CmdSetPitchRate`, `CmdSetRollRate`, `CmdSetBrakeFraction`, `CmdSetHeading` remain equal (`navigation/client/integration.pyc:623/678/690/702`). | Retain the implemented rate/brake/heading contracts; removed Python RCS modules do not imply removal of these commands. |
| Active scanning | Target scanner state uses Ctrl+mouse wheel (`hud/scanner/state.pyc:359`); overlay says `CTRL-SCROLL`. Explicit `MODULE_BUSY` / `MODULE_OFFLINE` failure cases are absent. | Check control hints and server-rejection presentation. This is not evidence that scanning itself is removed. |
| Voxel mining | Recipe/mined-set fetches and `OnCompositeVoxelMined` remain equal. Target removes `OnCompositeMinedSetChanged` and explicit collision-grid replay from `_reconcile_mined_set` (`spacecomponents/client/components/compositeasteroid.pyc:1145`). Visual per-cell bit replay remains. | Exercise reconnect/bulk resync and native collision holes separately from visual depletion. |
| Tractor pickup | New `hud/bracket/ui/scoopable_bracket.pyc` changes range/depth/animation presentation. `BeginScoop`, `CancelScoop` and `CRRegolith.oreUnits` retain equal client code. | No new pickup server API is established by the added bracket module. |
| Exploration | Messenger, generated `UniverseDelta` and schema metadata remain equal, **schema version 14**. Target `ResolvedSystemSvc.ensure_system_hydrated:784` lacks the baseline known/current-system guard and refusal cache; the location guard and moon-specific orbit wrapper are also absent. | Expect broader/repeated detail requests. Keep visibility checks authoritative on the server and test refused/unknown locations. Bundled geography does not remove the exploration API. |
| Docking/refueling | Core capabilities/manual-dock/restore methods (`docking_point_svc.pyc:247/425/1029`) and fuel action (`refuel_pane.pyc:90`) remain equal; guide/button layout changes. | Reuse validated service contracts after explicit target-profile selection; test target controls/UI. |
| Weapon selection/convergence | Target skillshot selection defaults to the first fitted single-shot module (`frontier/skillshot/client/controller.pyc:225`), rather than all; auto-fire uses one boolean instead of per-module IDs. Convergence adds `MIN_ACCEPT_RANGE_METERS = 300.0`. | Check multiple-weapon selection, auto-fire and close-range hit reporting. This constant alone does not prove a server minimum firing range. |
| Status/session and loot | Target status service lacks the newer session-change/reset handlers. `CRLootContainer` lacks `spawnCapacity`, `spawnDescription`, `spawnGraphicID`, `spawnHitpoints`. | Check reconnect status and custom CRData/container adapters; Python property presence does not establish the native wire layout. |
| Demo tooling | `demotool/client/commands.pyc:69/93/99` uses privileged `demoToolStepRunner.begin_scenario/run_scenario_step`; race-track modules are added. | These are actual branch-specific dependencies, whose packaging does not establish ordinary player activation. |

Abbreviated Python paths in the table are relative to `frontier/`. The
source-member names and line references are recorded alongside selected
disassembly and exact leaf-code equality checks in the local evidence.

## Gateway and generated protocol contracts

All 182 `eve_public` descriptors extract successfully from each archive.
They contain the same 600 message identities, 33 nested-inclusive enums,
six services and 106 message names ending in `Request`.

**181 complete descriptors are identical.** The sole difference is optional
`bool eve_public.internal_gateway.Response.drain = 4`, present in 3640684
and absent in 3572727. Field count changes from 1,215 to 1,214. Removing that
one field from the baseline makes the complete descriptor sets equal,
including field types/numbers, oneofs, options, dependencies and services.
The fresh baseline export matches the earlier audit export byte for byte.

Thus exploration, economy/progression, assembly, storage and the public
request/response/notice envelope have no newly identified schema migration.
User-target notices still require `sint32` zigzag encoding; matching schemas
do not make a build-gated server adapter run automatically. See the server
profile implications below. Descriptor equality does not establish live
transport, authentication, visibility or gameplay semantics.

The bundled **internal `eve.*`** protocols have additional differences:
700 → 694 descriptor files, 688 identical, six changed and six baseline-only;
all extract successfully. Seventeen baseline message names are absent, with
no target-only message names.

| Internal family | Baseline → target |
| --- | --- |
| Composite asteroid model/events | Two descriptor files absent, including Identifier/Ore and Created/Dissolved/Materialized/Mined/MinedOut types |
| Progression category/crown/memory-events/skill | Four descriptor files absent |
| Memory model | `Amount`, `SkillDepth`, `Depth` absent; Identifier/Attributes retained |
| Character/crown/shell events | Newer shell/crown/depth fields and Woven/DepthLost messages absent; some old pathway-total fields no longer deprecated |
| Prepared sponsored transactions | `CreateRequest.require_execute_token` #4, `CreateResponse.execute_token` #2 and `ExecuteRequest.execute_token` #3 absent |
| Internal gateway | `eve.gateway.Response.drain` #4 absent |

These are generated internal types, not proof that player mining, crowns or
skills are unavailable. Ordinary gameplay calls and consumers must be checked
independently. Full field-level differences are retained in the evidence.

## Current server profile implications

**Changing `clientBuild` to 3572727 alone would bypass implemented 3640684
behavior.** The focused source inspection found these concrete build guards:

| Existing guard | Effect at build 3572727 |
| --- | --- |
| `_secondary/express/gatewayServices/frontierContractProfile.ts:4` | Skips the shared target schema replacement. The base gateway still defines notice user #3 as `int64`, while both clients require `sint32`. User 42 would again encode as `18 2a` and decode as 21; correct bytes are `18 54`. |
| `_secondary/express/publicGatewayLocal.ts:1283/2234/2394` | Skips target-specific trusted notice routing/error behavior and wallet-report event handling. |
| `_secondary/express/gatewayServices/frontierEconomyGatewayService.ts:21` | Economy handler predicate is false despite matching target public schemas. |
| `services/mining/voxelMiningRuntime.ts:371`, `miningRuntimeState.ts:1058` | Disables the implemented voxel authority and scene projection. |
| `services/frontier/temporaryLandscapeProfile.ts:163`, `explorationReferenceData.ts:63`, `explorationDiscovery.ts:7` | Skips the temporary overlay, selected exploration reference tables and scan-discovery persistence bridge. |
| `services/frontier/dockingPointRuntime.ts:307` | Disables docking-point capabilities and rejects gated docking/refuel mutations. |
| `services/frontier/progressionDogma.ts:26`, `services/inventory/itemTypeRegistry.ts:150` | Skips progression effects and target catalog overlays. |
| `space/transitions.ts:3745`, `services/frontier/iffMapService.ts:92` | Bypasses target gate-energy reservation and publication-aware structure aggregation. |

Paths above are under `server/src/`, except abbreviated subsequent names in
the same row. These findings describe the current working-tree source, not a
live run. The evidence records 20 focused guards with excerpts and source hashes.
They identify work for an explicit target compatibility profile; they are not
instructions to broaden every numeric build check indiscriminately.

Runtime target identity and raw data provenance must remain distinct.
`explorationWorld.ts:130` validates the 3640684 target and selected legacy-world
identity. `temporaryLandscapeProfile.ts:70` validates original source build and
exact landscape hashes. The native staging profile also requires an exact
build match. Relabeling the existing temporary artifacts would falsify their
provenance and fail the current validators.

## Recommended next work

1. Reconcile the `.static` and SQLite celestial identities before producing a
   replacement galaxy. Record the chosen authority and crosswalk, including
   all added landscape systems with conflicting parents. The supplied folder
   name and presence of geography files are not sufficient completeness proof.
2. If retaining the 3640684 runtime, build a new, explicitly composed world
   artifact from validated 3572727 sources and the intended landscape catalog.
   Preserve raw source-build identities and create a new content/world revision;
   retain the current temporary profile for rollback. No such world artifact
   or state migration was created during this analysis.
3. If running the 3572727 client, establish its exact native/archive staging
   profile and explicitly select compatible server behavior. Matching public
   schemas support reuse after review, while current numeric build guards
   require adaptation. Retain source-build provenance independently of runtime
   selection.
4. Test the changed flight/input, multi-weapon selection, exploration refusal,
   voxel resync/collision, docking UI and session-status paths with that exact
   staged client. Check persistent world/type/location references on disposable
   copies before choosing any migration or changing defaults.

## Evidence and reproduction

The [comparison evidence](FRONTIER_BUILD_3572727_COMPARISON_EVIDENCE.json)
contains input hashes, manifest deltas, bytecode inventories, exact public and
internal protocol differences, static checks and selected behavior findings.
Large disassemblies, fresh descriptor exports and analysis scripts are local
outputs under `_local/build-comparison-3640684-to-3572727/`.

Reproduce the resource/native comparison from the repository root:

```sh
python3 tools/frontier-static/compare-client-manifests.py \
  --baseline '/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier' \
  --target '/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle7x-Lim-3572727/EVE Frontier' \
  --out _local/build-comparison-3640684-to-3572727/manifest-comparison.json
```

The local `contracts/` directory contains `request-BUILD.json` for the existing
`tools/frontier-contracts/dump_frontier_contracts.py` exporter, followed by
`compare_contracts.py` and `compare_internal_contracts.py`. The bytecode runner
uses the preserved Windows Python 3.12 runtime in a disposable Wine prefix;
client roots and interpreter are mounted read-only. Public/internal descriptor
constant extraction uses the system interpreter without executing client code.

Verification is offline. No game/server session or chain transaction was
started, no client source was modified, and no runtime database or launch
default was changed. Native rendering, flight prediction, live mining
collision/pickup and exact target-client acceptance remain untested.
