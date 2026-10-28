# Stillness build 3122254: changes from 3640684

Recorded: 2026-10-27. Direction: **3640684 baseline → 3122254 target**.

The completed extraction verifies **build/sync 3122254**, version 20.04,
codename `MAINLINE-STREAMS-VS`, branch
`//eve-frontier/branches/sandbox/MAINLINE-STREAMS-VS`. This replaces the earlier
incomplete-candidate assessment. Its older manufacturing, assembly, flight and
weapon-prototype architecture differs materially from the cycle-7 baseline.

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/EVE Frontier 3122254/EVE Frontier/stillness
```

| Identity / archive | Target |
| --- | --- |
| Build / sync |3122254 /3122254 |
| MachoNet |489, same number as 3640684 |
| `code.ccp` bytes |109,802,737 |
| ZIP entries / unique members |10,531 /10,526 |
| SHA-256 |`274e80a9bf157facfea178ada607d5fcb2d7aa267a18c3d847770528c88303db` |

## Manifest and installed-file changes

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources | 47,405 | 47,163 | 5,674 | 5,916 | 4,605 | 36,884 |
| Indexed app files | 259 | 235 | 11 | 35 | 122 | 102 |
| Static resources | 114 | 113 | 23 | 24 | 46 | 44 |

Resource/app comparisons use indexed MD5 plus uncompressed length; these are
logical packaging deltas, not enabled-feature or download-size measurements.
**All 113 indexed static payloads are present and match MD5/length.** Both
code archives pass ZIP CRC checks. Installed app checks cover **12
content-hashed files and 223 size-only files**, with no missing files or
checked-size/hash mismatches. The 235-entry app index is now backed by the
completed extraction; size-only checks leave other contents unverified.

Native paths change **251 → 227**, with 10 target-only and 34 baseline-only.
Four directly fingerprinted shared native files differ; the common native
comparison leaves 213 shared contents without a direct pairwise hash proof.
Additional exact-loader fingerprints are retained in the static evidence. The target `blue.pyd` is
9,543,304 bytes (SHA-256
`b6b9bb6ce14e7874000d46365822764826c0f264aacea6bbbda0ca4b848cb629`);
`_destiny.pyd` is 1,200,784 bytes versus 2,131,632 baseline. No `carbon.json`
is bundled, so native package-version declarations are unavailable. Whole-file
hash differences alone do not identify changed engine instructions.

## Python architecture and concrete workflow differences

The target adds **1,323** and lacks **2,476** unique archive
members relative to 3640684. Of 9,203 shared names,
**1,272 have structural code/constant changes** and
7,931 differ only in excluded compilation metadata.
Frontier members decrease **1,628 → 680**. All Python members parse with
matching CPython 3.12 and zero failures. Fingerprints retain instructions,
constants, names, argument/local/free-cell layouts, flags, stack size and
exception tables, excluding pyc headers, source filenames and line metadata.

| Frontier family | Baseline members | Target members |
| --- | ---: | ---: |
| `navigation` | 48 | 4 |
| `docking_point` | 23 | 0 |
| `creation` | 95 | 0 |
| `character` | 44 | 0 |
| `skills` | 13 | 0 |
| `skillshot` | 15 | 0 |
| `skillshot_prototype` | 8 | 7 |
| `manufacturing` | 0 | 34 |
| `smart_assemblies` | 78 | 108 |
| `base_building` | 51 | 33 |
| `signatures_and_scanning` | 12 | 4 |

These are package inventories, not activation tests. Older functionality may
live at other paths. The target also lacks the newer composite-asteroid Python
component and generated Universe-v1 schema metadata; the earlier `crdata`
family is still packaged.

- **Flight RPCs:** `eve/client/script/parklife/shipNavigation/integration.pyc:155/164`
  calls **`CmdManualPitchYawRate`** for pitch/yaw; `:148` keeps
  `CmdSetSpeedFraction`. The HUD (`frontier/hud/navigation/integration.pyc:207/214`)
  increments pitch/yaw state. This is earlier control integration than
  3640684's Frontier pitch-rate/roll/brake/heading path; equal MachoNet does
  not prove native prediction or movement compatibility.
- **Manufacturing:** the target contains 34 `frontier/manufacturing/` UI and
  job modules absent at that namespace in 3640684. The service at
  `frontier/smart_assemblies/client/services/manufacturer_svc.pyc:52` combines
  public inventory/job notices with remote **`manufacturerService`**. Jobs
  are added (`:117`), delivered/withdrawn (`:165`) and presented using the
  older `cfg.blueprints` activities/product data. Base-building UI installs
  jobs through this service (`manufacturing/client/base_building/integration.pyc:99`).
- **Assembly online/offline:** `smart_assemblies/client/services/smart_assembly_svc.pyc:68/81`
  obtains `encryptedWallet.online_meta_tx` / `offline_meta_tx`, then submits
  signed meta-transactions through its public client. Session changes clear
  cached state (`:42`). This differs from assuming the newer assembly or
  Creation-module request families are available.
- **Weapon prototype:** `skillshot_prototype/integration.pyc:123` updates
  turret aiming and screen indicators using selection/camera direction.
  The later `frontier/skillshot/` package is absent. The packaged prototype
  overlay does not establish equal server shot-reporting or damage behavior.
- **Jump, heat and occupancy:** `jump_drive/client/jump_drive.pyc:4` calls
  `jumpDriveMgr.cmd_jump_with_jump_drive`; temperature service `:125` updates
  zone from ship position/system cache. Lagrange occupancy uses
  `lagrangeOccupancyMgr` and clears its system cache on session change
  (`lagrange_occupancy/client/lagrange_occupancy_svc.pyc:95`).
- **Feature defaults:** main beta explicitly hides skills, contracts,
  drones/fighters, industry/reprocessing, insurance and legacy HUD, while
  range-based client occlusion is False. These direct assignments do not
  establish the runtime state of older replacement UIs. Exact flag differences
  are retained in the analysis evidence.

Both archives contain five duplicate names. Unique-name counts resolve to
the final occurrence. Of ten corresponding occurrence pairs, the **first
`const.pyc` is structurally different**; the other nine pairs, including its
final stub occurrence, are equal. The first-occurrence difference is preserved
separately and is not added to the final-name structural count.

## Public and internal protocol changes

| Measure |3640684 |3122254 |
| --- | ---: | ---: |
| Public descriptor files |182 |128 |
| Public messages / fields |600 /1,215 |426 /921 |
| Public `*Request` messages |106 |58 |
| Public services / methods |6 /9 |6 /9 |
| Internal descriptor files |700 |508 |

Every public/internal generated descriptor extracts without failure.
All six services and nine methods remain exactly equal. Of 106 baseline
Request-named messages, **48 are absent**; the remaining **58** consist of
**57 exactly equal** messages and `TokenBalanceRequest` with identical fields
but without its newer deprecated option. There are no target-only public
request names. Ordinary public/gateway envelopes are identical, including
**`Notice.TargetGroup.user` as sint32 field 3**.

Missing newer requests include assembly energy/metadata/online-offline,
network-node fuel, storage-unit prepare/execute, relay lenses, Creation fuel/
network inventory, exploration known-universe/system detail, zklogin,
token-exchange, virtual-ledger user balances and wallet balances. Older
manufacturer and signed-meta-transaction workflows must be assessed separately
from these newer API families.

Public files are **125 identical, 3 changed and 54 baseline-only**. Shared
changes concern window-close analytics (`reason` field 3 absent), token-balance
deprecation metadata, and internal-gateway response (`drain` field 4 absent).
Internal files are **474 identical, 34 changed and 192 baseline-only**, with
no target-only files. Concrete internal changes include `LoadBlueprintRequest`
lacking `solar_system` field 5, payment-product `GetRequest` field 1 changing
from a product Identifier to bool `active_only`, and scheduler request shapes.
Complete numbered-field changes are preserved; internal generated schemas
alone do not prove player-facing activation.

## Static catalogs and geography

The common receipts preserve all 113 verified static hashes/schema fingerprints.
Optimized-root headers provide these independently checked cardinalities:

| Catalog |3640684 |3122254 |
| --- | ---: | ---: |
| `types` | 32,925 | 32,177 |
| `dogmaattributes` | 2,799 | 2,652 |
| `dogmaeffects` | 3,049 | 2,997 |
| `dungeons` | 393 | 163 |
| `dungeonassetmanipulations` | 199 | 54 |
| `dungeonenvironmenttemplates` | 2 | 1 |
| `atoms` | 376 | 364 |
| `typelist` | 433 | 406 |
| `nodegraphs` | 66 | 88 |
| `objectivetasktypes` | 57 | 27 |
| `objectivetypes` | 67 | 36 |

Header counts do not establish which IDs/fields changed or how many records
are playable. The newer `landscape`, `ecosystem`, Creation-template,
`industry_blueprints` and `industry_facilities` paths are absent. Older
blueprint/industry and geography resources must be interpreted using their
own schemas; no numeric recipe migration follows from a changed hash.

### Exact native catalog field changes

Fourteen shared catalogs were fully decoded with this build's exact installed
native loaders, with zero decode failures and loader/resource MD5/size proof.
They are compared with retained exact 3640684 native outputs, with dogma
attributes/effects keyed by ID to avoid order-only differences. Dungeons above
remain header-only, and legacy blueprint/industry tables were not field-decoded.

| Decoded catalog | Baseline | Target | Added IDs | Absent IDs | Changed shared rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| `types` | 32,925 | 32,177 | 345 | 1,093 | 131 |
| `dogmaAttributes` | 2,799 | 2,652 | 15 | 162 | 15 |
| `dogmaEffects` | 3,049 | 2,997 | 8 | 60 | 22 |
| `spaceComponentsByType` | 9,180 | 7,694 | 25 | 1,511 | 6,468 |
| `typeDogma` | 15,185 | 14,845 | 77 | 417 | 582 |
| `nodeGraphs` | 66 | 88 | 24 | 2 | 7 |
| `objectiveTaskTypes` | 57 | 27 | 1 | 31 | 4 |
| `objectiveTypes` | 67 | 36 | 1 | 32 | 34 |

The types comparison has 345 target-only, 1,093 absent and 131 changed shared
records. Of the target-only rows, 213 have the client published flag; this is
not a count of available playable items. Numeric IDs also change meaning:
**83566** is **Watcher**/group 5081 in 3640684 but **Sentry Tower**/group 383
here. **87162** is baseline **Field Printer**, unpublished with graphic 28050,
but target **Portable Printer**, published with graphic 27957. Numeric ID
equality therefore does not justify blindly reusing an entity/catalog mapping.

Representative field changes, all **3640684 → 3122254**:

- **Portable Printer 87162** adds a `manufacturer` component with access
  range 5,000, one concurrent job, storage capacity 20,000 and constructables
  type-list 814. The baseline fitting component and explicit deployable
  construction-cost/site fields are absent. This matches the older client
  manufacturing interface rather than establishing equivalent construction rules.
- **Network Node 88092** changes
  `/smartAnchor/fuelBurnRateInSeconds` **3,000 → 3,600**.
  **Refinery 88063** and **Heavy Refinery 88064** change their activate duration
  fields **192 → 240 seconds** and **2,880 → 3,600 seconds** respectively; target names are
  Refinery M and Refinery L.
- **Space-component changes are broad but structured:** 6,468 shared type
  rows differ, including 6,223 with no target `baseSignature` component.
  The count does not describe 6,468 independent changed gameplay features.
- **Type dogma** has 582 changed shared records. Modern EM-signature and
  scanning attributes, including 6094 and 6139/6168–6181, are absent from the
  target definitions. Autocannon types 81974/82084/82085 lose the newer
  signature/bloom fields; graphic IDs also differ.
- **Objectives:** task type 66 and objective type 105, both named **Jump Drive**,
  are target-only relative to 3640684. Task input schemas and 34 shared
  objective definitions differ, so the later tutorial catalog is not an
  interchangeable drop-in replacement.

These are packaged client metadata, not authoritative live balance or spawn
measurements. Full row-ID differences, selected named fields, exact loader
hashes and raw forensic output receipts are retained in the static evidence.

Immutable SQLite queries pass `quick_check`: **267,359 celestials, 57 NPC
stations and 24,026 systems represented by celestials**. The starmap contains
**24,426 systems, 284 regions, 2,213 constellations and 3,704 jump records**.
All **83,356 tested starmap planet references** exist as planets in SQLite in
the same system, with no membership/endpoint errors in the recorded checks.
All 57 station orbit parents also resolve within the correct system. The 400
cached systems without SQLite celestial rows are exactly **32000001–32000200
and 34000001–34000200**; their cached planet lists are empty. Cache rows contain
no star IDs, so an independent stellar-ID crosscheck was not possible. These
checks are narrower than complete world/celestial/scene reconciliation. Database SHA-256:
`43970add6d4e4da11519b0ebdb3c93ebf7130ec1ed11fd988649fd37b3834f25`.

The complete ordered SQLite table rows and the decoded starmap are equal to
the separately documented 2997426 snapshot, despite different database/archive
file hashes. This equality is a direct row/value comparison, not an inference
from matching counts. It does not establish equality with 3640684 or every
other bundled geographic authority.

## Compatibility, evidence and limits

Current `frontierContractProfile.ts:5` selects the shared contract override
only for 3640684, even though this target also requires notice-user sint32.
Native staging `frontier_windows_client.py:139` requires an exact build
profile; no `blue-pyd.3122254.patch.json` exists. Matching message fields or
MachoNet 489 therefore does not make a configuration-only switch sufficient.
Source hashes/excerpts for these guards are retained in the analysis.

- [Inventory and manifest/static/native receipts](evidence/stillness-3122254.json).
- [Code, workflow, complete descriptor changes and geographic analysis](evidence/stillness-3122254-analysis.json).
- [Exact native catalog fields and geographic source comparisons](evidence/stillness-3122254-static.json).

Full local JSON, selected CPython 3.12 disassembly and reproducible workers are
under `_local/store-build-audit/EVE Frontier 3122254/stillness/` and
`_local/store-build-audit/new312-analysis/`. No client/game session was launched.
Native FSD loaders were invoked only for offline catalog decoding; archived
Python workflow code was not executed. No transaction was submitted and no
client or runtime configuration changed. Native rendering, prediction,
end-to-end workflows and durable-world
compatibility remain untested.
