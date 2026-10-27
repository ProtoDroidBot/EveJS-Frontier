# Stored client builds: separate version comparisons

Recorded 2026-10-27. This index covers **14 child build folders** under
`/home/ludus/EveJS-Frontier/clientbuilds/mount/store/`, with separate reports
for **20 identified profile occurrences representing 18 distinct build IDs**.
Every child folder has its own index, and each installed profile/version has
its own report and JSON evidence.

Builds **2997426 and 3122254 are now included after completed extraction**;
their verified reports replace the earlier exclusion and incomplete snapshot.
Archive files directly under the store root are outside this child-folder scope.

The consolidated comparison and individual reports use **3640684 baseline →
the named target version**, continuing the earlier 3551616 analysis. The
first-observation timeline separately orders the available snapshots by build
number. These branches do not establish one linear upgrade sequence. Profile
names and directory labels do not override `start.ini`.

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

## Chronological first-observation timeline

This timeline is ordered by **verified build number**, including 3640684 as
the latest available baseline snapshot. No authoritative calendar release dates
are present in the saved evidence; extraction times and year-like branch names
are not used as release dates. **First observed** means the earliest available
snapshot meeting the stated client/module/schema criteria, not the original
introduction or public launch. Systems in the oldest build were already present.

Empty package stubs, common definitions, generated protocols, cached data and
consuming client implementations are distinguished below. Branches can diverge:
a later omission or changed default does not establish a global removal or a
single linear feature history. All observations concern packaged code/data,
not live feature activation.

| First observed build / report | Major milestone visible in the archive | Evidence boundary / later variation |
| --- | --- | --- |
| [2455427](<Phase2/awakening-2455427.md>) | **Gameplay:** Token-manager/custodial-chain integration and station manufacturing are already packaged in the oldest snapshot.<br>**Protocol:** 48 public Request-named messages; authentication, local chat and skill-plan definitions already present.<br>**Data:** Legacy blueprints and galaxy/static/cache resources already present. | Earliest available snapshot: these are already-existing systems, not dated introductions. |
| [2615573](<Phase3-Final/nebula-2615573.md>) | **Gameplay:** Substantial Frontier HUD service/action-bar/health/energy UI; signed smart-storage online/offline via gateway wallet.<br>**Protocol:** Token-balance, smart-character-existence and meta-transaction requests first observed: 48 → 51. | 2455427 has a HUD audio helper, not this full HUD generation. A legacy ship-navigation integration module is already present here. |
| [2702949](<Phase4-Final/Nova-2702949.md>) | **Gameplay:** Deployment-manager anchoring, smart-assembly services and smart killmail client.<br>**Protocol:** Smart-storage inventory request first observed: 51 → 52. | Jump-drive namespace contains empty initializers here; this is not the first usable jump-drive client. |
| [2726651](<Phase4-Masstest2/nebula-2726651.md>) | **Gameplay:** Separate industry_new UI generation and nonempty jump-drive fuel-cost helper. | Full jump execution/map consumers appear in 2973163. New-character-creator flag is True here, False in the 2730628 staging snapshot; these are branch defaults. |
| [2763641](<Phase5-2763641/nebula-2763641.md>) | **Gameplay:** Separate 34-module manufacturing UI and manufacturer-service namespace.<br>**Protocol:** Four external-industry facility/inventory/job requests: 52 → 56. Public Connected first observed with string session_id. | Earlier station job APIs already existed. Generated request/event definitions do not establish live server support. |
| [2814770](<Era5Cycle1-2814770/stillness-2814770.md>) | **Protocol:** Public Connected.session_id first observed as int64, following the string field in 2763641. | This is eve_public.client.Connected; the separate internal eve.client.event.Connected string is not the same message. |
| [2884873](<Era5Cycle2-2898485/nova-2884873.md>) | **Gameplay:** Heat/temperature and Lagrange-occupancy consumers; common signature/scan definitions.<br>**Protocol:** Internal payment-product GetRequest first observed with bool active_only field #1. | Common scan definitions are not the active scanner service (first 3366068). The 2898485 release omits these heat/occupancy packages: branch divergence, not proven global removal. |
| [2973163](<Era6Cycle1-2973168/stillness-2973163.md>) | **Gameplay:** Jump-drive execution RPC, range/fuel/temperature map filters and client service; Cycle Hub consumers. | Earlier jump-drive stubs (2702949) and fuel helper (2726651) predate this consuming client. The folder label 2973168 is not its actual build. |
| [2997426](<Era6Cycle2-2997426/stillness-2997426.md>) | **Protocol:** Public/internal MetaTransactionResponse.transaction_hash field #2 first observed. | Public request-name count remains 56; adding a response field is a distinct protocol milestone. |
| [3122254](<EVE Frontier 3122254/stillness-3122254.md>) | **Gameplay:** Frontier HUD navigation, skill-shot prototype overlay and feral-network lens/data trading UI.<br>**Protocol:** Smart-character private-key get/store requests: 56 → 58. Page/NextPage helpers and TraceContext.state first observed. | This is not the origin of all manual flight: the legacy navigation module exists by 2615573. The later dedicated relay wrapper is a separate milestone. |
| [3366068](<Era6Cycle7x-Umb-3551616/utopia-3366068.md>) | **Gameplay:** Full Frontier A/B/C pitch/yaw/strafe integration, active directional-scan client, older crown/shell/memory/ascension and experience consumers.<br>**Protocol:** 32 assembly/owned-gate/fuel/storage/relay-lens, zklogin, web3-character, exchange and wallet requests: 58 → 90. Internal character/crown/shell events first observed.<br>**Data:** Modern landscape/ecosystem and native industry catalogs first indexed. | Those catalog payloads are missing in this Utopia cache; first checked bytes are in 3388875. Demo tooling exists here before the later race-track family. |
| [3388875](<Era6Cycle5-3388875/stillness-3388875.md>) | **Data:** First physically verified landscape/ecosystem/native-industry payloads; first Creation hardpoint/module/part/template data (3/14/11/1 header rows). | These are data foundations, not the full Creation gameplay client. That client first appears in 3551616; public request count stays 90. |
| [3551616](<Era6Cycle7x-Umb-3551616/stillness-3551616.md>) | **Gameplay:** Creation/Digital Chemistry and docking; weaving/skills/medical/status; composite-voxel/regolith/scoop; resolved Universe-v14 exploration; full skillshot/held-beam/aimed-action and pitch-rate/roll/brake/heading clients; dedicated gate/IFF/relay wrappers.<br>**Protocol:** 16 Creation/exploration/virtual-ledger requests: 90 → 106. Internal memory/shell identifiers and request families, Thrusted telemetry and ItemsScooped.items #4 first observed.<br>**Data:** Native recipe/input/output/transform family first present. | Older gates, crown actions and relay-lens schemas predate these specialized clients. The event branch defaults to AIM_FLIGHT; definition presence is not activation. |
| [3572727](<Era6Cycle7x-Lim-3572727/stillness-3572727.md>) | **Gameplay:** Race-track prototype, newer weaving ceremony/card UI, starter warmup and FPS reporting client.<br>**Protocol:** Heartbeat/FPS and Braked/Aimflight telemetry; internal docking/entitlement/NPC-harvest models/events first observed. ItemsScooped uses wrapped scooped_items #5. | Demo branch observation, not the first generic demo tool or docking gameplay. Thrusted is absent on this branch; default input is scheme A. Request count stays 106. |
| [3640684](<../FRONTIER_BUILD_3640684_FEATURE_AUDIT.md>) | **Gameplay:** Newer Python RCS/flight-latency, speed-ramp and keyboard scan-angle helper modules.<br>**Protocol:** Gateway drain #4; internal composite-asteroid events, typed category/crown/skill and memory-depth models/events; sponsored-transaction execute-token fields first observed. | Latest available baseline snapshot, not a dated launch. Public request-name count remains 106; new internal fields are distinct from first player-facing mining or progression. |

The sampled public Request-name sets grow **48 → 51 → 52 → 56 → 58 → 90 → 106**
without losing names in this sample; that is not a claim of monotonic gameplay
or full wire compatibility. MachoNet 489, six public services/nine methods and
notice-user `sint32` are already present in the oldest snapshot and remain
across this set. Builds without an additional selected first-observation
milestone remain in the consolidated comparison and folder index.

[Timeline evidence](evidence/first-seen-timeline.json) contains the exact module
criteria, earlier-snapshot absence checks, request additions, message/field
state series, static-index/cache distinctions and source hash receipts.

## Gameplay feature matrix

This matrix covers all **19 distinct available snapshots**, including baseline
3640684, and separates client code from supporting definitions. The three
tables are groups of one matrix; every group uses the same build order.
Repeated 2702949 installations share one build row.

- **C — client implementation:** audited consuming client modules are packaged.
  This does not establish live activation, server support or parity with 3640684.
- **D — definitions/stubs:** matching common/generated/static definitions or
  package initializers exist, but the scoped consuming client is absent.
- **A — absent in scope:** no matching client or definition criterion was found
  in the complete saved archive/index. Other legacy implementations are not ruled out.
- **U — unverified:** the available evidence cannot resolve the scoped case,
  or declared supporting payloads are missing. This is not an absence finding.

Columns refer to the named Frontier systems and audited integration families.
They do not classify every inherited EVE flight, weapon, probe-scanner, skill-plan,
station-docking, mining, scooping or map implementation. A compiled disable flag
can coexist with C; packaged code is not an enablement test.

### Industry, structures and travel

| Build / report | Industry | Depots/assembly | Placement | Heat | Occupancy | Jump drive | Cycle Hub |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [2455427](<Phase2/awakening-2455427.md>) | **C** | **C** | A | A | A | A | A |
| [2615573](<Phase3-Final/nebula-2615573.md>) | **C** | **C** | A | A | A | A | A |
| [2702949](<Phase4-Final/Nova-2702949.md>) | **C** | **C** | **C** | A | A | D | A |
| [2703993](<Phase4-Final/nebula-2703993.md>) | **C** | **C** | **C** | A | A | D | A |
| [2726651](<Phase4-Masstest2/nebula-2726651.md>) | **C** | **C** | **C** | A | A | D | A |
| [2730628](<Phase4-Masstest2.5/nebula-2730628.md>) | **C** | **C** | **C** | A | A | D | A |
| [2742057](<Phase5-2763641/nova-2742057.md>) | **C** | **C** | **C** | A | A | D | A |
| [2763641](<Phase5-2763641/nebula-2763641.md>) | **C** | **C** | **C** | A | A | D | A |
| [2814770](<Era5Cycle1-2814770/stillness-2814770.md>) | **C** | **C** | **C** | A | A | D | A |
| [2884873](<Era5Cycle2-2898485/nova-2884873.md>) | **C** | **C** | **C** | **C** | **C** | D | A |
| [2898485](<Era5Cycle2-2898485/stillness-2898485.md>) | **C** | **C** | **C** | A | A | D | A |
| [2973163](<Era6Cycle1-2973168/stillness-2973163.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [2997426](<Era6Cycle2-2997426/stillness-2997426.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3122254](<EVE Frontier 3122254/stillness-3122254.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3366068](<Era6Cycle7x-Umb-3551616/utopia-3366068.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3388875](<Era6Cycle5-3388875/stillness-3388875.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3551616](<Era6Cycle7x-Umb-3551616/stillness-3551616.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3572727](<Era6Cycle7x-Lim-3572727/stillness-3572727.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3640684 baseline](<../FRONTIER_BUILD_3640684_FEATURE_AUDIT.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |

### Pilot, combat, progression and chemistry clients

| Build / report | Manual flight | Frontier scan | Aimed fire | Crowns/memory | Weave/skills | Medical/status | Digital Chemistry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [2455427](<Phase2/awakening-2455427.md>) | **U** | A | A | A | A | A | A |
| [2615573](<Phase3-Final/nebula-2615573.md>) | **C** | A | A | A | A | A | A |
| [2702949](<Phase4-Final/Nova-2702949.md>) | **C** | A | A | A | A | A | A |
| [2703993](<Phase4-Final/nebula-2703993.md>) | **C** | A | A | A | A | A | A |
| [2726651](<Phase4-Masstest2/nebula-2726651.md>) | **C** | A | A | A | A | A | A |
| [2730628](<Phase4-Masstest2.5/nebula-2730628.md>) | **C** | A | A | A | A | A | A |
| [2742057](<Phase5-2763641/nova-2742057.md>) | **C** | A | A | A | A | A | A |
| [2763641](<Phase5-2763641/nebula-2763641.md>) | **C** | A | A | A | A | A | A |
| [2814770](<Era5Cycle1-2814770/stillness-2814770.md>) | **C** | A | A | A | A | A | A |
| [2884873](<Era5Cycle2-2898485/nova-2884873.md>) | **C** | D | A | A | A | A | A |
| [2898485](<Era5Cycle2-2898485/stillness-2898485.md>) | **C** | A | A | A | A | A | A |
| [2973163](<Era6Cycle1-2973168/stillness-2973163.md>) | **C** | D | A | A | A | A | A |
| [2997426](<Era6Cycle2-2997426/stillness-2997426.md>) | **C** | D | A | A | A | A | A |
| [3122254](<EVE Frontier 3122254/stillness-3122254.md>) | **C** | D | **C** | A | A | A | A |
| [3366068](<Era6Cycle7x-Umb-3551616/utopia-3366068.md>) | **C** | **C** | **C** | **C** | A | A | A |
| [3388875](<Era6Cycle5-3388875/stillness-3388875.md>) | **C** | **C** | **C** | **C** | A | A | A |
| [3551616](<Era6Cycle7x-Umb-3551616/stillness-3551616.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3572727](<Era6Cycle7x-Lim-3572727/stillness-3572727.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3640684 baseline](<../FRONTIER_BUILD_3640684_FEATURE_AUDIT.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** |

### Creation, docking, resources, exploration and trading

| Build / report | Creation | Dock/refuel | Voxels/scoop | Universe v14 | Feral trading | Relay wrapper | Gate/IFF | Race track |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [2455427](<Phase2/awakening-2455427.md>) | A | A | A | A | A | A | A | A |
| [2615573](<Phase3-Final/nebula-2615573.md>) | A | A | A | A | A | A | A | A |
| [2702949](<Phase4-Final/Nova-2702949.md>) | A | A | A | A | A | A | A | A |
| [2703993](<Phase4-Final/nebula-2703993.md>) | A | A | A | A | A | A | A | A |
| [2726651](<Phase4-Masstest2/nebula-2726651.md>) | A | A | A | A | A | A | A | A |
| [2730628](<Phase4-Masstest2.5/nebula-2730628.md>) | A | A | A | A | A | A | A | A |
| [2742057](<Phase5-2763641/nova-2742057.md>) | A | A | A | A | A | A | A | A |
| [2763641](<Phase5-2763641/nebula-2763641.md>) | A | A | A | A | A | A | A | A |
| [2814770](<Era5Cycle1-2814770/stillness-2814770.md>) | A | A | A | A | A | A | A | A |
| [2884873](<Era5Cycle2-2898485/nova-2884873.md>) | A | A | A | A | A | A | A | A |
| [2898485](<Era5Cycle2-2898485/stillness-2898485.md>) | A | A | A | A | A | A | A | A |
| [2973163](<Era6Cycle1-2973168/stillness-2973163.md>) | A | A | A | A | A | A | A | A |
| [2997426](<Era6Cycle2-2997426/stillness-2997426.md>) | A | A | A | A | A | A | A | A |
| [3122254](<EVE Frontier 3122254/stillness-3122254.md>) | A | A | A | A | **C** | A | A | A |
| [3366068](<Era6Cycle7x-Umb-3551616/utopia-3366068.md>) | A | A | A | A | **C** | D | A | A |
| [3388875](<Era6Cycle5-3388875/stillness-3388875.md>) | D | A | A | A | **C** | D | A | A |
| [3551616](<Era6Cycle7x-Umb-3551616/stillness-3551616.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** | A |
| [3572727](<Era6Cycle7x-Lim-3572727/stillness-3572727.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** | **C** |
| [3640684 baseline](<../FRONTIER_BUILD_3640684_FEATURE_AUDIT.md>) | **C** | **C** | **C** | **C** | **C** | **C** | **C** | A |

### Generation and uncertainty notes

- Industry and depot/assembly C include the older station-industry and
  blockchain-depot clients already in 2455427. Placement is the separate
  dedicated Frontier base-building UI, first observed in 2702949.
- Manual-flight C is the named legacy integration in 2615573–3122254,
  then Frontier A/B/C controls in 3366068–3388875 and AIM/rate-axis integration
  in 3551616 onward. U in 2455427 leaves earlier classic/native alternatives
  unresolved; it does not say the client cannot fly.
- Aimed-fire C in 3122254–3388875 is a consuming prototype; 3551616 onward has
  the full skillshot/held-beam/aimed-action generation. Older EVE weapons are
  outside this column. Older crown actions also precede the separate weaving/skills C.
- Jump-drive D includes empty packages in 2702949/2703993 and common fuel
  helpers in later early builds. Frontier scan D is common signature/scan code.
  Creation D in 3388875 is data foundations, not the editor. Relay-wrapper D
  in 3366068/3388875 is public schema support, separate from the older trading UI.
- Gate/IFF means the later celestial-gate rebuild/fuel and structure-transponder
  clients, not the first existence of gates or overview identification. Race-track
  C in 3572727 and A in 3640684 is a branch-specific packaged difference.

The following **support-data** cases remain U independently of the client-code
cells above. Missing cached data does not downgrade a verified C implementation.

| Build | Unverified support data | Independently verified client code |
| --- | --- | --- |
| [2884873](Era5Cycle2-2898485/nova-2884873.md) | **U:** 50 indexed static payloads missing, including types, dungeons and type dogma. | Industry, depots/assembly, heat and occupancy remain C. |
| [3366068](Era6Cycle7x-Umb-3551616/utopia-3366068.md) | **U:** 53 indexed static payloads missing, including types and landscape. | Flight, active Frontier scanning and crown/memory clients remain C. |

[Feature-matrix evidence](evidence/feature-matrix.json) records each cell's
criteria, matched modules/definitions, alternate generation paths, source
receipts and supporting-cache status. The linked build reports explain
behavior and protocol differences between implementations with the same C code.

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
