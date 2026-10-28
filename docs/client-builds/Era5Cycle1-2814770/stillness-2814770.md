# stillness build 2814770

Recorded: 2026-10-27. Direction: **3640684 baseline → this target**.

Source child folder: `Era5Cycle1-2814770`. This is a separate version record;
other profiles sharing its installation or resource cache have their own reports.

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era5Cycle1-2814770/EVE Frontier/stillness
```

| Identity | Target |
| --- | --- |
| Build / sync | 2814770 / 2814770 |
| Version / codename | 20.04 / FRONTIER-RELEASE |
| Branch | `//eve-frontier/branches/release/RELEASE` |
| MachoNet version | 489, same number as 3640684 |
| `code.ccp` bytes | 111,126,724 |
| `code.ccp` SHA-256 | `67a449459094d482455f77efecfcce6c21e31d9375c2ee485137295d28e421eb` |

## What differs from 3640684

This release retains the older manufacturing and signed-meta-transaction
assembly workflow. It packages 507 `frontier/` members, compared with 1,628
in 3640684. The main beta module sets
`FRONTIER_BETA_DISABLE_SCANNING = True` and
`FRONTIER_BETA_HIDE_CLASSIC_MAP = True`; the newer generic
`FRONTIER_FOG_OF_WAR_MAP_LOOK` assignment is absent. These are compiled
configuration values, not a live feature-acceptance result.

`frontier/smart_assemblies/client/services/smart_assembly_svc.pyc:35/48`
constructs online/offline transactions through `encryptedWallet`, then calls
the public client's `send_meta_tx`. Manufacturing uses
`manufacturerService`: `add_job`, `cancel_job`, `deliver_job`, `withdraw_items`
and `assemble_ship` are visible in
`frontier/assemblies/client/services/manufacturer_svc.pyc:51/102/106/109/120/141`.
Cryptocurrency balance queries use `get_token_balance`, cached balance and
`OnEveTokenChangeClient`; this version lacks the later local
`exchange_eve_for_lux` / `exchange_lux_for_eve` methods found in 2898485.

All four audited Era5/early-Era6 profiles lack the newer `frontier/creation/`,
`frontier/docking_point/`, `frontier/navigation/`, `frontier/character/`
progression family and generated Universe-v1 schema metadata present in 3640684.
Their older `crdata`, manufacturing, smart-assembly, base-building and HUD code
must be assessed on its own interfaces. Identical MachoNet 489 does not establish
native movement, CRData, gateway or durable-world compatibility.

## Manifest and installed-file comparison

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources | 47,405 | 49,167 | 9,435 | 7,673 | 4,200 | 35,532 |
| Indexed app files | 259 | 272 | 67 | 54 | 125 | 80 |
| Static resources | 114 | 171 | 90 | 33 | 53 | 28 |

Resource and app deltas compare indexed MD5 plus uncompressed length. They describe
logical packaging, not activated features or measured download size. Static payloads
were checked directly: **171 verified, 0 missing,
0 mismatched**. ZIP CRC verification passes and all Python
members parse under exact CPython 3.12 with zero failures.

This profile’s 272 indexed installed app files match their checked MD5/size;
the retained initial inventory includes full native fingerprints. The common
cross-build native comparison uses only shared files fingerprinted in its baseline;
other shared native content is marked unverified in that comparison.

`blue.pyd` is 8,740,928 bytes, SHA-256 `85f7c3d04696d67c210cd026649ebc802f6ce349fc40d647d7d618190b33b0e8`.
`_destiny.pyd` is 1,133,120 bytes versus 2,131,632 in 3640684,
with a different directly checked content hash. No `carbon.json` library-version
declarations are bundled here. Whole-file hash differences alone do not establish
which native instructions changed. Existing 3640684 patch offsets/profile cannot
be assumed valid for this build.

## Static content boundaries

Verified optimized `.fsdbinary` root headers expose these counts:

| Table | 3640684 rows | Target header rows |
| --- | ---: | ---: |
| types | 32,925 | 42,167 |
| typeDogma | 15,185 | 24,469 |
| dogmaAttributes | 2,799 | 2,673 |
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
| Target ZIP entries / unique member names | 10,429 / 10,424 |
| Added / removed unique names vs 3640684 | 1,703 / 2,958 |
| Structurally changed shared members | 1,317 |
| Shared metadata-only differences | 7,404 |
| `frontier/` members, baseline → target | 1,628 → 507 |

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
| Public files | 182 | 104 |
| Public messages | 600 | 422 |
| Public fields | 1,215 | 910 |
| Public request-named messages | 106 | 56 |
| Internal descriptor files | 700 | 438 |

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

Internal files: **403 identical, 35 changed,
262 baseline-only, 0 target-only**.
Missing internal generated models/events alone do not prove the associated player
workflow is unavailable.

## Reuse limits and evidence

Current 3640684-only server guards and exact native staging profiles require
explicit review before selecting this build. In particular, the target still uses
notice-user zigzag encoding, so a legacy `int64` envelope is not interchangeable.
No client/server session, transaction, configuration switch or data migration was
performed. Native movement, rendering, authority, world-ID consistency and end-to-end
gameplay remain untested.

- [Manifest/static/native evidence](evidence/stillness-2814770.json)
- [Code/protocol analysis evidence](evidence/stillness-2814770-analysis.json)

The analysis evidence records original paths, archive hashes, structural inventories,
duplicate-occurrence differences, public/internal schema deltas, selected code-symbol
source lines and local forensic receipts. Reproduce code inspection with
`_local/store-build-audit/era5_6-analysis/run_bytecode.py`, followed by
`compare_protocols.py` and `write_reports.py`. The first uses disposable CPython 3.12
with read-only sources; no client module is imported or its logic executed.
The shared manifest inventory is produced by `audit_store.py`.
