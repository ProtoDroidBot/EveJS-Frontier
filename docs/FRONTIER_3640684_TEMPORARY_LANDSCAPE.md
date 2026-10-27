# Temporary 3640684 landscape content on the 3502403 galaxy

Implemented 2026-10-26. This profile combines decoded build **3640684**
landscape, ecosystem and dungeon content with the explicitly selected
**3502403-MOD4-STUFF1** galaxy. It is temporary until the full **era 6 cycle 7**
files are supplied. It does not replace the galaxy's systems, coordinates,
planets or gate topology.

The user's mapping choice is preserved: keep authored system-local positions
and omit unresolved planet/Lagrange links from the map. Do not move content to
a guessed nearest planet.

## Decoding and mapped content

The exact client native loaders ran in a separate 64-bit Windows Python 3.12
process under Bottles/Wine, using a disposable prefix. All rows were decoded;
the client installation was not changed and the game was not launched.
Repeated exports produced identical output hashes. Input hashes, loader
hashes, schema fingerprints and row counts accompany the export manifest.

| Content | Imported records |
| --- | ---: |
| Landscape systems, all present in the selected galaxy | 23,846 |
| Authored sites with unchanged IDs and coordinates | 136,443 |
| Active sites / sites disabled by authored ecosystem settings | 130,058 / 6,385 |
| Ecosystems | 35 |
| Dungeon templates / authored dungeon objects | 393 / 61,960 |
| Referenced target item types, all resolved | 1,016 |
| Dungeon asset manipulations / environment templates | 199 / 2 |
| Map belts / Trojans with verified legacy parents | 32,772 / 5 |
| Sites represented in the map hierarchy | 89,647 |

All site positions, system IDs, ecosystem IDs and feature IDs were compared
against the actual native export. All ecosystem dungeon references and dungeon
object type references resolve. Supporting records and raw dungeon fields,
including locators and behavior references, remain in the profile.

The target and legacy planet IDs differ substantially. The map omits 14,338
belts with unresolved explicit center references and 22,252 Trojans with
unresolved parents. Missing inner/outer links on otherwise representable belts
are omitted; six source boundary references to suns are not mislabeled as
planets. Their sites remain in the server's content at their authored positions,
subject to authored enablement. Every unmatched reference is recorded in the
mapping report. Full-scope exploration flags remain false.

## Server integration

The profile supplies landscape sites, ecosystems, both dungeon template
readers, and referenced target type metadata, dogma and space components.
The exploration adapter adds the verified belt/cluster/Trojan hierarchy to the
same selected galaxy and creates a new content revision. Map geometry cannot
replace system centers or planetary geometry. Disabled ecosystems do not
materialize encounter content.

Landscape scenes use target entry beacons, clouds, post-processing, authored
object transforms and template selection. Old ecosystem-ID resource rules,
landscape NPC/wreck overrides and type-ID hive injection are excluded from
temporary content: the same numeric ID across builds is not sufficient evidence
of the same meaning. Abstract map rings do not spawn procedural ore fields.

The [allocation and encounter policies](FRONTIER_3640684_LANDSCAPE_POLICIES.md)
now turn resource, event, threat and NPC locators into finite resources and
persistent encounters. Native caps, eligible materials and mass formulas are
combined with explicitly versioned temporary stock and NPC-roster defaults.
The 84 actual ore carrier objects in the full dungeon catalog retain the existing
mining-to-composite adaptation. Native gameplay and official encounter balance
still require separate acceptance evidence.

The runtime applies guard commands, supported entity/NPC-group bindings,
locator triggers and module blocking. Asset-manipulation and environment-template
overrides remain retained metadata. Pattern placement continues to use the
server's deterministic placement and scenery limits; exact preservation of site
origins does not establish an exact reproduction of every native encounter.

Profile revisions isolate materialized content IDs, voxel depletion and
Frontier dungeon instance state. Existing receipts are retained. Switching
back to the previous profile restores its view of those records rather than
resetting them. Unrelated mission content remains shared; missions using
changed Frontier dungeon templates follow the content profile. Instance-ID
allocation remains monotonic across profiles.

## Files and activation

Generated local inputs are:

- `_local/landscape-3640684-decoded/manifest.json` and its JSONL tables.
- `_local/temporary-landscape-3640684.json`: the mapped, integrity-checked profile.
- `_local/feature-audit-3640684/temporary-landscape-mapping.json`: complete
  source-feature mappings and unresolved references.
- `_local/feature-audit-3640684/temporary-landscape-mapping-verification.json`:
  independent source-to-profile comparison.
- `_local/temporary-landscape-3640684-full-verification.json`: successful
  complete-dataset server integration check.

The profile revision is
`28f645382d93478a51ac393297bafc0252e91e0ce96bd6614e8596a654e6e44f`.
It binds the legacy world revision
`2891c2ce747671b3e43dd20f886f4b8227bd19b9e8ac33c2112892c6b699c810`.

Pass these settings to the existing isolated build-3640684 server launch:

```sh
export EVEJS_EXPLORATION_WORLD_PATH=/home/ludus/EveJS-Frontier/_local/exploration-world-3502403.json
export EVEJS_TEMPORARY_LANDSCAPE_PATH=/home/ludus/EveJS-Frontier/_local/temporary-landscape-3640684.json
```

`temporaryLandscapePath` in the local server configuration is an alternative
to the second variable. The overlay applies only to build 3640684. Existing
launch defaults and live databases were not changed. Invalid fingerprints,
content hashes, references or world bindings fail explicitly.

Restart after enabling, replacing or removing a profile. To remove this
temporary content, clear `EVEJS_TEMPORARY_LANDSCAPE_PATH` and
`temporaryLandscapePath`, then restart. No database deletion is needed. When
the full era 6 cycle 7 files arrive, decode and validate them as a new world
profile; do not reuse this temporary mapping's revision or silently relabel it.

## Rebuilding and checking

On this Linux/Bottles installation, use the preserved Windows Python runtime:

```sh
python3 tools/frontier-static/export-landscape-bottles.py \
  --python-runtime _local/landscape-decoder-runtime/python312 \
  --client-root '/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier' \
  --output _local/landscape-3640684-decoded \
  --runner /home/ludus/.var/app/com.usebottles.bottles/data/bottles/runners/soda-11.0-10/bin/wine
```

Add `--probe` to verify the interpreter without decoding. The wrapper downloads
nothing, mounts the client and runtime read-only, and removes its disposable
Wine prefix. `_local/landscape-decoder-runtime/runtime-manifest.json` records
the preserved runtime's file hashes. A complete export through this wrapper
reproduced all six decoded JSONL files byte-for-byte.

On a Windows Python 3.12 interpreter matching the client ABI:

```sh
python -I tools/frontier-static/export-landscape-native.py \
  --client-root '/path/to/EVE Frontier' \
  --output _local/landscape-3640684-decoded
```

Build the portable mapped profile with ordinary Python:

```sh
python3 tools/frontier-static/build-temporary-landscape-world.py \
  --decoded-dir _local/landscape-3640684-decoded \
  --world _local/exploration-world-3502403.json \
  --output _local/temporary-landscape-3640684.json \
  --report _local/feature-audit-3640684/temporary-landscape-mapping.json
```

The mapper preserves existing outputs unless `--replace` is explicitly supplied.
Build server/tests/tools before `npm run test:frontier-3640684`. To include
the full source-to-server test, also set `FRONTIER_TEMPORARY_TEST_WORLD`,
`FRONTIER_TEMPORARY_TEST_PROFILE` and `FRONTIER_TEMPORARY_TEST_DECODED` to the
three corresponding local paths above. The test uses a disposable game store.

Initial import verification completed on 2026-10-26: server, test and tool TypeScript builds
passed; 160 tests across the 26 selected server test files passed, including
the full-data check; all 18 decoder, wrapper and mapper tests passed. Additional
existing landscape-scene, dungeon-materialization, resource-field and dungeon
persistence regressions passed. The full-data check verified every source site
position, active-site counts, world binding, absence of legacy procedural ore
fields, and production conversion of a native ore carrier into a voxel asteroid
with the target ore yield. It took approximately 25 seconds and peaked at
approximately 2 GiB RSS on this host. The installed game client was not launched;
rendering, encounter behavior and gameplay acceptance remain unverified.

The subsequent allocation/trigger pass passed 191 tests across 31 test files,
including the extended full-data check, plus four native NPC persistence
regressions. See the [policy verification record](FRONTIER_3640684_LANDSCAPE_POLICIES.md#verification)
for the current results and temporary gameplay defaults.
