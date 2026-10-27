# Stored client builds: separate version comparisons

Recorded 2026-10-27. This index covers **14 child build folders** under
`/home/ludus/EveJS-Frontier/clientbuilds/mount/store/`, with separate reports
for **20 identified profile occurrences representing 18 distinct build IDs**.
Every child folder has its own index, and each installed profile/version has
its own report and JSON evidence.

Builds **2997426 and 3122254 are now included after completed extraction**;
their verified reports replace the earlier exclusion and incomplete snapshot.
Archive files directly under the store root are outside this child-folder scope.

All changes are directed **3640684 baseline → the named target version**,
continuing the earlier 3551616 analysis. These are mostly earlier clients and
different branches; the table is not a claim that they form one linear upgrade
sequence. Profile names and directory labels do not override `start.ini`.

Baseline installation:

```text
/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier/stillness
```

Baseline: build/sync 3640684, version 20.04, `//frontier/cycle-7`,
MachoNet 489. Code archive SHA-256:
`2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c`.
[Baseline receipts](evidence/baseline-3640684.json) and the
[complete folder/profile registry](evidence/store-registry.json) retain identity,
source paths and verification scope.

## Consolidated comparison against 3640684

One row represents each distinct build; the three 2702949 occurrences are
consolidated here and remain separate in the folder index below. Gameplay
describes packaged workflows and compiled defaults, not live feature activation.

Protocol fractions count public `*Request` message names out of the baseline's
106. Retained request field schemas match; some older `TokenBalanceRequest`
definitions differ in deprecation metadata. Event, response and internal
protocols can still differ. Static totals are verified table-header counts
unless marked **decoded**; larger historical catalogs can contain unpublished
records. Missing cached payloads are not logical resource removals.

| Build / detailed report | Gameplay / client workflow changes | Public protocol vs 106 requests | Static data / geography |
| --- | --- | --- | --- |
| [3640684 baseline](<../FRONTIER_BUILD_3640684_FEATURE_AUDIT.md>) | Creation/docking, crown weaving, voxel mining and newer flight/scanning paths; user-dependent A/AIM_FLIGHT default. | **106 requests**; six services/nine methods; notice user `sint32`. | 32,925 types; 393 dungeons; 23,846 landscape systems; 299 blueprints; no installed `mapObjects.db`. |
| [2455427](<Phase2/awakening-2455427.md>) | Token-manager/chain proxy and station-industry jobs; older overview/targeting; no later Creation/docking packages. | **48/106**; older launcher/trace payloads; internal-gateway `drain` absent. | 41,250 types / 4,759 dungeons; legacy blueprint/geography layout; modern landscape/ecosystem catalogs absent. |
| [2615573](<Phase3-Final/nebula-2615573.md>) | Signed smart-storage transactions and gateway wallet; classic station industry; compiled range occlusion enabled. | **51/106**; meta-transaction response lacks `transaction_hash`; `drain` absent. | 41,784 types / 4,803 dungeons; legacy blueprint/geography layout; modern landscape/ecosystem catalogs absent. |
| [2702949](<Phase4-Final/Nova-2702949.md>) | Deployment-manager anchoring, signed assemblies and station jobs; compiled range occlusion enabled. | **52/106**; meta-transaction response lacks `transaction_hash`; `drain` absent. | 41,919 types / 4,807 dungeons; SQLite snapshot represents only 96 systems; modern landscape absent. |
| [2703993](<Phase4-Final/nebula-2703993.md>) | Deployment-manager anchoring, signed assemblies and station jobs; compiled range occlusion enabled. | **52/106**; same descriptors as 2702949; newer Creation/exploration/economy requests absent. | 41,919 types / 4,807 dungeons; legacy catalogs; 19 static payloads also differ from sibling 2702949. |
| [2726651](<Phase4-Masstest2/nebula-2726651.md>) | Older station/base-building jobs; scanning-disable flag; new-character-creator flag True. | **52/106**; newer Creation/exploration/economy request families absent. | 41,919 types / 4,808 dungeons; older industry layout; SQLite represents 20,230 systems. |
| [2730628](<Phase4-Masstest2.5/nebula-2730628.md>) | Older station/base-building jobs; scanning-disable flag; new-character-creator flag False. | **52/106**; newer Creation/exploration/economy request families absent. | 41,919 types / 4,808 dungeons; older industry layout; SQLite represents 20,230 systems. |
| [2742057](<Phase5-2763641/nova-2742057.md>) | Older station/base-building jobs and HUD; scanning-disable flag; later navigation/docking packages absent. | **52/106**; newer Creation/exploration/economy request families absent. | 41,929 types / 4,811 dungeons; older industry layout; SQLite represents 20,230 systems. |
| [2763641](<Phase5-2763641/nebula-2763641.md>) | Station industry and expanded base-building packages; scanning-disable flag; later Creation/docking/progression packages absent. | **56/106**; `Connected.session_id` changes from baseline `int64` to `string`. | 42,161 types / 4,865 dungeons; older industry layout; SQLite represents 24,102 systems. |
| [2814770](<Era5Cycle1-2814770/stillness-2814770.md>) | Manufacturer-service jobs and signed assemblies; scanning-disable flag; later Creation/docking/progression packages absent. | **56/106**; meta-transaction hash and manufacturing job-notice `facility` absent. | 42,167 types / 4,865 dungeons; legacy blueprints; modern landscape/ecosystem and native industry catalogs absent. |
| [2884873](<Era5Cycle2-2898485/nova-2884873.md>) | Heat/occupancy sandbox, legacy wallet exchange and signed assemblies; scanning-disable assignment absent, not proven enabled. | **56/106**; `Page`/`NextPage` helpers and meta-transaction hash absent. | **50 indexed static payloads missing**, including types/dungeons/starmap; their counts and field semantics remain unverified. |
| [2898485](<Era5Cycle2-2898485/stillness-2898485.md>) | Manufacturer-service jobs, signed assemblies and legacy wallet exchange; scanning-disable flag. | **56/106**; job-notice `facility` and meta-transaction hash absent. | 42,198 types / 4,865 dungeons; legacy blueprints; modern landscape/ecosystem and native industry catalogs absent. |
| [2973163](<Era6Cycle1-2973168/stillness-2973163.md>) | Jump-drive/heat/occupancy RPCs and session-aware assembly caching; older manufacturing/exchange. | **56/106**; `Page`/`NextPage` helpers and meta-transaction hash absent. | 42,807 types / 4,886 dungeons; legacy blueprints; modern landscape/ecosystem and native industry catalogs absent. |
| [2997426](<Era6Cycle2-2997426/stillness-2997426.md>) | Signed assemblies, manufacturer-service jobs and jump-drive/heat/occupancy; older exchange path. | **56/106**; internal product-query field #1 changes Identifier → bool. | 42,825 types **decoded**; older manufacturer/fuel fields; 158 dungeons (header); checked geography matches 3122254. |
| [3122254](<EVE Frontier 3122254/stillness-3122254.md>) | Manual pitch/yaw RPC, manufacturing UI and skill-shot prototype; later Creation/docking/progression packages absent. | **58/106**; ordinary gateway envelopes match; internal blueprint-load `solar_system` field absent. | 32,177 types **decoded**; changed manufacturer/fuel fields and Jump Drive objectives; 163 dungeons (header); checked geography matches 2997426. |
| [3366068](<Era6Cycle7x-Umb-3551616/utopia-3366068.md>) | A/B/C pitch/yaw/strafe controls, assembly storage/fuel and older crowns; later docking/Creation clients absent. | **90/106**, all exact; newer Creation-module/exploration/user-balance requests absent. | **53 indexed static payloads missing**, including landscape/types; unavailable catalog counts and semantics remain unverified. |
| [3388875](<Era6Cycle5-3388875/stillness-3388875.md>) | A/B/C pitch/yaw/strafe controls, assembly storage/fuel and older crowns; later docking/Creation clients absent. | **90/106**, all exact; newer Creation-module/exploration/user-balance requests absent. | 32,260 types / 296 dungeons / 23,991 landscape systems / 221 blueprints; geographic IDs not reconciled. |
| [3551616](<Era6Cycle7x-Umb-3551616/stillness-3551616.md>) | AIM_FLIGHT default, 0.25 speed steps and nearby-port docking UI; older voxel replay and weapon selection. | **106/106**, all exact; telemetry and internal mining/docking types differ; `drain` absent. | Decoded landscape placements identical; 4 ecosystems, 10 dungeons and 18 blueprints change; 1 blueprint absent; planet IDs conflict. |
| [3572727](<Era6Cycle7x-Lim-3572727/stillness-3572727.md>) | Demo/race-track tools; default scheme A, 0.25 speed steps, first-weapon fallback and older voxel replay. | **106/106**, all exact; sole public descriptor difference is absent `drain`. | Decoded landscape adds 156 systems / 925 sites; 3 dungeons added, 8 changed; planet IDs conflict. |

[Table evidence and source references](evidence/comparison-overview.json)
retain request counts, static-header totals and missing-cache counts for all
18 distinct target builds. The linked reports contain the full field-level
findings and verification boundaries.

## Build folders and individual versions

| Child folder | Separate version reports | Notes |
| --- | --- | --- |
| [Phase2](<Phase2/README.md>) | [2455427 (awakening)](<Phase2/awakening-2455427.md>) | Separate version report and evidence. |
| [Phase3-Final](<Phase3-Final/README.md>) | [2615573 (nebula)](<Phase3-Final/nebula-2615573.md>) | Separate version report and evidence. |
| [Phase4-Final](<Phase4-Final/README.md>) | [2702949 (Nova)](<Phase4-Final/Nova-2702949.md>)<br>[2703993 (nebula)](<Phase4-Final/nebula-2703993.md>) | Nova 2702949 also occurs in both masstest folders. |
| [Phase4-Masstest2](<Phase4-Masstest2/README.md>) | [2702949 (nova)](<Phase4-Masstest2/nova-2702949.md>)<br>[2726651 (nebula)](<Phase4-Masstest2/nebula-2726651.md>) | Contains its own Nebula version and repeated Nova 2702949. |
| [Phase4-Masstest2.5](<Phase4-Masstest2.5/README.md>) | [2702949 (nova)](<Phase4-Masstest2.5/nova-2702949.md>)<br>[2730628 (nebula)](<Phase4-Masstest2.5/nebula-2730628.md>) | Contains its own Nebula version and repeated Nova 2702949. |
| [Phase5-2763641](<Phase5-2763641/README.md>) | [2742057 (nova)](<Phase5-2763641/nova-2742057.md>)<br>[2763641 (nebula)](<Phase5-2763641/nebula-2763641.md>) | Separate version report and evidence. |
| [Era5Cycle1-2814770](<Era5Cycle1-2814770/README.md>) | [2814770 (stillness)](<Era5Cycle1-2814770/stillness-2814770.md>) | Separate version report and evidence. |
| [Era5Cycle2-2898485](<Era5Cycle2-2898485/README.md>) | [2884873 (nova)](<Era5Cycle2-2898485/nova-2884873.md>)<br>[2898485 (stillness)](<Era5Cycle2-2898485/stillness-2898485.md>) | Nova 2884873 has 50 missing cached static payloads. |
| [Era6Cycle1-2973168](<Era6Cycle1-2973168/README.md>) | [2973163 (stillness)](<Era6Cycle1-2973168/stillness-2973163.md>) | Folder label disagrees with start.ini: actual 2973163. |
| [Era6Cycle2-2997426](<Era6Cycle2-2997426/README.md>) | [2997426 (stillness)](<Era6Cycle2-2997426/stillness-2997426.md>) | Completed extraction; FRONTIER-RELEASE branch. |
| [EVE Frontier 3122254](<EVE Frontier 3122254/README.md>) | [3122254 (stillness)](<EVE Frontier 3122254/stillness-3122254.md>) | Completed extraction; MAINLINE-STREAMS-VS sandbox branch. |
| [Era6Cycle5-3388875](<Era6Cycle5-3388875/README.md>) | [3388875 (stillness)](<Era6Cycle5-3388875/stillness-3388875.md>) | Separate version report and evidence. |
| [Era6Cycle7x-Umb-3551616](<Era6Cycle7x-Umb-3551616/README.md>) | [3366068 (utopia)](<Era6Cycle7x-Umb-3551616/utopia-3366068.md>)<br>[3551616 (stillness)](<Era6Cycle7x-Umb-3551616/stillness-3551616.md>) | Utopia 3366068 is separate; 53 cached static payloads missing. |
| [Era6Cycle7x-Lim-3572727](<Era6Cycle7x-Lim-3572727/README.md>) | [3572727 (stillness)](<Era6Cycle7x-Lim-3572727/stillness-3572727.md>) | Separate version report and evidence. |

## Findings that affect interpretation

- **Embedded versions stay separate.** Nova 2702949 appears in three folders
  with matching code archive content. Its reports preserve each occurrence
  and source path. Umbra's Utopia 3366068 is independent of Stillness 3551616.
- **The Era6Cycle1 label is wrong:** `start.ini` identifies 2973163, so the
  report and evidence use 2973163 while preserving the directory's 2973168 label.
- **Newly completed extractions are verified.** Stillness 2997426 identifies
  as `//eve-frontier/branches/release/RELEASE`; Stillness 3122254 identifies as
  `//eve-frontier/branches/sandbox/MAINLINE-STREAMS-VS`. Both now have verified identities,
  readable code archives, checked static payloads and separate comparisons
  against 3640684.
- **Incomplete caches remain explicit.** Nova 2884873 and Utopia 3366068
  have usable code but respectively 50 and 53
  missing indexed static payloads. Missing cached files are not build removals.
- **Runtime generations differ.** Phase2 and Phase3 use zlib-compressed Python 2.7
  `.pyj` members, safely decoded with xdis. Later profiles use Python 3.12
  `.pyc`; exact-runtime structural comparisons exclude compilation metadata.
  No cross-major Python semantic-equivalence claim is made.
- **Macho/service counts are insufficient compatibility proof.** All identified
  targets retain MachoNet 489, while public message catalogs, event fields,
  assembly workflows, native libraries and geographic snapshots vary. Each
  report records the actual target's consumers and schema differences.
- **The event/demo branches have deeper existing audits.** The dedicated
  [3551616](Era6Cycle7x-Umb-3551616/stillness-3551616.md) and
  [3572727](Era6Cycle7x-Lim-3572727/stillness-3572727.md) entries link the full
  earlier workflow, native, static and galaxy analyses for those exact archives.

## Method and verification boundaries

Resource/app deltas compare indexed content MD5 and uncompressed size.
Installed path and size checks are separate from selected native/app content
hashes; each evidence file gives its exact coverage. Some profiles were fully
app-hashed, while others have 12 content-hashed app files plus size-only checks
for remaining entries. Zero mismatches does not turn a size-only check into
content verification. Present static payloads were directly MD5/size checked;
missing payloads are listed explicitly.

ZIP CRCs, member inventories, duplicate occurrences, exact code objects or
cross-version-safe disassembly, serialized protobuf descriptors and immutable
SQLite queries support the individual reports. Legacy/native static row totals
are labeled optimized-root header counts unless a separate detailed report
establishes field-level decoding. Equal counts do not prove equal identities
or catalogs; module/flag presence does not prove feature activation.

Permanent compact evidence is stored beside each report under `evidence/`.
It records source fingerprints, count arithmetic, static/native details,
module/schema differences and references to full local forensic outputs under
`_local/store-build-audit/`. The read-only scanner and report/evidence helpers
are saved there; [registry metadata](evidence/store-registry.json) fingerprints
the scanner. Reproduce common inventory and evidence from the repository root:

```sh
python3 _local/store-build-audit/audit_store.py
python3 _local/store-build-audit/publish_evidence.py
```

The scanner includes both newly extracted folders. Its cached completed
inventories represent this recorded snapshot; use `--refresh-folder NAME`
to rebuild an included extraction and `--only-folder NAME` to limit work while
retaining the complete registry. For example:

```sh
python3 _local/store-build-audit/audit_store.py \
  --only-folder Era6Cycle2-2997426 --refresh-folder Era6Cycle2-2997426 \
  --only-folder 'EVE Frontier 3122254' --refresh-folder 'EVE Frontier 3122254'
```

Per-group code workers and
descriptor comparison scripts are retained in `early_analysis.py`, `phase4_5/`,
`era5_6-analysis/`, `later-analysis/`, `new299-analysis/`, `new312-analysis/`
and `new-static-analysis/` under the local audit directory.

No client/gameplay session was launched, no on-chain transaction was sent,
and no client files, server configuration, launch defaults or runtime state
were changed. End-to-end acceptance and world migration remain separate work.
