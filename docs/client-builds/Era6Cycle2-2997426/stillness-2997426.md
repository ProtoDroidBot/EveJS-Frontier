# Stillness build 2997426: changes from 3640684

Recorded: 2026-10-27. Direction: **3640684 baseline → 2997426 target**.
This completed extraction is now included in the store documentation; its
earlier exclusion while extracting no longer applies.

## Identity and source

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle2-2997426/EVE Frontier/stillness
```

| Identity | Target |
| --- | --- |
| Build / sync | 2997426 / 2997426 |
| Version / codename | 20.04 / FRONTIER-RELEASE |
| Branch | `//eve-frontier/branches/release/RELEASE` |
| MachoNet | 489, same number as 3640684 |
| `code.ccp` bytes | 109,296,885 |
| `code.ccp` SHA-256 | `95ff3e2cac7d6638d6f5d1507e648afe4cc161a95aeb56c0daaf30bc1b28cd30` |

## Main workflow differences

This earlier release has **627 `frontier/` members**, versus 1,628 in
3640684. It retains the older smart-assembly/manufacturing, heat, Lagrange
occupancy and jump-drive interfaces. The later full `frontier/navigation/`,
`creation/`, `docking_point/`, `character/` progression, `skills/` and
`skillshot/` families are absent at those paths, as is generated Universe-v1
schema metadata. Common scanning definitions remain packaged, but the later
active-scanner service is absent. These findings concern the packaged code,
not proof that every corresponding activity is unavailable through older paths.

- **Assembly online/offline:**
  `frontier/smart_assemblies/client/services/smart_assembly_svc.pyc:68/81`
  builds signed transactions through `encryptedWallet.online_meta_tx` /
  `offline_meta_tx` and invokes the public client's `send_meta_tx`. Failed
  operations signal `OnSmartDeployableOnlineFailed` or
  `OnSmartDeployableOfflineFailed`. `OnSessionChanged:42` clears assembly
  state when the solar system changes.
- **Manufacturing:**
  `frontier/smart_assemblies/client/services/manufacturer_svc.pyc:52`
  uses `manufacturerService` and subscribes to inventory/job-state notices.
  Methods at `:110/114/117/128/146` deliver, cancel, add jobs, withdraw items
  and assemble ships. `get_active_jobs:68` derives products, quantities and
  runtime through older `cfg.blueprints.activities` data. This differs from
  the baseline's newer native industry catalog layout and adapters.
- **Legacy exchange:**
  `frontier/web3/client/cryptocurrency_svc.pyc:44/50` uses
  `encryptionWalletService.exchange_eve_for_lux` and `exchange_lux_for_eve`;
  the EVE transfer constructs a signed wallet meta-transaction. This remains
  a client integration even though the later public token-exchange request
  family is absent.
- **Jump/heat/occupancy:**
  `frontier/jump_drive/client/jump_drive.pyc:4/12` obtains `jumpDriveMgr`
  and calls `cmd_jump_with_jump_drive`, reporting `OnJumpDriveFailure` on
  exception. Temperature service `:125` updates the zone from ship position.
  Lagrange occupancy `:73/81/89` handles claimed/unclaimed notices and clears
  a system's occupancy cache on session change.

The main beta module explicitly sets range-based client occlusion **False**
and hides legacy HUD, skills, structures, contracts and industry/reprocessing
UI. Its complete assignments are preserved in evidence. Compiled flags and
module presence do not establish runtime activation or authoritative rules.

## Manifest and installed-file changes

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources | 47,405 | 46,846 | 5,653 | 6,212 | 4,660 | 36,533 |
| Indexed app files | 259 | 283 | 60 | 36 | 132 | 91 |
| Static resource paths | 114 | 179 | 89 | 24 | 56 | 34 |

Resource and app equality compares indexed MD5 and uncompressed length.
Installed checks cover **12 content-hashed app files**
and **271 size-only files**, with no missing or checked
size/hash mismatches. Size-only checks leave content MD5 unverified.
All **179 indexed static payloads** are present and match their indexed
MD5 and length. The code archive passes ZIP CRC checks.

Installed native paths change **251 → 275**;
59 are target-only and 35 baseline-only.
Of directly fingerprinted shared native files, four differ; the other shared
files are explicitly unverified in the content comparison. `blue.pyd` is
8,520,320 bytes, SHA-256 `5ea8a7c72a2d2ab2e932dc578beaf77c759c790f5b1b09ec2aa1971bfc42be10`. `_destiny.pyd` is
1,179,264 bytes versus 2,131,632 in 3640684, with a different
checked hash. No `carbon.json` library declarations are bundled. Whole-file
hash differences do not identify which native instructions changed.

## Python structural comparison

| Measure | Target / delta |
| --- | ---: |
| ZIP entries / unique names | 10,424 / 10,419 |
| Target-only / baseline-only unique names | 1,408 / 2,668 |
| Shared unique names | 9,011 |
| Structurally changed shared members | 1,280 |
| Shared metadata-only changes | 7,731 |
| `frontier/` members, baseline → target | 1,628 → 627 |

Exact CPython 3.12 parses every bytecode member with **zero failures**.
Normalization preserves instructions, constants, names, argument/local/free-cell
layouts, stack sizes, flags and exception tables; it excludes pyc headers,
source filenames and line metadata. These are structural differences, not
counts of changed features.

Both archives contain five duplicated member names. Unique-name counts use
the final occurrence. Of ten corresponding occurrence pairs, the **first
`const.pyc` differs structurally** and the other nine are equal, including
the final `const.pyc`. That earlier constants difference is recorded separately
and is not included in the final-name structural count.

## Public and internal schemas

| Descriptor measure | 3640684 | 2997426 |
| --- | ---: | ---: |
| Public files | 182 | 113 |
| Public messages | 600 | 389 |
| Public fields | 1,215 | 859 |
| Public Request-named messages | 106 | 56 |
| Internal files | 700 | 463 |

All generated public/internal descriptors extract without failures. All six
public services and nine methods are exactly equal. Of the **56 target
Request-named public messages**, **55 are exactly equal**; the remaining
`TokenBalanceRequest` has identical fields without the baseline's deprecated
option. **50 baseline requests are absent**, with no target-only request names.

The absent families include newer assembly energy/fuel/storage/relay operations,
Creation module fuel/network inventory/docking, exploration known-universe and
system detail, zklogin, token exchange, virtual-ledger user balances and wallet
balance APIs. Their absence must be distinguished from the older Python
assembly, exchange and manufacturing integrations above.

`Notice.TargetGroup.user` remains **sint32 field 3**. The ordinary gateway
envelope fields agree; `public.proto` lacks newer `Page` / `NextPage` helpers.
Shared public changes include absent window-close analytics `reason` #3,
internal-gateway response `drain` #4 and trace-context `state` #4, plus the
recorded deprecation metadata. Matching service/request shapes alone do not
establish complete transport or gameplay compatibility.

Internal files comprise **428 identical, 34 changed, 238 baseline-only and
one target-only**. A concrete wire difference is
`eve.payment.product.GetRequest`: target field #1 is `bool active_only`,
where baseline field #1 is the typed `Identifier identifier` message. These
internal request payloads require distinct encoders. Bundled internal
types alone do not establish an enabled ordinary public API.

## Static catalogs and geography

Exact target-native loaders decoded **14 shared catalogs** with zero errors;
their source/data hashes and complete row-ID differences are retained in the
[static and geography evidence](evidence/stillness-2997426-static.json).
The comparison uses verified 3640684 exports from its matching native loaders.

| Decoded catalog | 3640684 | 2997426 | Shared rows changed |
| --- | ---: | ---: | ---: |
| Types | 32,925 | 42,825 | 483 |
| Dogma attributes | 2,799 | 2,652 | 15 |
| Dogma effects | 3,049 | 2,994 | 22 |
| Type dogma | 15,185 | 24,702 | 578 |
| Space components by type | 9,180 | 8,804 | 6,458 |
| Objective task types | 57 | 26 | 4 |
| Objective types | 67 | 35 | 34 |

The types comparison has **11,146 target-only IDs and 1,246 baseline-only IDs**.
Of the target-only IDs, **10,862 are below 75000 and all are unpublished**.
The larger historical catalog therefore does not establish thousands of new
playable items. Publication metadata itself also does not establish activation.

Concrete shared-ID field changes include:

- **Printer 87162:** baseline name Field Printer becomes Portable Printer.
  Target `/manufacturer` has accessRange 5000, concurrentJobs 1,
  storageCapacity 20000 and constructables 814. The last value is a **type-list
  ID**, not 814 constructed items. Baseline fitting, construction-cost and
  construction-site fields are absent from this target row, matching the
  earlier manufacturing/deployment data model.
- **Network Node 88092:** `/smartAnchor/fuelBurnRateInSeconds` changes
  **3000 → 3600**. These are authored client configuration values, not a
  measured server consumption rate.
- **Refinery 88063 / Heavy Refinery 88064:** `/activate/durationSeconds`
  changes **192 → 240** and **2880 → 3600 seconds**, respectively. Their target
  names are Refinery M/L, and both carry manufacturer components absent from
  the baseline rows.
- **Signatures:** 6,213 of the 6,458 changed shared space-component rows include
  absence of the baseline `baseSignature` component. This is a systematic
  schema/content difference; it does not prove those objects cannot be scanned
  through the older client's separate mechanisms.

The dungeon optimized-root header reports **158 target rows versus 393**;
dungeons are **not** among the 14 decoded catalogs, so no field-level encounter
comparison is inferred. Legacy `blueprints.static` and `industry_*.static`
are present but were not field-decoded; no numerical recipe conversion is
claimed. The modern landscape/ecosystem, Creation-template and native
industry-blueprint/facility families are absent from the target resource index.
Their absence does not establish that the older client lacks a galaxy,
construction or manufacturing.

Immutable SQLite inspection passes `quick_check`: the bundled map database
has **267,359 celestials, 57 NPC stations and 24,026 represented celestial
systems**, including 83,356 planets, 152,569 moons and 7,408 gates. Database
SHA-256 is
`e68e653fbe1c425551f3edce8f7e849a90c631b93b97db85145cc4935c41f57e`.
The 3640684 installation has no installed map database at that app path.

The primitive-only starmap cache has **24,426 systems, 284 regions, 2,213
constellations and 3,704 jump records**. All 83,356 checked planet references
are SQLite planets owned by the same system; all 57 station orbit parents
resolve in the same system. Checked cached membership and jump endpoints have
no errors. The 400 extra cached systems have empty planet lists and no SQLite
celestial rows; their IDs are 32000001–32000200 and 34000001–34000200.

The 2997426 and 3122254 caches decode equally, and complete ordered comparison
finds every SQLite celestial and station row equal across those two builds,
despite different database-file hashes. This establishes equality for those
specific bundled sources. It does not reconcile all other geography/static
authorities or establish compatibility with the 3640684 runtime world. Cached
system rows contain no star IDs, so no independent cache-vs-SQLite stellar-ID
comparison was possible.

## Reuse limits and evidence

The current shared-contract profile guard remains specific to 3640684
(`frontierContractProfile.ts:5`). This target still requires notice-user
zigzag encoding, so a legacy `int64` envelope cannot substitute for `sint32`.
There is no exact `blue-pyd.2997426.patch.json` profile; native staging's
`resolve_profile` requires the build and source fingerprint to match.
No native patch, gameplay acceptance or runtime migration was produced here.

- [Manifest/static/native receipts](evidence/stillness-2997426.json)
- [Code and protocol analysis](evidence/stillness-2997426-analysis.json)

The analysis records source archive hashes, structural inventories, duplicated
occurrences, exact descriptor changes and selected source-line/call evidence.
Reproduce code inspection using `_local/store-build-audit/new299-analysis/run_bytecode.py`,
then `compare_protocols.py` and `write_report.py`; sources are mounted read-only
in a disposable CPython 3.12/Wine process. The bytecode worker reads code
objects without importing client Python modules or running their logic. Native
catalog decoding uses only the matching data-loader modules in a separate
disposable process. Client files, launch defaults, server configuration and
runtime data were not changed. Native rendering, flight prediction and end-to-end gameplay
remain untested.
