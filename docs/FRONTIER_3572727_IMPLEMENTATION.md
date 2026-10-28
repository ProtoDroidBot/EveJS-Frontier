# Canonical 3572727 world for client 3640684: implementation and isolated validation

Implemented and verified 2026-10-27 on Linux/Node 24. The server now supports an
explicit **3572727 canonical FSD source** while retaining **client build3640684**,
Macho 489 and schema 14. A full candidate, compatible catalog baseline and isolated
runtime were built and validated. The current world has not been switched.

The [investigation](FRONTIER_3572727_GALAXY_REPLACEMENT.md) explains why the
packaged SQLite geography cannot be joined to the canonical FSD records.
The [implementation evidence](FRONTIER_3572727_IMPLEMENTATION_EVIDENCE.json)
records artifact identities, validation reports and preservation checks.

## Built candidate

Artifacts are under:

```text
/home/ludus/EveJS-Frontier/_local/frontier-worlds/3572727-for-3640684/candidate/
```

| Artifact | Purpose |
| --- | --- |
| `world.json` | Canonical source geometry, hierarchy, topology, stations and full stellar metadata; target3640684 |
| `world-build-manifest.json` | Exact client/resource/decoded-output/catalog proof hashes and conversion counts |
| `content.json` |3572727 placements with 3640684 ecosystems, dungeons, types and existing local policies |
| `mapping-report.json` | Complete retained/omitted parent decisions and preserved authored origins |
| `catalog-3640684/native-jsonl/` |22 verified native catalog tables and 122 DBuff records, extracted without geography |
| `snapshot/` | Explicit composition used by the existing database generator |
| `generated/` |155 attested fresh seed files, compatible catalogs and canonical geography |

| Content | Count |
| --- | ---: |
| Systems / regions / constellations |24,026 /274 /2,163 |
| Stars, including 8,824 companions |32,850 |
| Planets / moons / Lagrange points |42,223 /70,884 /211,115 |
| Reciprocal stargate objects / canonical stations |11,728 /224 |
| Authored sites / authored-enabled sites |137,368 /130,490 |
| Compatible ecosystems / dungeon templates |35 /393 |
| Map belts / Trojan hierarchies admitted |33,735 /119 |

All site IDs, systems, ecosystems and authored local positions were checked
against the source export. Unsafe optional belt boundaries are omitted;
13,698 belts with unproven required centers and22,234 Trojan hierarchies remain
omitted from the map hierarchy. Their encounter-site origins remain preserved.
These counts do not assert native encounter fidelity or full scope completeness.

Base-world revision:

```text
3a17c982b0a6875d77dff336dcb79e8647b5b374ccd908434dac6d812618eb64
```

Compatible-content revision:

```text
895d303f24d219c4f27287ad7b313068fab2fb4ca7e61ea167f2bdf41d1b2b57
```

Merged delivery revision:

```text
d7cf20b421bf79ac7e1f874f9ebb4876f48bc8c25b8407e5d78fe32f9d0748ea
```

## Implementation boundaries

`export-canonical-world.py` verifies exact source resources and decoded hashes,
then exports every stellar object, authored planet host, moon display ordinal,
Lagrange point, gate and station without SQLite metadata joins. The old legacy
exporter remains available. The new profile is
`3572727-canonical-fsd-v1`, source label `3572727-CANONICAL-FSD`, target3640684.
Its source identity, conversion policy and canonical input hashes are checked
by the server loader independently of the client build number.

`build-canonical-landscape.py` composes the target placement rows with the
compatible 3640684 catalogs. It derives old-parent physical proofs using the
separately pinned SQLite snapshot only as diagnostic evidence, checks new-row
parents in the canonical world, and preserves unresolved anchors explicitly.
It rejects escaped decoded-file paths, source relabeling and mismatched hashes.
The new content format is `evejs-frontier-landscape-content-v1`, with
`temporary:false` and explicit world, catalog, placement and policy revisions.

Reference projection uses canonical rows exclusively for geography and stations.
It does not inherit old names, radii, orbit indices or parents through reused
numeric IDs. Old procedural belts, sites and stations cannot enter as fallback
supplements. Canonical stations expose the aliases expected by station services.
Abstract exploration belts do not become unrelated mineable scene entities.

The complete compatible type/dogma/Creation catalogs are retained in the seed,
while the content sidecar supplies its compatible dungeon and encounter data.
The existing progression, economy and native Frontier industry implementations
and bundled policy catalogs are unchanged. The 299 native3640684 blueprint rows
and 16 facility rows are retained as explicitly identified raw catalog sidecars;
this change does not claim a new industry-recipe semantic port or import
3572727's unsupported dungeon types.

Voxel state now binds the canonical base-world, content and allocation-policy
revisions even when no content sidecar is selected. Frontier dungeon state also
has a canonical-world identity in that case. Existing legacy profile behavior
and receipts remain available.

## Runtime isolation

The dedicated launcher is:

```text
scripts/FrontierWorld/canonical-runtime.ts
```

It validates the world/content, compatible seed and every generated data-file
hash before creating storage. The default runtime directory is:

```text
_local/frontier-worlds/3572727-for-3640684/runtimes/<base-revision>-<content-revision>/
```

It contains its own `gameStore/data`, `gamestore.sqlite`, configuration, logs,
certificates, exploration knowledge and validation outputs. The ownership marker
binds complete artifact hashes and revisions. Reuse requires that exact binding.
The launcher refuses symlinks, unowned roots, protected-source overlaps,
unattested seed files and a mutable SQLite seed. It never resets a store or
imports the current world's SQLite database.

Configuration uses opt-in `EVEJS_CONFIG_DIR`; logs and certificate paths also
have runtime-local overrides. Ordinary launches keep their existing paths.
The candidate binds only loopback, uses separate ports, blocks unhandled proxy
destinations, and disables automatic Sui mutations and unrelated startup work.
Only the child created by this launcher is stopped; cleanup waits for it before
releasing the process lease. A running candidate's lease prevents another
candidate process from sharing its store.

## Validation results

| Check | Result |
| --- | --- |
| Canonical source and content builders |16 Python tests passed |
| Server, tool and test TypeScript builds |Passed |
| Focused3640684 regression driver |206 passed, zero failures/skips across 33 suite processes |
| Complete source/site audit |137,368 authored positions and memberships retained |
| Isolated production data/gateway integration |393,054 geometry comparisons;47 terminating exploration pages; authorized and refused requests checked |
| Exact unmodified3640684 FlatBuffers decoder |All 24,026 systems across47 pages;8,235,366 field checks passed |
| Independent runtime reopen |SQLite receipt and visited detail retained; duplicate visit emitted zero reveal notices |
| Production server startup |Game handshake; six loopback listeners; status HTTP 200 |
| Candidate TLS |CA-verified gateway TLS with `h2` ALPN and CA-verified XMPP TLS |
| Candidate shutdown |Clean exit 0; no process lease left |
| Existing world/configuration preservation |Previous configuration, legacy world/profile and existing certificate files unchanged |

The final server check used:

| Port | Listener |
| --- | --- |
|27600 |Game TCP |
|27601 |Image HTTP |
|27602 |Microservice/proxy HTTP |
|27603 |Public gateway HTTPS/HTTP2 |
|27604 |Status monitor |
|27605 |XMPP TLS |

The candidate is **stopped** after validation. The TLS checks trust only its
runtime-local CA; no client trust store or existing server certificates were
changed. No native game session, player login or chain transaction was started.
The full decoder check proves delivery of the checked data, not rendered
physics, combat or complete client gameplay acceptance.

## Reuse the built candidate

From the repository root, with Node 24 available:

```sh
node scripts/FrontierWorld/canonical-runtime.js --mode validate
node scripts/FrontierWorld/canonical-runtime.js --mode restart-check
node scripts/FrontierWorld/canonical-runtime.js --mode smoke --port-base 27600
```

`validate` reuses the owned candidate and a fresh validation knowledge identity;
it does not erase prior candidate state. `restart-check` reads the previous
validation's durable records in a new process. `smoke` starts and stops the
production server. Run `--mode serve --port-base 27600` only when intentionally
leaving that isolated candidate running; stop it with Ctrl+C. These commands
do not select the candidate in the existing default launcher.

On this installation, the bundled executables used for verification are:

```text
/home/ludus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
/home/ludus/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
```

The latter is Python 3.12.14, required for the exact client bytecode decoder.
`verify-canonical-client.py --client-archive <3640684-code.ccp> --wire-dir
<runtime>/client-wire --out <runtime>/client-decoder-verification.json`
rechecks the emitted full-world pages. Each expected/payload page is hashed.

For a fresh build, use new output paths and run these tools in order:

1. `export-canonical-world.py`, with the exact3572727 client, decoded canonical
   tables and3640684 catalog proofs.
2. `build-canonical-landscape.py`, with that world,3572727 placements and the
   compatible 3640684 decoded catalogs.
3. `export-compatible-catalogs.py`, using the preserved Windows Python 3.12
   runtime and disposable Wine worker, to export only compatible catalogs.
4. `build-canonical-runtime-data.mjs --world <world> --catalog <native-jsonl>
   --snapshot <new-snapshot> --out <new-generated>`.
5. The dedicated runtime launcher with explicit `--world`, `--content`,
   `--generated` and, if needed, `--runtime-root` paths. Compile TypeScript
   before invoking generated JavaScript after source edits.

## Promotion remains separate

This task built and validated an isolated candidate. It did not migrate
players, switch current-world settings, change the client build, patch native
client files, update a chain deployment or reset existing persistent state.

Before any later promotion, complete native3640684 client acceptance and choose
a fresh world or a rehearsed explicit migration. Reused planet/gate IDs can
denote different objects, so bookmarks, assemblies, docking, station/item
locations and external references cannot be copied on numeric-ID equality.
The previous artifacts and runtime selection remain the rollback boundary.
