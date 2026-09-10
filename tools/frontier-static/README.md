# EVE Frontier Static Data

This tool exports the static data embedded in an installed EVE Frontier client
into the JSONL shape consumed by EveJS. It supports the existing macOS
launcher/app layout and the Windows launcher-cache/channel layout, including
explicit Wine-backed extraction on Linux. It reads the
selected build and shared resource cache only. It does not modify the Frontier
installation, the retail EVE client, or an EveJS server database.

The extractor:

- selects an installed Frontier build from `start.ini`, or accepts an explicit
  launcher/cache/build root;
- resolves every packaged resource through that build's `resfileindex.txt`;
- checks each resolved cache file before reading it;
- probes exact external Python 3.12 with the client's paths on Windows, falling
  back to a minimal runner for its bundled `python312.dll` only when needed;
- uses the bundled Python 3.12 runtime and native FSD loaders on macOS;
- reads `mapObjects.db` in SQLite read-only mode;
- flattens Frontier landscape sites into warpable per-system metadata;
- preserves referenced ecosystem rules and complete dungeon room/object layouts
  in `landscapeEcosystems.jsonl` and `landscapeDungeonTemplates.jsonl`;
- exports every authored dungeon to `frontierDungeonTemplates.jsonl`, including
  Crude Rift entry objects, resources, transforms, triggers, and events;
- preserves modular ship templates, parts, modules, and hardpoint definitions
  used by the Frontier Creation management service;
- writes deterministic, build-numbered JSONL under `_local/frontier-sde`;
- records source and output hashes in `frontier-extraction-manifest.json`.

## Extract

Inspect discovery first:

```powershell
npm run frontier:discover -- --client-root 'C:\CCP\EVE Frontier\stillness' --build 3502403
```

Windows build `3502403` can be extracted explicitly with:

```powershell
npm run frontier:extract -- --client-root 'C:\CCP\EVE Frontier\stillness' --build 3502403
```

The existing macOS workflow remains:

```bash
npm run frontier:extract -- --build 3467658
```

One common macOS launcher root is:

```text
~/Library/Application Support/EVE Frontier
```

To inspect inputs without decoding, add `--dry-run`:

```powershell
npm run frontier:extract -- --client-root 'C:\CCP\EVE Frontier\stillness' --build 3502403 --dry-run
```

To replace a snapshot previously created by this extractor:

```powershell
npm run frontier:extract -- --client-root 'C:\CCP\EVE Frontier\stillness' --build 3502403 --force
```

The tool refuses to replace a non-empty directory unless it contains a
recognized extractor manifest.

## Validate

```powershell
npm run frontier:validate -- --snapshot _local/frontier-sde/3502403
```

Validation checks hashes, JSONL framing, key uniqueness, type/group/category
references, system/star relationships, map-object system references, and
reciprocal stargate destinations.

Landscape validation also checks that every site references an exported
ecosystem and entry dungeon, every ecosystem pattern references an exported
dungeon, and every dungeon object references a known client type.

The complete dungeon table is retained separately from landscape sites. The
Rift compatibility layer uses it to materialize persistent, client-authored
Crude Rift scenes without modifying the Frontier client or guessing object
types and placement.

Creation validation checks that every modular hull template references known
parts and modules, and that its initial interior placements and hardpoints are
complete enough to reconstruct the client management model.

## Client Contracts

The copied Frontier `code.ccp` archive also carries generated public protobuf
descriptors and the client modules that consume them. Export those contracts
without importing the game runtime or modifying the client:

```powershell
npm run frontier:contracts -- --client-root 'C:\CCP\EVE Frontier\stillness' --build 3502403
```

The build-numbered output under `_local/frontier-contracts` contains a binary
descriptor set, a JSON descriptor set, a compact field index, and an inventory
of the Frontier landscape, character, industry, scanner, assembly, and web3
modules used for compatibility research. Build `3474408` exported 163
descriptor files without failures and 239 client-module inventory rows. The
build `3467658` descriptor and module artifacts are not present in this
checkout, so those outputs cannot be claimed byte-for-byte unchanged from the
older build.

Contract export also works on Linux with native CPython 3.12, using the pure-Python
protobuf package bundled in `code.ccp`. Set `EVEJS_FRONTIER_PYTHON312` to select
an explicit interpreter; otherwise `python3.12` and `python3` are probed for the
exact required minor version. This path decodes descriptor constants without
importing the game runtime. It does not enable native Windows FSD extraction
on Linux.

Build `3502403` exports the same 166 public descriptor files and 238 client
module names as `3488090`. The binary and JSON public descriptor sets are
byte-for-byte identical; only build metadata changes in the compact index and
module inventory. See
`tools/frontier-contracts/frontier-build.3502403.comparison.json` for hashes and
validation limits.

## EveJS Input

The generated folder is intentionally compatible with:

```powershell
npm run frontier:database -- --snapshot _local/frontier-sde/3502403
```

The equivalent low-level generator invocation remains available on every
platform; the npm wrapper derives the build-numbered output from the validated
snapshot and applies the exact supported-build policy.

Frontier-specific map data that the current EveJS generator does not yet
consume is retained in `mapLagrangePoints.jsonl`, `mapJumps.jsonl`, and
`locationCache.jsonl` for the compatibility layer. The three landscape tables
provide site anchors, procedural ecosystem selections, and exact client-authored
room objects. EveJS materializes a bounded sample of renderable objects only
when a pilot reaches a site; locator records remain available as authority for
future resource, event, and POI providers.

## Windows Python fallback

The Windows resolver sets `PYTHONPATH` to `<build>\code.ccp;<build>\bin64` and
adds `<build>\bin64` to DLL lookup before probing CPython 3.12. The pinned
environment used by the setup workflow is `_local\frontier-python312`.

If required imports still fail, `frontier-python-runner-windows.c` can be
compiled with Visual Studio 2022 Build Tools and the Windows SDK. The runner
uses `LoadLibrary` and `GetProcAddress` against the exact client
`python312.dll`, so Python headers and an import library are not required. Do
not install MSVC preemptively; retain the external-probe error as evidence.

## Current build comparison

The validated `3474408` snapshot contains 24,026 systems, 113,253 landscape
sites, 32,623 types, and 7,072 stargates. Compared with the recorded `3467658`
counts, systems, sites, and stargates are unchanged and the type count increased
by 15. Because the old JSONL snapshot is not committed or available locally,
the identities of those 15 additional rows cannot be derived from the current
artifacts alone. The detailed evidence is recorded in
`tools/frontier-contracts/frontier-build.3474408.comparison.json`.

The validated `3488090` snapshot contains 24,026 systems, 113,253 landscape
sites, 32,626 types, and 7,072 stargates. Relative to the recorded `3474408`
counts, types increased by three and the other three counts are unchanged.
The exact F935/05D8 Rift entry types and triggers, Mraka Fringe Tallyport site,
and Relay construction-site authority were verified in the new snapshot.
The baseline JSONL snapshot is unavailable, so the identities of the added
type rows and other row-level changes cannot be inferred from counts alone.

The validated `3502403` snapshot has the same four headline counts and the
same game-data semantics consumed by the database as `3488090`. A client-side
jump-ID ordering change reassigns 337 `jumpID` values, but the 3,536 stargate
edges, endpoints, coordinates, and types are identical. The public protobuf
descriptor sets are also byte-for-byte identical. A fresh, build-attested
snapshot and database are still required rather than relabeling old outputs.

## Linux with Wine

Contract export uses native Linux CPython 3.12. Static extraction instead needs
the Windows client loaders and an explicitly configured Wine-backed Windows
Python 3.12; no Wine installation or runtime download happens automatically:

```bash
EVEJS_FRONTIER_WINE=/path/to/wine-or-wrapper \
EVEJS_FRONTIER_PYTHON312=/path/to/windows-python312/python.exe \
npm run frontier:extract -- --client-root '/path/to/EVE Frontier/stillness' --build 3502403
```

The Wine command receives the Python executable followed by its arguments.
It must preserve argument boundaries and forward Python stdout and exit status.
The resolver checks the exact Python minor version, native loader imports,
and a success marker. Use a disposable prefix when extracting so the game's
existing Wine prefix is untouched. Standard Wine `Z:` drive mapping is required
to reach the host input/output paths. Python's standard library takes precedence
over `code.ccp` to avoid its bundled `ctypes` conflicting with external CPython.

This host's validated `3502403` extraction used portable Windows CPython
3.12.14, the existing GE-Proton11-6 Wine runtime, and a disposable Wine prefix.
That was a read-only data extraction; the game client and its existing runtime
prefix were not launched or modified. Local interpreter and prefix paths are
temporary environment details, not portable prerequisites for this repo.
