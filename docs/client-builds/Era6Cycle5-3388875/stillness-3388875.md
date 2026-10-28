# stillness build 3388875: changes from 3640684

Recorded 2026-10-27. Direction is **3640684 baseline → 3388875 target**.
This is the earlier **`//frontier/v2026.05`** branch, version
20.04, codename `v2026.05`.
The same branch is also represented by Utopia 3366068 in the Umbra folder. Its own report records that version's different archive/native hashes and incomplete resource cache.

Source profile:

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle5-3388875/EVE Frontier/stillness
```

The [common evidence](evidence/stillness-3388875.json) records manifests,
static payload hashes and installed checks. The [code/protocol analysis](evidence/stillness-3388875-analysis.json)
records exact CPython 3.12 structural comparisons, selected symbols, flags,
descriptor changes and immutable SQLite queries.

## Packaged and installed changes

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| resources | 47,405 | 47,722 | 5,500 | 5,183 | 4,678 | 37,544 |
| appFiles | 259 | 244 | 7 | 22 | 133 | 104 |
| static | 114 | 125 | 24 | 13 | 47 | 54 |

Resource/app changes use indexed MD5 and uncompressed size. Installed app
checks cover **12 hashed files and 232 size-only files**, with no missing,
size-mismatched or checked-hash-mismatched app entries. Other native content
was not universally hashed. All 236 native paths were inventoried;
blue, executable, Python DLL and Destiny hashes differ from the baseline.
ZIP CRC passes; code SHA-256 is
`0d3960591565f229d86e9abf33783b17992b2297574266fb598bf3502529313b` (108,972,293 bytes).

`carbon.json` has 13 libraries versus 16. Its older engine declarations include
Destiny **v2.2.2** versus v3.0.2, Trinity **v3.8.0** versus v6.0.1,
and audio **v5.3.5-51-g5c48754** versus v9.1.0. Library declarations and
whole-file hashes are inventory evidence, not native behavioral equivalence.

## Python and concrete workflows

The target has **10,542 unique archive members**, with
**563 added / 1,700 absent** relative to 3640684.
Among 9,979 shared members, **1,113**
have structural changes and 8,866 differ only in excluded
compilation metadata. There are **754 Frontier members**
versus 1,628. Parsing has zero failures and MachoNet remains
**489**. Counts resolve duplicated names to the final occurrence; duplicate
occurrence comparisons are retained separately in the analysis.

- **Flight:** `navigation/client/integration.pyc:517/524/534/541/556` calls
  `CmdSetSpeedFraction`, `CmdSetPitch`, `CmdSetYawRate`, and
  `CmdSetStrafingThrust`. This predates the baseline's pitch-rate/roll/brake/
  heading control integration. `navigation/client/beta.pyc` defines schemes
  A/B/C rather than the later A/AIM_FLIGHT arrangement. These are client call
  paths, not proof of accepted server commands or native prediction behavior.
- **Scanning:** `signatures_and_scanning/client/scanning_service.pyc:142`
  calls remote `directional_scan` and translates `NotEnoughEnergy` into a
  scan failure. The later Creation scan route is absent from this method.
- **Assembly storage and fuel:** `smart_assemblies/client/smart_assembly_svc.pyc:332/406`
  still performs public prepare/sign/execute item deposit and withdrawal;
  fuel uses messenger prepare/sign/execute methods (`:496`). Gate jump and
  location publication call `smartAssemblyService` (`:655/:293`). Older
  assemblies are therefore still packaged even though newer Creation module
  request schemas are absent.
- **Crowns:** `shell/client/service.pyc:83/86/89` delegates crown creation,
  implantation and deletion to `shell_manager`. This is an earlier shell
  workflow; the later weave/depth UI and typed protocol families cannot be
  assumed to apply unchanged.
- **Feature defaults:** main beta explicitly hides contracts, drones/fighters,
  insurance, mining ledger and structures. Baseline-only flags for fog-of-war
  map look and several HUD panels are absent. An absent assignment is not a
  proof of the opposite runtime setting; all exact assignment differences
  are recorded in evidence.

Python families include earlier `base_building`, `smart_assemblies`, `web3`,
`skillshot_prototype`, navigation and scanning. The later `docking_point`,
full `creation`, `skillshot`, resolved-system exploration messenger and
Universe schema-14 modules are absent. Module presence and flags do not
establish enabled gameplay.

## Public and internal schemas

Public descriptors decrease **182 → 158**,
messages **600 → 527**, and fields
**1,215 → 1079**. All **90 target `*Request` messages
are exactly equal** to their baseline namesakes; **16 baseline requests are
absent**. All six services/nine methods remain equal, and notice user remains
**sint32 field 3**. Extraction has zero failures.

Absent requests cover Creation batch desired state, Creation-module fuel
deposit and network inventory/docking, exploration known-universe/system-detail
and admin operations, and virtual-ledger user balances. This does not remove
the older assembly-level storage requests described above. Shared message
changes include missing window-close analytics `reason` and internal-gateway
response `drain`; inventory descriptor metadata also differs.

Internal descriptors number **583** versus 700. Shared request changes include
payment-product lookup, sponsored transaction execution/gas reservation and
prepared sponsored transactions. Complete field-number changes and absent
types are in the analysis; matching MachoNet/service counts do not establish
wire or runtime compatibility for the whole client.

## Static data and geography

All 125 indexed static payloads are locally present and match MD5/length.

The following are **optimized-root header counts**, not field-level native
catalog decodes. A changed count does not identify which shared rows changed.

| Catalog | 3640684 | 3388875 |
| --- | ---: | ---: |
| `types` | 32925 | 32260 |
| `dogmaattributes` | 2799 | 2679 |
| `dogmaeffects` | 3049 | 3001 |
| `creation_templates` | 5 | 1 |
| `landscape` | 23846 | 23991 |
| `ecosystem` | 35 | 15 |
| `dungeons` | 393 | 296 |
| `industry_blueprints` | 299 | 221 |
| `industry_facilities` | 16 | 12 |
| `objectivetasktypes` | 57 | 29 |
| `objectivetypes` | 67 | 38 |

Immutable SQLite inspection passes `quick_check`: **261,219
celestials**, **98 NPC stations**, and
**24,026 systems represented by celestials**. Groups
include 83,257 planets, 147,060 moons and 6,876 gates. Database SHA-256:
`9552d3f1d264a69b4b0ae3931f84f695eb5f62975db67264904dea443d405e6f`.

These counts do not establish an ID-consistent replacement world. Geographic
relationships were not reconciled with the other static tables or baseline
landscape. In particular, header-only record totals are not identity proofs.

## Compatibility and limits

The repository's 3640684-specific gateway/native staging guards do not select
this version automatically. The matching notice scalar still requires the
correct sint32 encoder; modern data adapters cannot be assumed to fit these
older catalogs and workflows. No exact native patch profile or live acceptance
was produced here. Catalog field semantics, native rendering/flight and
end-to-end gameplay remain untested. Client files, launch defaults and runtime
state were unchanged.
