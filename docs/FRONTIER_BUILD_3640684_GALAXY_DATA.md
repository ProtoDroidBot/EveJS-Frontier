# Build 3640684: server-supplied galaxy and solar-system data

**Finding: yes, the supplied client implements a server-fed universe model.**
Its normal map code requests universe data, decodes server-supplied coordinates
and hierarchy, and uses them to populate the galaxy map and compatibility
caches. This is verified by static inspection of the exact supplied client.
It is not a completed live client/server interoperability test.

At the time of this investigation, EveJS did not implement the corresponding
exploration API. The user subsequently released the hold; the implementation
and its offline verification are now documented in [Exploration API](EXPLORATION_API.md).
Serving existing legacy map replies alone is insufficient.

Recorded: 2026-10-23. This scoped, read-only verification was requested after
the original [port plan](FRONTIER_BUILD_3640684_PORT_PLAN.md). Port
implementation was deferred at the time of this investigation.

Subsequent planning decision: the user selected `3502403-MOD4-STUFF1` as
the galaxy and solar-system source for this port. The
[updated port plan](FRONTIER_BUILD_3640684_PORT_PLAN.md) defines the required
mappings and remaining gaps. References below to a candidate conversion
describe this investigation's evidence boundary; source selection is now
settled. The exploration API is now implemented; full live client/runtime
acceptance remains outstanding.

## Inputs and method

Target installation:

```text
/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier/stillness
```

`start.ini` declares build/sync `3640684`, version `20.04`, cycle `cycle-7`.
SHA-256 of the inspected `code.ccp`:

```text
2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c
```

Older comparison installation, confirmed by its `start.ini` as `3502403`,
cycle `cycle-6`:

```text
/home/ludus/EveJS-Frontier/clientbuilds/3502403-MOD4-STUFF1/EVE Frontier/stillness
```

The old directory is explicitly a modified build; it is a candidate source
for a legacy/custom world, not proof of an unmodified production dataset.

Inspection read ZIP members with Python 3.12.14, decoded code objects using
`marshal`, and inspected instructions with `dis`. Serialized protobuf
descriptor constants were parsed with the host protobuf library. No game
module was imported or executed. No client, server, native FSD loader, or
network session was started, and neither installation was modified.

The [machine-readable evidence](FRONTIER_BUILD_3640684_GALAXY_EVIDENCE.json)
records archive/member hashes, relevant symbols and embedded source-line
numbers, selected instructions, and exact protobuf descriptors. Source lines
below refer to line metadata inside archive members, not extracted source
files. No old-world record conversion or live payload acceptance was tested.

## Verified data flow

```text
Galaxy-map access / character-session initialization
    -> resolvedSystem service
    -> ExplorationMessenger
    -> public gateway: GetKnownUniverse / GetSystemDetail
    <- protobuf response with bytes payload and bundle version
    -> FlatBuffer UniverseDelta
    -> UniverseIndex + cfg universe cache shims
    -> galaxy-map coordinates and system content

UniverseRevealNotice -> same payload ingestion -> incremental map updates
```

| Link in the chain | Exact client evidence |
| --- | --- |
| Service activation | `frontier/crdata/client/resolved_system_svc.pyc`: `get_resolved_system_svc` (1470) calls `sm.GetService('resolvedSystem')`; `ResolvedSystemSvc.Run` (218) creates `ExplorationMessenger`, installs universe shims, and schedules hydration when a character/current system exists |
| Map-triggered loading | `eve/client/script/ui/shared/maps/starMapSvc.pyc`: `StarMapSvc.GetKnownUniverseSolarSystems` (154) obtains that service and schedules `start_full_hydration` (165) before accessing map data |
| Server requests | `frontier/crdata/client/exploration_messenger.pyc`: `get_known_universe` (82) constructs `GetKnownUniverseRequest` with page token/size; `get_system_detail` (123) constructs `GetSystemDetailRequest` with `solar_system.sequential` |
| Network transport | `frontier/proto_client/client/__init__.pyc`: `send_request` (8) calls `public_gateway.send_character_request` and receives a response channel; `send_user_request` (34) uses the user-scoped gateway path |
| Initial and detailed loading | `ResolvedSystemSvc.hydrate_starter_systems` (864) can use the user-scoped request before a character exists; `ensure_system_hydrated` (794) fetches system detail; `_run_full_hydration` (1063) follows `next_page.token` |
| Actual payload decode | `ResolvedSystemSvc._ingest_payload` (1214) retains payload bytes and calls `UniverseDelta.GetRootAsUniverseDelta(payload_bytes, 0)` (1246), then merges system, region, and constellation records into its index |
| Galaxy coordinates consumed | `eve/client/script/ui/shared/mapView/mapViewData.pyc`: `MapViewData.IterKnownSolarSystemMapPositions` (137) gets each FlatBuffer system, reads `Center()` (148), and yields `(system_id, x, y, z)` (149) |
| Map coordinate transformation | `mapViewUniverse.pyc`: `_map_pos` (39) computes `(-X * UNIVERSE_SCALE, -Y * UNIVERSE_SCALE, Z * UNIVERSE_SCALE)`; `mapViewConst.pyc` defines the scale as `1.5e-15` |
| Compatibility caches | `frontier/crdata/client/cfg_universe_shim.pyc`: `install_shims` (1192) replaces `mapRegionCache`, `mapConstellationCache`, `mapSystemCache`, `mapSolarSystemContentCache`, and `mapJumpCache`; the wrappers read resolved-service records |
| Location names/coordinates | The same shim's `seed_evelocations_system_rows` (1399) seeds location rows from the resolved system name/center; `mapSvc.pyc`, `MapSvc.GetItem` (124), also reads `cfg.mapSystemCache` and its center |
| Incremental delivery | `ExplorationMessenger.__init__` (59) subscribes to `UniverseRevealNotice`; `ResolvedSystemSvc._on_universe_reveal` (1001) ingests its payload and publishes map/discovery signals |

These are connected consumers and call paths, not merely unused message
names found in the archive. They establish client capability without needing
the former static geography files to supply these records.

## Exact transport and payload contracts

The public protobuf package is **`eve_public.exploration.api`**. Its requests
travel through the existing public-gateway request transport; they are not
legacy `map.GetSolarsystemItems` MachoNet calls.

| Message | Fields from the target's serialized descriptor |
| --- | --- |
| `GetKnownUniverseRequest` | `page` #1: `eve_public.Page` |
| `GetKnownUniverseResponse` | `bundle_version` #1: semantic version; `payload` #2: bytes; `next_page` #3: `eve_public.NextPage`; `total_systems` #4: uint64; `knowledge` #5: `SystemKnowledge` |
| `GetSystemDetailRequest` | `solar_system` #1: identifier with `sequential` #1, uint64 |
| `GetSystemDetailResponse` | `bundle_version` #1: semantic version; `payload` #2: bytes |
| `UniverseRevealNotice` | `bundle_version` #1: semantic version; `payload` #2: bytes; `knowledge` #3: `SystemKnowledge` |

`SystemKnowledge` contains revision/completeness, visited system IDs, and
thermal/EM detection ladders. Descriptor presence does not mean every field
is consumed by each hydration path.

The bytes payload is a **FlatBuffer `eve.universe.v1.UniverseDelta`**, decoded
directly by the inspected ingestion method. Bundled schema metadata declares
**schema version 14** and flatc `25.1.24`. A future encoder must match the
actual generated layout; this finding does not assert that the client
enforces equality to 14 at every decode.

| FlatBuffer record | Relevant contents |
| --- | --- |
| `UniverseDelta` | `SchemaVersion`, `BundleVersion`, `Complete`, `Sequence`, and vectors of `Regions`, `Constellations`, `Systems` |
| `Region` / `Constellation` | IDs, galaxy-space `Center`, `NameId`, literal `Name`; constellations also identify their region |
| `SolarSystem` | uint64 ID/region/constellation IDs; `Center`; name/name ID; radius/security; reveal state; local content and topology |
| `Vec3` | Three Float64 components, 24 bytes: suitable for galaxy-space centers without reducing them to Float32 map coordinates |
| Topology | System `Neighbours`; stargates with destination gate/system IDs; `GabrielNeighbours` with IDs and distances |
| Local content | Separate sun/planet/moon/stargate positions and other system content; these are distinct from the system's galaxy-space `Center` |

Runtime semantics also matter:

- `PackedTable.merge` in `universe_index.pyc` requires incoming rows to be
  strictly ascending by ID. A payload encoder needs stable ordering as well
  as the correct fields and type widths.
- `_ingest_page_header` tracks the response bundle version and clears cached
  state when it changes. Reveal notices for a conflicting established bundle
  version are dropped. Pagination tokens must advance.
- The FlatBuffer reveal enum is `Charted = 0`, `Visited = 1`. Local content
  completeness also has explicit scope flags and explored-ID collections.
  Sending a charted system position does not necessarily expose all its local
  detail or authorize a detail fetch.
- Initial user-scoped requests, character-scoped requests, discovery updates,
  and refused detail requests need coherent server behavior. QA-only reveal
  methods exist but are not necessary evidence for the normal map path.
- An absent system can produce fallback zero positions in legacy `MapSvc`
  access. A rendered placeholder or a zero vector would not prove that
  geographic data was successfully delivered.

## Older resource inventory and reuse implications

The resource-index comparison supports a change from bundled geography to
the server-fed model. Presence here means indexed resources/cache files were
inventoried, not that their complete decoded contents were accepted.

| Old geography source | 3502403 comparison build | 3640684 supplied build |
| --- | --- | --- |
| `systems.static` + schema | Indexed and cached | Absent from main resource index |
| `regions.static` + schema | Indexed and cached | Absent from main resource index |
| `constellations.static` + schema | Indexed and cached | Absent from main resource index |
| `jumps.static` + schema | Indexed and cached | Absent from main resource index |
| `solarsystemcontent.static` | Indexed and cached | Absent from main resource index |
| `starmapcache.pickle` | Indexed and cached | Absent from main resource index |
| `universe_distances.fsdbinary` | Indexed and cached | Absent from main resource index |
| `bin64/staticdata/mapObjects.db` | Indexed; file present | Not indexed; file absent |
| `locationcache.static` | Indexed and cached | Still indexed/cached, with a different hash |

The retained `locationcache.static` does not establish retained coordinates:
the current extractor interprets that resource as object-ID to solar-system-ID
mapping. Its new contents were not decoded in this investigation.

Candidate mappings for a future explicit legacy-world port are:

| Prior source | Target representation | Remaining decision/check |
| --- | --- | --- |
| `systems.static`: ID, `center`, region/constellation IDs, names | `SolarSystem.Id/Center/RegionId/ConstellationId/Name` and related fields | Stable ID ranges, coordinate units/axes, name/localization policy, complete parent records |
| Region and constellation static rows | `Region` / `Constellation` vectors | Hierarchy and center consistency |
| Old jump/gate sources | System neighbors and stargate destination records | Reciprocal links, destination IDs, geometry, distance-derived neighbor data |
| `solarsystemcontent.static` and `mapObjects.db` | Sun, planet, moon, gate and other local content | Type/graphic references, field mapping, object IDs, detail completeness |
| Old world identity and desired exploration rules | Bundle version, paging, reveal state, knowledge and notices | Assign an explicit legacy/custom world identity and discovery policy |

This supports **encoding a prior galaxy into the current client contract**.
It does not establish that cycle-6 coordinates, IDs, types, or topology are
the same as the official cycle-7 world. The old dataset should retain its
provenance even when served to a newer client. A decision to run that legacy
galaxy is separate from acquiring authoritative current-cycle geography.

## Current EveJS gap

The source tree has no implementation of `GetKnownUniverse`,
`GetSystemDetail`, or `UniverseRevealNotice` in its gateway services.

| Existing server surface | What it provides / what is missing |
| --- | --- |
| `server/src/_secondary/express/gatewayServices/index.ts:60` | Registers current gateway services, including map tags, but no exploration/universe provider |
| `server/src/services/config/configService.ts:161` and `:579` | `GetMultiLocationsEx` can return old static system names/positions through legacy location rows; it does not encode the new universe payload |
| `server/src/services/map/mapService.ts:553` and `:808` | `GetSolarsystemItems` serves local objects/positions through legacy rowsets |
| `server/src/services/config/configService.ts:658` | `GetMapObjects` remains an empty reply |
| `server/src/services/frontier/systemInfoService.ts:196` | `GetSystemInfo` supplies resource/danger information, not the galaxy catalog |
| `server/src/_secondary/express/gatewayServices/mapTagsGatewayService.ts:20` | Existing space-CDN update route serves map tags; its FlatBuffer contains IDs/tags rather than geographic centers |

The later implementation would therefore need an exploration gateway service,
target protobuf definitions, a schema-14-compatible universe encoder,
versioned world authority, page/detail selection, and reveal/knowledge
semantics. Existing server world tables may supply conversion inputs, but
these new replies cannot be replaced by returning old JSONL or legacy rowsets.

## Conclusion and remaining proof

Verified from the exact client: **3640684 can request, decode, cache, and
display server-supplied solar-system/galaxy information, including positions.**
The supplied 3502403 build retains the older geography sources needed to
investigate a conversion. This removes the assumption that positions must
be restored into new client static files before a legacy galaxy is possible.

Still unproven: complete old-data extraction/conversion, compatibility of its
IDs/assets/content, acceptance of an encoded payload by a running client,
and full gameplay. After implementation is authorized, the smallest useful
live proof would be an isolated, explicitly identified legacy-world sample
with region/constellation/system centers, paged map delivery, one detailed
system and a reveal update. Rendering and local placement must agree with
the source coordinates. No such implementation or live test was performed
here.
