# Legacy-world exploration API for build 3640684

The exploration API serves geography from `3502403-MOD4-STUFF1` using the
protobuf and schema-14 `eve.universe.v1.UniverseDelta` contracts bundled with
client build `3640684`. The implementation hold was released by the user.
This implements the exploration portion of the
[port plan](FRONTIER_BUILD_3640684_PORT_PLAN.md); it does not establish live
acceptance of the full cycle-7 client port.

## Generate and select the world

Use Python **3.12** to read the selected client's Python bytecode and FSD
loaders. The exporter reads the original files without patching them, verifies
resource size/MD5 against their index, and records SHA-256 provenance. SQLite
is opened read-only. It does not import or replace the simulation database.

```bash
python3.12 -B tools/frontier-static/export-exploration-world.py \
  --client-root '/home/ludus/EveJS-Frontier/clientbuilds/3502403-MOD4-STUFF1/EVE Frontier/stillness' \
  --source-label 3502403-MOD4-STUFF1 \
  --starter-system 30000004 \
  --out _local/exploration-world-3502403.json
```

System `30000004` contains the source's lowest-ID station, `64000001`, matching
the existing Frontier database creator's bootstrap selection rule. Other
starter systems must be supplied explicitly and exist in the exported world.

Build the server, then set this variable **in the server process environment**:

```bash
npm run build:server
export EVEJS_EXPLORATION_WORLD_PATH="$PWD/_local/exploration-world-3502403.json"
```

Start the server through its existing launcher with that environment. The
provider is lazy and requires this explicit artifact. Missing configuration
returns `503 EXPLORATION_WORLD_NOT_CONFIGURED`; invalid data returns `503
EXPLORATION_WORLD_INVALID`. There is no fallback to conventional EVE Online
seed data. The artifact is loaded once per server process: restart after
selecting a new export. Keep the exact source label and source/target builds.

Before live use, the active simulation must contain the same legacy IDs,
positions and topology. A character's current system absent from the artifact
returns `409 EXPLORATION_SESSION_WORLD_MISMATCH`; matching IDs alone do not
validate simulation coordinates or cross-cycle catalog meanings. This API
does not migrate characters, stations, objects or chain state.

## Endpoints and discovery policy

| Contract | Behavior |
| --- | --- |
| `eve_public.exploration.api.GetKnownUniverseRequest` | Before character selection, returns only configured starter systems. For a selected character, returns all legacy systems as a charted map, with actual visited systems marked visited. Each page carries required parent regions/constellations. |
| `eve_public.exploration.api.GetSystemDetailRequest` | Returns local detail only for a visited system. The trusted current session location can establish a visit; requesting an arbitrary system does not. Unknown systems return 404; unavailable detail permission returns 403. |
| `eve_public.exploration.api.UniverseRevealNotice` | A newly recorded visit publishes a character-scoped detail delta and full knowledge snapshot after state is saved. Duplicate visits do not create another revision or notice. |

Visits are synchronized when a valid exploration request observes a new
server-session system. Server code can also call `revealSystem(identity,
systemID)` on the runtime for an authoritative visit event. This method is
not a public client request. Historical travel is not inferred from legacy
static files. Completed authoritative directional, passive, fitted and remote
scans now update the persisted Thermal/EM detection and resolution ladders.
Scanning a remote system does not grant a visit or local-detail permission.

Page size defaults to 128 and accepts 1–512 (`0` means default). Tokens bind
the user, character, world revision, knowledge revision, page size and offset,
and are HMAC-signed with a per-process secret. Empty `next_page.token` ends
pagination. Changed, forged, cross-character, stale or pre-restart tokens
return `400 INVALID_EXPLORATION_PAGE_TOKEN`; begin again with an empty token.
All pages report the number of systems in that identity's map view.

The `sha256-typed-f64-v1` digest determines the semantic bundle version,
shared by protobuf metadata and the FlatBuffer payload:
`1.0.0+legacy-3502403-mod4-stuff1.<contentRevision>`. The typed digest has the
same result in Python and JavaScript regardless of JSON number formatting.
IDs and counters on the wire are uint64;
the selected legacy world is constrained to positive safe integer IDs for
compatibility with the current server's session and table keys. The encoder
itself supports the full uint64 range without Number truncation.

`UniverseDelta.complete` remains false because pages/detail are partial
updates, and `sequence` is the current knowledge revision. `SystemKnowledge`
is a complete snapshot of the identity's saved visits and detection state,
so its `complete` is true. That does not imply that every system was visited
or that local celestial/resource content is complete.

## Identity, storage and notices

The current local gateway uses a **single-account loopback identity bridge**:
the HTTP/2 socket peer must match an authenticated live TCP session. The
claimed character must belong to that account's live session. Missing,
disconnected, remote, ambiguous multi-account or foreign-character contexts
fail with 401. Request-envelope IDs and forwarded headers alone confer no
authority. Notice consumers are checked again at delivery and pinned to their
initial authenticated account.

This is a local emulator trust boundary, not bearer authentication. Processes
on the same host share loopback peer authority. Do not expose this bridge
through a reverse proxy; remote/multi-account deployment needs verified
gateway credentials. This restriction applies to the new exploration service.

Knowledge is stored atomically at:

```text
<active gameStore root>/exploration/<world revision>/<userID>-<characterID>.json
```

The root follows `EVEJS_GAMESTORE_DATA_DIR` via the existing store-root resolver.
State survives restart and is isolated by source revision, user and character.
Back up the exploration directory with the rest of the store. Corrupt or
unwritable state fails with 503. Notice delivery failure does not undo a saved
visit; subsequent hydration returns the saved knowledge.

### Scan discovery and simulation integration

For build 3640684 with `EVEJS_EXPLORATION_WORLD_PATH` set, the shared reference
reader projects solar systems, stars, planets, moons, Lagrange points and gate
connections from the same validated artifact used by the exploration gateway.
Scene, travel and map readers using `referenceData` therefore receive the same
IDs and exact positions. Existing station, landscape and belt content is
retained only within systems belonging to the selected world. These local
simulation supplements do not become claims of complete retail exploration
coverage. Changing the selected artifact requires restarting the server.

Directional scans, fitted scanners, passive scanners and completed remote
system scans now feed persistent thermal/EM detection ladders. Only trusted
server scan evaluators can record discovery; RPC request IDs cannot reveal
knowledge. Resolved observations also imply detection. A detection does not
grant a visit or permission to request remote system detail. Repeated
observations are idempotent; new knowledge increments the revision, invalidates
old page tokens and emits a character-targeted `UniverseRevealNotice`.
Visit-only saved records remain readable with initially empty ladders.

The remote resource index now includes voxel asteroid observations using the
committed mining ledger's remaining quantity and yield type. Per-asteroid
observations supplement field aggregates; they do not overwrite a whole field
with only its materialized members. Private dungeon visibility is retained.
Native survey scans and composite recipe/mined-cell RPCs remain the channels
for precise local stock and deformation. The schema-14 `Site` table has only
ID, type, position and ecosystem fields, so quantity and mined bitsets are not
invented as extra FlatBuffer fields.

## Mapping coverage and remaining gaps

The optional [temporary 3640684 landscape profile](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md)
now adds decoded belts, clusters and verified-parent Trojans to the base export.
It preserves every authored site position in the server content tables, while
omitting unresolved planet links from map hierarchy. Its revision becomes part
of the effective exploration bundle identity, keeping knowledge separate from
the unmodified legacy export. The omissions described below apply to the base
export when that sidecar is not selected.

The exporter and adapter preserve region/constellation/system IDs, parent
links, literal names, raw galaxy centers, available system/star fields,
planet/moon local placements and orbital metadata, and stargate references.
Gate adjacency is distinct from geometric Gabriel neighbors. The client's
map transform `(-X, -Y, +Z) * 1.5e-15` is not applied by the server.

NPC stations, authored sites, asteroid belts, Gabriel geometry and some newer
stellar fields lack a completed conversion. All source Lagrange IDs, type IDs and local positions are retained under
their planets; absent names and point indices are not guessed.
Scope flags remain conservative, and absent geometry is not fabricated as
zero coordinates. The exact emitted/omitted fields are defined in
`explorationWorld.ts` and the export's coverage metadata.

Legacy type, graphic, localization, faction and template IDs still need the
cross-cycle catalog audit in M4/M5/M12 of the port plan. An ID retained from
3502403 is not proof that 3640684 gives it the same meaning. This API adds no
client patch, native hook or launcher-default promotion. Its selected geography
now supplies the shared simulation reference adapter described above.
Rendered map/space, gate travel and full gameplay remain live acceptance work.

The user's report of voxel-like asteroid/vein behavior in build `3640684` is
now corroborated by the [feature audit](FRONTIER_BUILD_3640684_FEATURE_AUDIT.md):
composite recipe/mined-set calls, voxel-change notices, regolith ore-unit data
and separate `BeginScoop/CancelScoop` calls are present. Mining deformation, collectible material
and pickup/inventory behavior are implemented by the separate voxel mining
runtime, with atomic pickup inventory transactions and durable mined state.
Asteroid belts and ore sites remain omitted, with `OreScopeFull` false.
The [port plan's mining work](FRONTIER_BUILD_3640684_PORT_PLAN.md#asteroidvein-mining-and-tractor-collection)
records the required mappings and acceptance cases. Full engine/mutation
rendered behavior and key binding remain to be verified in the native client.

Read-only inspection of the supplied 3502403 `solarsystemcontent.static`
schema confirms that its system and planet records have no asteroid-belt,
trojan or site fields. Those live in the separate `landscape.fsdbinary`
resource. Its old feature-to-site relationship is not automatically a proof
of the target's belt-to-cluster-to-site relationship. The current export does
not synthesize cluster IDs or Lagrange point indices. This remains an explicit
boundary of the original exporter. The temporary sidecar instead uses the
decoded target's authored feature/cluster/site IDs, with the selected galaxy's
verified system/planet references and explicit reports for unresolved links.

The installed 3640684 client does contain the separate landscape, ecosystem
and dungeon binary datasets and their loaders. Their availability, hashes,
root counts and changed schemas are recorded in the
[landscape resource verification](FRONTIER_BUILD_3640684_LANDSCAPE_DATA.md).
The remaining boundary is decoding and mapping these files to the selected
legacy world, not missing client resources.

The broader audit found a shared gateway notice-target incompatibility outside
the exploration message schema. The port now uses the target descriptor's
bounded scalar fields for build 3640684; F01 records the original wire
counterexample. Passing offline schema/handler tests does not establish native
client compatibility.

## Verification

```bash
npm run build:server
npm run build:tests
npm run test:frontier-exploration
python3.12 -B -m unittest discover \
  -s tools/frontier-static/test -p test_exploration_world_export.py
```

The focused suite covers the recorded target protobuf descriptors, uint64
boundaries, FlatBuffer field/struct layout, actual-world projection, source
validation, pagination and tampering, user/character separation, detail
authorization, atomic persistence, notices and failure handling. Tests use
temporary state and do not start the game server or client.

`frontierExplorationDiscovery.test.ts` additionally covers ladder persistence,
no implicit visit grants, token invalidation, migration from visit-only state,
canonical reference projections, signature-channel mapping, committed voxel
depletion and private-instance filtering (five tests).

The server and test TypeScript builds passed, along with all 39 focused
JavaScript checks and nine Python exporter checks. The offline HTTP/2 test
exercises the production gateway with unrelated simulation dependencies
stubbed; it does not claim a complete running-server test.

On 2026-10-26, the full selected-source export passed its hierarchy, local
ownership, finite-coordinate and reciprocal gate checks:

| Exported records | Count |
| --- | ---: |
| Regions / constellations | 274 / 2,163 |
| Systems / stars | 24,026 / 24,026 |
| Planets / moons | 83,130 / 148,167 |
| Lagrange points retained in source artifact | 415,650 |
| Gates / directed neighbor links | 7,072 / 7,072 |

The ignored local artifact is 223,252,396 bytes. Its content revision is
`2891c2ce747671b3e43dd20f886f4b8227bd19b9e8ac33c2112892c6b699c810`;
file SHA-256 is
`7fc5f2e8389232c0419bde94226f54de235bece1e89bf8cee570b48e3062044a`.
These describe this selected modified source, not a stock-build fixture.

The production loader validated that artifact and encoded every system's
optional fields against schema 14. Complete map walks returned all 24,026 IDs
exactly once in 47 pages at size 512, both with starter-only visited knowledge
and with all systems visited. The largest fully visited page payload was
2,855,904 bytes. The target client's actual generated Python accessors also
decoded system `30000004` from the runtime, with matching galaxy/star positions,
object counts, scope flags and bundle identity.

An additional offline check loaded the supplied target's actual generated
Python FlatBuffer accessors and decoded a fixture covering all 175 table
fields: 943 comparisons passed. This checks the pinned target wire layout;
it is not a running-client or gameplay acceptance result. The original
[descriptor evidence](FRONTIER_BUILD_3640684_GALAXY_EVIDENCE.json) identifies
the source archive used for those contracts.
