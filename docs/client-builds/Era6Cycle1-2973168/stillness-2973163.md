# stillness build 2973163

Recorded: 2026-10-27. Direction: **3640684 baseline → this target**.

Source child folder: `Era6Cycle1-2973168`. This is a separate version record;
other profiles sharing its installation or resource cache have their own reports.

```text
/home/ludus/EveJS-Frontier/clientbuilds/mount/store/Era6Cycle1-2973168/EVE Frontier/stillness
```

| Identity | Target |
| --- | --- |
| Build / sync | 2973163 / 2973163 |
| Version / codename | 20.04 / FRONTIER-RELEASE |
| Branch | `//eve-frontier/branches/release/RELEASE` |
| MachoNet version | 489, same number as 3640684 |
| `code.ccp` bytes | 109,173,424 |
| `code.ccp` SHA-256 | `f04193e961c93deeb0c22344c433e6f9b198863eaae44490c7c2a0c4beef36b6` |

## What differs from 3640684

The actual build is **2973163**: `start.ini` build and sync agree on that
number. The parent folder is named `Era6Cycle1-2973168`; its final digit is
not authoritative. No source folder was renamed by this analysis.

The release contains 624 `frontier/` members. It packages heat, Lagrange
occupancy and jump-drive integrations that
are absent or less developed in the earlier release snapshots. Its assembly
online/offline path still uses `encryptedWallet` signed meta-transactions;
newer 3640684 Creation/docking/progression families remain absent.

`frontier/jump_drive/client/jump_drive.pyc:4/12` calls
`jumpDriveMgr.cmd_jump_with_jump_drive` and scatters `OnJumpDriveFailure` on
an exception. Its map filter includes range, fuel-cost and temperature hints.
`frontier/heat_system/client/temperature_service.pyc:125` updates a
temperature zone using the current position.
`frontier/lagrange_occupancy/client/lagrange_occupancy_svc.pyc:73/81/89`
handles claimed/unclaimed notices and clears the occupancy cache for a
changed solar system.

Manufacturing has moved to
`frontier/smart_assemblies/client/services/manufacturer_svc.pyc`.
`Run:52` subscribes to inventory and job-state notices; methods at `:165/170`
deliver and withdraw jobs, including delivery to hangar. Assembly state
caching also handles session changes and `OnSmartDeployableStateChange`.
Cryptocurrency exchange remains the legacy `encryptionWalletService` path.

All four audited Era5/early-Era6 profiles lack the newer `frontier/creation/`,
`frontier/docking_point/`, `frontier/navigation/`, `frontier/character/`
progression family and generated Universe-v1 schema metadata present in 3640684.
Their older `crdata`, manufacturing, smart-assembly, base-building and HUD code
must be assessed on its own interfaces. Identical MachoNet 489 does not establish
native movement, CRData, gateway or durable-world compatibility.

## Manifest and installed-file comparison

| Scope | Baseline | Target | Added | Removed | Changed | Same |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Logical resources | 47,405 | 48,795 | 7,697 | 6,307 | 4,614 | 36,484 |
| Indexed app files | 259 | 281 | 58 | 36 | 132 | 91 |
| Static resources | 114 | 177 | 87 | 24 | 57 | 33 |

Resource and app deltas compare indexed MD5 plus uncompressed length. They describe
logical packaging, not activated features or measured download size. Static payloads
were checked directly: **177 verified, 0 missing,
0 mismatched**. ZIP CRC verification passes and all Python
members parse under exact CPython 3.12 with zero failures.

Installed app verification: 12 content-hashed and
269 checked by size only; 0 missing or checked-size/hash mismatches.
Size-only checks leave those files’ content unverified.

`blue.pyd` is 8,520,832 bytes, SHA-256 `e796c9199f1f5ef0f450d5d934fa399de82a6dae4c7f6bfb0e197a61013b11d1`.
`_destiny.pyd` is 1,145,472 bytes versus 2,131,632 in 3640684,
with a different directly checked content hash. No `carbon.json` library-version
declarations are bundled here. Whole-file hash differences alone do not establish
which native instructions changed. Existing 3640684 patch offsets/profile cannot
be assumed valid for this build.

## Static content boundaries

Verified optimized `.fsdbinary` root headers expose these counts:

| Table | 3640684 rows | Target header rows |
| --- | ---: | ---: |
| types | 32,925 | 42,807 |
| typeDogma | 15,185 | 24,685 |
| dogmaAttributes | 2,799 | 2,651 |
| dogmaEffects | 3,049 | 2,994 |
| dungeons | 393 | 4,886 |
| atoms | 376 | 371 |

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
| Target ZIP entries / unique member names | 10,412 / 10,407 |
| Added / removed unique names vs 3640684 | 1,408 / 2,680 |
| Structurally changed shared members | 1,308 |
| Shared metadata-only differences | 7,691 |
| `frontier/` members, baseline → target | 1,628 → 624 |

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
| Public files | 182 | 113 |
| Public messages | 600 | 389 |
| Public fields | 1,215 | 857 |
| Public request-named messages | 106 | 56 |
| Internal descriptor files | 700 | 462 |

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

Internal files: **422 identical, 39 changed,
239 baseline-only, 1 target-only**.
Missing internal generated models/events alone do not prove the associated player
workflow is unavailable.

## Reuse limits and evidence

Current 3640684-only server guards and exact native staging profiles require
explicit review before selecting this build. In particular, the target still uses
notice-user zigzag encoding, so a legacy `int64` envelope is not interchangeable.
No client/server session, transaction, configuration switch or data migration was
performed. Native movement, rendering, authority, world-ID consistency and end-to-end
gameplay remain untested.

- [Manifest/static/native evidence](evidence/stillness-2973163.json)
- [Code/protocol analysis evidence](evidence/stillness-2973163-analysis.json)

The analysis evidence records original paths, archive hashes, structural inventories,
duplicate-occurrence differences, public/internal schema deltas, selected code-symbol
source lines and local forensic receipts. Reproduce code inspection with
`_local/store-build-audit/era5_6-analysis/run_bytecode.py`, followed by
`compare_protocols.py` and `write_reports.py`. The first uses disposable CPython 3.12
with read-only sources; no client module is imported or its logic executed.
The shared manifest inventory is produced by `audit_store.py`.
