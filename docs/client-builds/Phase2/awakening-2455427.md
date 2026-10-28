# Build 2455427 — awakening in Phase2

Recorded: 2026-10-27. Direction: **3640684 baseline → this supplied target**.
The target is an older branch snapshot, not an upgrade from 3640684.

## Identity and scope

Source: `/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Phase2/AwakenCBT - Copy/awakening`. Baseline: `/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier/stillness`.

| Identity | Baseline | Target |
| --- | --- | --- |
| Build / sync | 3640684 / 3640684 | 2455427 / 2455427 |
| Branch | `//frontier/cycle-7` | `//eve-frontier/branches/snapshot/VS` |
| Codename | cycle-7 | VS |
| Application / version | FRONTIER / 20.04 | EVE / 20.04 |
| MachoNet version read from code | 489 | 489 |
| Archive bytes | 119,398,148 | 23,327,398 |
| Archive SHA-256 | `2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c` | `61748c303382d79e56deb4f7514048fb33e65befc9701b5d01c936d826d51186` |

## Meaningful client differences

This Phase2 snapshot uses the EVE application identity, Python 2.7 and a
chain-proxy/token-manager integration. Its Frontier package is much smaller
than 3640684's and contains older industry, overview and targeting paths.

- `frontier/beta.pyj:3–4` creates `CharSettingBool` settings with
  `beta_target_enabled=False` and `new_industry_enabled=True`. These are
  setting defaults, with runtime/user overrides possible.
- `frontier/evetoken/client/tokenSvc.pyj:36` obtains blockchain-connection
  information through `RemoteSvc('tokenMgr')`, constructs client/shared chain
  interfaces, and configures a remote custodial blockchain proxy. Its
  `ActivateLicense:123` calls `tokenMgr.activate_license`; `buy_helium:152`
  calls `tokenMgr.buy_helium`. The names and calls are preserved in the
  disassembled code; no endpoint or chain operation was invoked.
- `frontier/industry/client/constructablesSvc.pyj` uses the classic
  `stationConstructableManager` and `industryManager2` dependencies for
  blueprints, job lookup/install, completion and cancellation. This is a
  different client organization from the newer Frontier recipe/Creation
  paths; it does not establish compatible job payloads.

The archive has 58 `frontier/chain/`, 40 `frontier/crdata/`, 36
`frontier/industry/`, 28 `frontier/overview/` and 16 `frontier/evetoken/`
members. No `frontier/navigation/`, `frontier/docking_point/`,
`frontier/skillshot/`, `frontier/status_effect/`, `frontier/creation/` or
`frontier/signatures_and_scanning/` module family is packaged. This is a
module-presence finding, not proof that every analogous legacy behavior is
absent elsewhere in the client.

## Resource, app and code inventory

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources | 47,405 | 85,077 | 46,795 | 9,123 | 5,066 | 33,216 |
| Indexed app files | 259 | 183 | 90 | 166 | 87 | 6 |
| Static resource paths | 114 | 177 | 96 | 33 | 66 | 15 |

Logical resource/app changes compare indexed MD5 plus uncompressed length,
with logical path case normalized for Windows. They are packaging counts,
not activated-feature counts or a download-size estimate.

Installed native inventory: **175 files**, versus 251 in the baseline.
App verification checked content hashes for **11** entries and sizes for **172** further entries;
**0 mismatches** were recorded. Zero recorded mismatches does not establish hashes
for the size-only entries. Key native fingerprints and unverified shared native
paths are retained in the inventory evidence.

The ZIP CRC check passes. It contains **8,506 entries / 8,485 unique names**;
**213** unique modules are under `frontier/`. Removing only the `.pyc`/`.pyj`
extension for module identity yields **5,327 shared, 3,158 target-only, 6,352 baseline-only** names.

The `.pyj` entries are zlib-compressed Python **2.7** bytecode (decompressed
magic `03f30d0a`), while 3640684 uses Python3.12 `.pyc`. `xdis6.1.8` safely
parses the selected Frontier modules and descriptor constants without importing
or running client modules. Those selections have zero parse/extraction failures.
No cross-major structural-equality count is reported.

## Protocol differences

| Scope | Baseline | Target |
| --- | ---: | ---: |
| Public descriptor files | 182 | 92 |
| Public messages, nested included | 600 | 393 |
| Public message fields | 1,215 | 838 |
| Public `*Request` messages | 106 | 48 |
| Internal descriptor files | 700 | 408 |
| Internal messages, nested included | 3,191 | 1,913 |

All 48 target public `*Request` messages have the same field schemas as 3640684.
They are complete message-descriptor matches.
**58 baseline request names are absent** from the target, including newer
exploration, wallet/exchange, external-industry and assembly-related APIs.
All **six public services and nine methods** retain identical descriptors.
The ordinary Request/Response/Notice messages remain equal, including notice
user field3 as `sint32`; matching these envelopes does not supply missing
gameplay handlers or prove authentication/transport acceptance.

Public changes include the older launcher telemetry layout, absent
`TraceContext.state` field4 and absent internal-gateway `Response.drain` field4.
All public descriptor files differ because metadata such as the Go package
path changes; this must not be interpreted as all message fields changing.

The internal `eve.*` set also differs substantially; complete removed/added
message names and exact changed fields are retained in the analysis evidence.
Bundled internal definitions are not by themselves enabled public APIs.

## Static content and world boundaries

All **177 indexed static payloads** exist and pass direct MD5/length checks.
Selected optimized root headers report:

| Static table | Baseline rows | Target rows |
| --- | ---: | ---: |
| `types` | 32,925 | 41,250 |
| `dogmaAttributes` | 2,799 | 2,659 |
| `dogmaEffects` | 3,049 | 3,041 |
| `dungeons` | 393 | 4,759 |
| `dungeonEnvironmentTemplates` | 2 | 72 |
| `atoms` | 376 | 430 |
| `typeList` | 433 | 191 |

These are verified header cardinalities, not field-level native decodes or
counts of active Frontier entities. Inherited/unused records may be present.
Target indexes include `systems`, `regions`, `constellations`, `jumps` and
`solarsystemcontent` `.static` geography plus `starmapcache.pickle`, unlike
the 3640684 baseline index. Their planetary IDs and cross-table consistency
were not reconciled by this per-build inventory.

Target static indexes lack these baseline paths: `landscape.fsdbinary`, `ecosystem.fsdbinary`, `industry_blueprints.fsdbinary`, `creation_templates.fsdbinary`.
Legacy blueprint/industry/static resources must be decoded using their own
schema before proposing a runtime catalog conversion. Changed resource hashes
alone do not establish the numeric recipe/balance changes inside them.

## Evidence and practical limits

- [Inventory and comparison evidence](evidence/awakening-2455427.json) retains identities,
  manifests, native fingerprints, static checks/headers and full module inventories.
- [Code and protocol evidence](evidence/awakening-2455427-analysis.json) retains parsed
  defaults, selected code symbols/source lines, complete semantic descriptor
  changes and hash receipts for the local disassembly/analysis artifacts.

Local forensic outputs and reproducible scripts are under
`_local/store-build-audit/`. No client, server, blockchain transaction or
runtime migration was started. Native rendering/prediction, gameplay, state
compatibility and exact staging/patch support remain untested. The common
MachoNet number and equal envelope fields do not establish installability
or permission to reuse newer build-specific native offsets.
