# Build 3640684 landscape resource verification

Verified 2026-10-26 against the supplied installation. **The client contains
landscape, ecosystem and dungeon datasets**, plus their native loaders and
supporting dungeon datasets. They are cached resource files outside `code.ccp`.

The subsequent [temporary integration](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md)
has now decoded every row with the exact native loaders and mapped the content
to the selected legacy galaxy. It preserves authored positions and omits
unresolved planet links, as requested. The inventory below remains the source
fingerprint record.

`stillness/resfileindex.txt` and `resfileindex_prefetch.txt` map each logical
`res:/staticdata/…` path to a hashed file under the installation's `ResFiles/`.
All five files exist, have the indexed byte length, and match the indexed MD5.
SHA-256 hashes and exact paths are recorded in the
[machine-readable evidence](FRONTIER_BUILD_3640684_LANDSCAPE_EVIDENCE.json).

| Resource under `res:/staticdata/` | Bytes | cFSD root entries | Local verification |
| --- | ---: | ---: | --- |
| `landscape.fsdbinary` | 29,213,672 | 23,846 | Present, size and hash match |
| `ecosystem.fsdbinary` | 15,312 | 35 | Present, size and hash match |
| `dungeons.fsdbinary` | 10,838,544 | 393 | Present, size and hash match |
| `dungeonassetmanipulations.fsdbinary` | 20,352 | 199 | Present, size and hash match |
| `dungeonenvironmenttemplates.fsdbinary` | 264 | 2 | Present, size and hash match |

Counts above come from validated cFSD root-index headers. They are not a count
of rendered objects, complete galaxy systems or accepted gameplay encounters.
The five matching `*Loader.pyd` modules are present under `stillness/bin64/`
and in the resource cache. `code.ccp` contains 62 landscape/ecosystem/dungeon
related Python modules; it does not contain these binary datasets as members.

The actual target bytecode also identifies the content model:

- `get_landscape_for_system(solar_system_id)` looks up landscape by system ID.
- Landscape records expose asteroid belts and Trojans, with sites and clusters.
  Sites carry `ecosystemID` and position; clusters carry site membership.
- Ecosystem patterns reference `dungeonID`, weights and occurrence limits;
  entry patterns specify beacon, cloud and post-process type IDs.

This is placement-capable data, not just generic definitions. The evidence is
from `frontier/landscape/common/data/__init__.pyc`, including the root lookup
at embedded source line 77. Binary row bodies are now decoded, and all 136,443
source site positions have been checked against the temporary mapped profile.

## Implication for the port

The data is available locally and decoded. The temporary mapping is implemented;
unresolved cross-cycle planet references remain explicitly omitted from map
parent links. Full era 6 cycle 7 data will replace this temporary arrangement.

All three principal cFSD schema fingerprints differ from the selected
`3502403-MOD4-STUFF1` files. The old decoder/schema must not be applied to the
new bytes without conversion validation:

| Dataset | Selected legacy root entries | Target root entries | Schema fingerprint |
| --- | ---: | ---: | --- |
| Landscape | 23,736 | 23,846 | Changed |
| Ecosystem | 20 | 35 | Changed |
| Dungeons | 5,055 | 393 | Changed |
| Dungeon asset manipulations | 93 | 199 | Same schema, changed content |
| Dungeon environment templates | 2 | 2 | Same schema and indexed content hash |

The selected legacy galaxy remains the world authority. The temporary profile
records an explicit crosswalk for systems, sites, ecosystems, dungeon references,
item types and the new exploration belt/cluster model, including omitted parents.
The legacy `solarsystemcontent.static` exporter omitting these sidecar datasets
does not mean the installed client lacks them. Likewise, file presence alone
does not establish cross-build compatibility or a complete galaxy export.

The initial inventory read files only. The subsequent export executed exact
native loaders in an isolated process, without changing the installation,
launching the game, or replacing the selected galaxy.
