# stillness build 2898485

Recorded: 2026-10-27. Direction: **3640684 baseline → this target**.

Source child folder: `Era5Cycle2-2898485`. This is a separate version record;
other profiles sharing its installation or resource cache have their own reports.

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era5Cycle2-2898485/EVE Frontier/stillness
```

| Identity | Target |
| --- | --- |
| Build / sync | 2898485 / 2898485 |
| Version / codename | 20.04 / FRONTIER-RELEASE |
| Branch | `//eve-frontier/branches/release/RELEASE` |
| MachoNet version | 489, same number as 3640684 |
| `code.ccp` bytes | 111,173,174 |
| `code.ccp` SHA-256 | `68e78ee330447feaa08190d05519708acdc81eeded027368a0b74d6bc65a2aa3` |

## What differs from 3640684

This is the folder's release profile, distinct from its embedded Nova
2884873 sandbox. Its 509 `frontier/` members retain the older manufacturing
and signed-meta-transaction assembly paths. The main beta module explicitly
sets `FRONTIER_BETA_DISABLE_SCANNING = True` and
`FRONTIER_BETA_HIDE_CLASSIC_MAP = True`; the Nova profile lacks those direct
assignments and packages additional heat/occupancy definitions. A larger
build number therefore does not make these two branches feature-equivalent.

`frontier/smart_assemblies/client/services/smart_assembly_svc.pyc:35/48`
builds signed online/offline meta-transactions through `encryptedWallet`.
`frontier/web3/client/cryptocurrency_svc.pyc:26/44/50/53` obtains
`encryptionWalletService` and exposes `exchange_eve_for_lux`,
`exchange_lux_for_eve`, and `lux_eve_exchange_rate`. The first constructs a
signed transfer, while the latter exchange operation uses that Python remote
service. This is concrete legacy exchange integration despite the absence of
the later public token-exchange descriptor family. Manufacturing still calls
`manufacturerService` and reads jobs through `PublicGatewayClient`.

All four audited Era5/early-Era6 profiles lack the newer `frontier/creation/`,
`frontier/docking_point/`, `frontier/navigation/`, `frontier/character/`
progression family and generated Universe-v1 schema metadata present in 3640684.
Their older `crdata`, manufacturing, smart-assembly, base-building and HUD code
must be assessed on its own interfaces. Identical MachoNet 489 does not establish
native movement, CRData, gateway or durable-world compatibility.

## Manifest and installed-file comparison

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources | 47,405 | 49,334 | 9,546 | 7,617 | 4,229 | 35,559 |
| Indexed app files | 259 | 268 | 61 | 52 | 127 | 80 |
| Static resources | 114 | 170 | 89 | 33 | 53 | 28 |

Resource and app deltas compare indexed MD5 plus uncompressed length. They describe
logical packaging, not activated features or measured download size. Static payloads
were checked directly: **170 verified, 0 missing,
0 mismatched**. ZIP CRC verification passes and all Python
members parse under exact CPython 3.12 with zero failures.

This profile’s 268 indexed installed app files match their checked MD5/size;
the retained initial inventory includes full native fingerprints. The common
cross-build native comparison uses only shared files fingerprinted in its baseline;
other shared native content is marked unverified in that comparison.

`blue.pyd` is 8,552,512 bytes, SHA-256 `18597cb334963f496f74ef287a02211e2299108b24b36c6fd6639b8c6b698b81`.
`_destiny.pyd` is 1,134,144 bytes versus 2,131,632 in 3640684,
with a different directly checked content hash. No `carbon.json` library-version
declarations are bundled here. Whole-file hash differences alone do not establish
which native instructions changed. Existing 3640684 patch offsets/profile cannot
be assumed valid for this build.

## Static content boundaries

Verified optimized `.fsdbinary` root headers expose these counts:

| Table | 3640684 rows | Target header rows |
| --- | ---: | ---: |
| types | 32,925 | 42,198 |
| typeDogma | 15,185 | 24,489 |
| dogmaAttributes | 2,799 | 2,674 |
| dogmaEffects | 3,049 | 3,051 |
| dungeons | 393 | 4,865 |
| atoms | 376 | 433 |

These are header observations, not field-level decoder output. Larger historical
catalogs can include legacy/unpublished records; they do not establish more playable
types or encounters. Schema fingerprints and full source hashes are retained.

The 3640684 landscape/ecosystem, Creation-template and native
`industry_blueprints` / `industry_facilities` resources are absent from this
profile’s index. Older `blueprints.static`, geography/cache and dungeon content
use a different catalog arrangement. Their absence does not mean the older client
has no industry or galaxy. No mixed-build world or geographic ID mapping was made.

## Python code changes

| Measure | Count |
| --- | ---: |
| Target ZIP entries / unique member names | 10,456 / 10,451 |
| Added / removed unique names vs 3640684 | 1,691 / 2,919 |
| Structurally changed shared members | 1,309 |
| Shared metadata-only differences | 7,451 |
| `frontier/` members, baseline → target | 1,628 → 509 |

Normalization retains instructions, constants, names, flags, argument/local/free-cell
layouts, stack size and exception tables, excluding pyc headers, source filenames
and line metadata. These are structural differences, not a feature count.

Both archives contain five duplicated names. Main counts use the final occurrence
selected by ZIP name lookup. Of ten paired occurrences, the **first `const.pyc`
is structurally different**; the other nine pairs, including the final `const.pyc`,
are equal. That earlier constants change is recorded separately and is not included
in the final-name structural count.

## Public and internal protocol changes

| Descriptor measure | 3640684 | Target |
| --- | ---: | ---: |
| Public files | 182 | 109 |
| Public messages | 600 | 428 |
| Public fields | 1,215 | 933 |
| Public request-named messages | 106 | 56 |
| Internal descriptor files | 700 | 455 |

Every generated public/internal descriptor is extracted without failure. All six
public services and nine methods are exactly equal. Of 106 baseline request-named
messages, **50 are absent**; the remaining **56** include **55 exactly equal**
definitions and `TokenBalanceRequest` with identical fields but without the newer
deprecated option. There are no target-only public request names.

Absent newer public families include exploration known-universe/system detail,
Creation fuel/network-inventory operations, assembly energy/fuel/storage/relay
operations, zklogin, token exchange, virtual-ledger and wallet-balance requests.
Existing legacy Python exchange/manufacturing paths must be distinguished from
those newer public API families.

`Notice.TargetGroup.user` remains **sint32 field 3**. Shared ordinary gateway
envelope messages remain equal; `public.proto` additionally lacks the newer `Page`
and `NextPage` helper identities. The optional internal-gateway `drain` response
field is absent, as is meta-transaction response `transaction_hash` field 2.
Other shared descriptor changes include tracing, presence deprecation metadata,
launcher/telemetry records and, where recorded, manufacturing job notice content.
The analysis evidence preserves every shared-message and numbered-field change.

Internal files: **413 identical, 41 changed,
246 baseline-only, 1 target-only**.
Missing internal generated models/events alone do not prove the associated player
workflow is unavailable.

## Reuse limits and evidence

Current 3640684-only server guards and exact native staging profiles require
explicit review before selecting this build. In particular, the target still uses
notice-user zigzag encoding, so a legacy `int64` envelope is not interchangeable.
No client/server session, transaction, configuration switch or data migration was
performed. Native movement, rendering, authority, world-ID consistency and end-to-end
gameplay remain untested.

- [Manifest/static/native evidence](evidence/stillness-2898485.json)
- [Code/protocol analysis evidence](evidence/stillness-2898485-analysis.json)

The analysis evidence records original paths, archive hashes, structural inventories,
duplicate-occurrence differences, public/internal schema deltas, selected code-symbol
source lines and local forensic receipts. Reproduce code inspection with
`_local/store-build-audit/era5_6-analysis/run_bytecode.py`, followed by
`compare_protocols.py` and `write_reports.py`. The first uses disposable CPython 3.12
with read-only sources; no client module is imported or its logic executed.
The shared manifest inventory is produced by `audit_store.py`.
