# Elysian tools for EVE Frontier and EVE Online

For the Python 3 port and the supplied **EVE Frontier 3502403** client, start
with [Frontier compatibility and launch instructions](FRONTIER-COMPATIBILITY.md).
The historical EveJS/EVE Online workflow results below apply to their stated
builds; they do not establish Frontier server or cross-build SOF compatibility.

This folder contains a unified migration entry point and five native EVE
content tools:

- **Elysian Merge & Import** — analyze and natively verify FSD record unions,
  including destination-layout conversion for differing schema fingerprints,
  apply or roll them back transactionally, and carry the selected target into
  the FSD editor or either specialized importer.
- **Elysian FSD Workbench** — inspect, search, edit, diff, compile, and
  native-verify real `.fsdbinary` tables.
- **Elysian Item Forge** — clone published client items, choose icons visually,
  edit dogma/skills/market data, and install removable item packs.
- **Elysian NPC Dogma Workbench** — review published, hidden, configured, and
  spawn-reachable NPC hulls; selectively copy player-ship attributes; inspect
  and merge dogma effects; and install client/server Dogma transactionally.
- **Serenity Importer** — select a Serenity client and import its source-only
  ships, SOF definitions, assets, FSD, localization, server data, and market
  rows as a removable layer.
- **EVE Online Importer** — select EVE Online types or indexed resources and
  migrate their FSD, assets, SOF, localization, and supported server data.

## First run

1. Select a client with the launcher's `-Client` option, or let the suite find
   the workspace's `clients/<build>/EVE Frontier` installation. Existing EveJS
   Client Setup configuration and saved selections are also supported.
2. Double-click `tools\Launch-Elysian-Tools.bat`.
3. Choose a tool.

The first launch may take several minutes. The bootstrap locates or installs
64-bit Python 3.12, creates one isolated virtual environment, installs the
GUI/compiler dependencies, validates the selected client's native Python ABI,
and exports its FSD locally through its own loaders. Frontier 3502403 uses
Python 3.12 x64; older clients need an explicitly available matching worker.

The clean-recipient path has been exercised from an empty generated state
against EveJS v0.12.3.1: both isolated runtimes were recreated, all three GUI
packages installed, and all 149 build-3396210 tables plus the Info Bubble
projections exported successfully.

No CCP baseline data is bundled in authored project files. Generated data is
kept under `tools\.elysian-suite` on each installation.

## EveJS data locations

The tools understand the public layout, unchanged from v0.12.3.1 through
v0.12.7.1:

| Data | Location | Purpose |
| --- | --- | --- |
| Static authority | `_local\gameStore\data` | item types, dogma, ships, skills, and other server definitions |
| Runtime database | `_local\gameStore\gamestore.sqlite` | accounts, characters, inventories, and live runtime state |
| Market database | `externalservices\market-server\data\generated\market.sqlite` | published types and seeded orders |
| Client path | EveJS Client Setup configuration | FSD, localization, SOF, indexes, and ResFiles |

The static JSON authority and SQLite runtime database are not interchangeable.
Custom definitions belong in the first; spawned item instances belong in the
second.

Before deploying a published Item Forge or Serenity market pack, run:

```text
tools\market-seederv2\BuildMarketSeedV2.bat
```

Item Forge also provides a button for this. Deployment remains blocked until
the generated market database exists.

## Projects, installation, and rollback

- `.elysianfsdproj` stores schema-aware FSD deltas.
- `.elysianitempack` stores custom item identity, overrides, translations,
  dependencies, and original icon masters.
- Serenity prepares a target-specific checked bundle from the selected
  read-only source.

Applying a bundle captures a compressed hashed baseline, acquires the shared
Elysian target lock, writes a persistent transaction journal, installs
content-addressed payloads before indexes, and records exactly what it owns.
Rollback restores the previous layer byte-for-byte and removes only
bundle-owned unreferenced payloads and rows.

Item Forge and Serenity also install a fingerprint-gated public EveJS runtime
adapter as part of that same owned transaction. It adds `/elysianitems` through
EveJS's normal station-hangar grant path and maps a custom item's outbound
special-FX presentation type to its native source type. The custom type remains
authoritative for identity, inventory, fitting, and dogma; the alias only lets
the unmodified EVE client select the inherited native effect presentation.

Where both Item Forge and Serenity are installed on one target, roll them back
in reverse order of application; the tool that is not the current owner will
refuse. Always use the owning tool's **Rollback** or **Remove** action before
deleting tool files. `tools\clean.bat` refuses to clean while any shared or
ElysianRegion installation ownership record is active.

A record belongs to an EveJS folder, and the EVE client it writes into does
not. If you run two EveJS installations against one client, the folder that
applied a layer is the one that can remove it — the other sees the imported
content in the client and no record of who put it there. Serenity can be
pointed at the owning folder to remove such a layer; see *Two EveJS folders,
one EVE client* under v0.12.7.1.

## Preparing a zip

Run:

```text
tools\clean.bat
```

The script clearly lists what it will remove and asks for confirmation. It
purges only the three tools' generated runtimes, caches, build output, and the
shared bootstrap state. It does not touch the configured EVE client,
`_local\gameStore`, the market database, ClientCodeGrabber output, or any other
EveJS tool. Authored projects are preserved unless you explicitly choose to
delete them.

There is deliberately no Docker-specific path. This release targets the normal
Windows EveJS layout.

## What changed for v0.12.7.1

Only the version lists. This is the first release where three of the four
patched files are **byte-identical** to the release before it, so the anchors
were not re-read so much as inherited: `chatCommands.js`, `liveFittingState.js`
and `structureState.js` all hash the same as stock v0.12.7. Only `runtime.js`
moved, by three lines, and the change is in `listScannableEntityInventoryItems`
— native NPC wrecks now answer a cargo scan out of the loot store. That
function is nowhere near a hook site, and the patch footprint is unchanged at
31 changed lines in `runtime.js` and 69 in `chatCommands.js`.

So `VERIFIED_EVEJS_RELEASES` gained `v0.12.7.1` in both places that keep one —
Item Forge's `server_runtime.py` and the Serenity importer's
`fitting_runtime.py`. The Serenity list is still the narrower of the two, and
still says so: it claims v0.12.7 and v0.12.7.1 because those two files are the
same bytes, not because a second reading was done.

Four other things in v0.12.7.1 were checked and touch nothing these tools rely
on:

- **`gameStore/seedStaticTables.js` is new**, and it copies shipped static
  tables into a store that lacks them on startup. It writes **only missing
  tables**, by its own rule, so it cannot overwrite a table an Elysian layer
  has edited — every table the tools touch already exists in the store. The
  direction is the opposite of the collision that would matter.
- **The market schema is unchanged.** All four tables the market adapter writes
  — `market_types`, `seed_stock`, `region_summaries`, `system_seed_summaries` —
  have identical columns to v0.12.7.
- **`gameStore/index.js`, `sqliteStore.js` and `tableOwnership.js` differ almost
  entirely in line endings**, plus one new runtime table
  (`researchRuntimeState`) in the ownership map. None of it is a static table
  or a path the tools resolve.
- **The research agent service and the market server's Rust `state.rs` split**
  are new content and test reorganization respectively, in code no adapter
  reads.

Verified by running `tests/test_evejs_release_compatibility.py` with
`EVEJS_VERIFY_ROOT` pointed at a fresh v0.12.7.1 install, and by building the
Serenity fitting payloads against the same tree: both `liveFittingState.js` and
`structureState.js` patch with no entry in the skip list.

### Service modules and Standup weapons fit the imported citadels

Reported from a live install: a **Standup Market Hub I** could not be fitted to
an imported structure, its *Can only be fitted to* list naming eleven
Tranquility citadels and none of the Serenity ones. A **Standup Cloning Center
I** fitted fine. So did some Standup weapons, and some did not.

The split is how each module is written. The Cloning Center says "Citadel,
Engineering Complex, Refinery" — a *group* restriction, and the eight imported
structures sit in the target's own groups, so they were already covered. The
Market Hub names each structure by *type*, and nothing was adding the imported
ones to that list.

Two reasons, and both are fixed:

- **Structures were not hulls.** The repair that grows a shared module's
  restriction to accept an imported hull only ever looked at ships. A fitting
  restriction does not know the difference — EveJS checks a module against
  whatever it is being fitted to — so the rule now covers ships and structures
  both. Seven shared modules were affected: Market Hub I, Capital Shipyard I,
  Guided Bomb Launcher I and II, Point Defense Battery I and II, and Arcing
  Vorton Projector I.

- **Twelve slots was not enough room.** EveJS reads a module's allowed hulls out
  of `canFitShipType1` through `canFitShipType12`, which is the whole of
  Tranquility's dogma table. Serenity's runs to `canFitShipType20`, and its
  Market Hub uses seventeen of them. Eleven of the target's twelve were already
  spoken for by Tranquility's own citadels, so six of the imported ones had
  nowhere to go. The import now carries Serenity's `canFitShipType13..20`
  attribute definitions, and a **fifth server patch** raises the number EveJS
  reads from 12 to 20 to match.

That fifth patch appears in **Server code patches** as *Structure service module
fitting slots*, alongside the four already there, and comes off with the rest of
the layer. On a tree with no Serenity import it admits not one additional value:
an attribute name the dogma table does not define resolves to nothing and is
skipped, which is what already happens to `canFitShipGroup13` on a module that
names four groups.

Measured on the current build pair, every restriction that needs a repair now
gets one and none are reported unreachable.

### The Presidential command bursts fit a Colossus, and nothing loses a fit to it

Reported from a live install, in Chinese: a Presidential Mining Foreman Burst
refused to fit, dialog reading *Command Burst cannot be installed*, right after
the ordinary bursts had been fixed.

This one was not the importer's doing. Serenity's own data names the Xolotl,
Stellian and Physeter on every command burst, Tech I through the faction ones,
and on none of the three Presidential ones, which were added after the
Physeter. A faithful import reproduced Serenity exactly, and on Serenity that
burst does not fit a Physeter either. The decision was to depart from that
data for these three modules only. Each Presidential burst now accepts
whatever its Tech II sibling accepts among the hulls you import. The
Information and Skirmish bursts gain the Xolotl, Stellian and Physeter. The
Mining Foreman Burst gains the Physeter, because that is all the Tech II
Mining Foreman Burst names. Leave the Physeter out of a selection and nothing
is added for it. Every such slot is listed in the build report under
`authoredFitRestrictions`, with the sibling it was read from, so what is
Serenity's data and what is not stays visible.

Working out how to carry that turned up a defect in the earlier fix, worth
knowing about if you applied it. Tranquility added a twelfth group slot to
every command burst after Serenity's build, group 5120, four hulls Serenity
does not have. The earlier repair replaced the whole dogma record with
Serenity's, which lacks that slot, so on a target with that import applied
those four hulls could not fit a command burst. The repair now grows the
target's own record by the slot that names the imported hull and never
replaces a record that carries something Serenity's does not. That moved 23
modules from whole-record replacement to the narrower path. The narrower path
also reaches the client now, not only the server, so the fitting window and
EveJS read the same slots, and the build gate fails if the two compilers
disagree about them.

**If you have an import applied, roll it back, rebuild, re-apply**, in that
order, for the same reason as before: a pack built over an applied layer bakes
that layer's records into itself.

### An imported SKIN now brings its paint, and its name

Two defects, reported together as "this crescent SKIN crashes the game", with a
screenshot of a hangar entry reading `[no messageID: 1018132]`.

**The paint was never staged.** A SKIN's colours live in a
`graphicmaterialsets` row, and that row also names up to eight art files — a
faction, a pattern, and six materials. The importer staged the faction and
nothing else, because it had been written down here and in the code that a
material set was "four colours with no file behind it". That is true of the set
a hull's stock livery uses and false of most of the ones a SKIN uses. Crescent
Bloody Moon's set names `patterns/bloodmoon` and two `bloodmoon_*` materials,
and the target had none of the three. The row installed anyway, so the client
was handed a livery pointing at art nobody had put there, and wearing it took
the client down.

All eight fields now stage, through the same closure a hull's geometry uses.
Across the 188 SKINs in scope that is 185 files the target was missing. Four
names resolve in neither build — three materials, plus one where Serenity's own
table has a trailing space in the name — and those stay warnings: a hull is
worth more than one of its paint jobs.

**The names were never carried.** `[no messageID: 1018132]` is the client
saying it has the SKIN and not its name. A SKIN's name is a message ID on its
material, and the three cosmetics caches sit outside the tables the importer
walked for text, so 181 of the 188 installed unnamed. 139 names and blurbs now
travel with them, in all nine client languages.

If you already applied a layer that installed SKINs, roll it back and re-import
to pick both up. The rollback is unchanged.

### Serenity liveries for hulls you already fly

Serenity paints ships Tranquility also has, and 150 of those paint jobs have no
row in the target at all — Orca, Machariel, Procurer, Tatara, Ansiblex and the
Christmas and New Year one-offs, across 98 hulls you have been flying all
along. None of them is for a Serenity-only ship, which is exactly why no
earlier version could see them: a SKIN reaches the import through the hull it
dresses, and these dress hulls the import does not install.

There is now a switch for them, in the Serenity window under **Serenity SKINs
for hulls you already have**, and `--target-hull-liveries` on the command line.
It is **all or nothing** and **off by default**: leave it alone and you get
exactly the pack this tool built before, byte for byte. Turn it on and the
liveries install the same four records the Serenity-hull skins do, through the
same catalogue, the same client caches and the same rollback.

Two things to know before you take them:

- **32 of the 150 are structure liveries** — Keepstar, Fortizar, Astrahus,
  Azbel, Sotiyo, Raitaru, Tatara, Athanor, Ansiblex, Pharolux. They install
  correctly and **there is no known way to wear one**: nothing in EveJS reads
  `isStructureSkin`, and applying a skin starts from a ship. They are included
  because the records are right and cost a catalogue entry each, not because
  they do anything. The window marks every one of them, and the build report
  counts the 118 ship liveries and the 32 structure ones separately.
- **This is the first time an import writes into records your own hulls use.**
  98 of the target's hulls gain entries in the client's SKIN browse list. The
  merge only adds and the rollback restores whole files, so removing the layer
  takes exactly those entries back out.

### Imported SKINs now reach the client, and stop it crashing

If you imported skins with an earlier build of the importer, the ships got
their paint jobs on the server and nowhere else. Opening **Personalization →
SKINs** on any hull showed *No SKINs* under both headings, and once anything
granted one of those licences — `/allskins` most likely — the tab stopped
opening at all, with `KeyError: 'No Static Data'` in the client log.

Both symptoms are one cause. EveJS's cosmetics catalogue says a licence exists
and which hull it dresses, but the client never asks it: it resolves every skin
ID against its own `res:/staticdata/skins.static`, and a skin it has no row for
throws rather than being skipped. The import wrote the catalogue and left the
client's three cosmetics caches alone, so the imported skins existed for the
server and not for the client.

The importer now writes them: `skins.static`, `skinlicenses.static` and
`skinmaterials.static`, staged the same content-addressed way a hull's geometry
is and removed by the ordinary rollback. Against the real pair that is 6955 →
6993 skins, 11784 → 11822 licences and 859 → 893 materials — the same numbers
the catalogue already reported, which is the point. A licence or material the
target already had is left as it is.

Two details you may notice:

- **The browse list works.** *Other available SKINs* is driven by an index
  inside that cache file rather than by the server, which is why it was empty
  even for hulls whose skins the server knew about.
- **Imported skins are marked visible on Tranquility.** They ship marked
  Serenity-only, and a Tranquility client silently ignores those. This is the
  one value the importer invents rather than copies.

**If you are already in this state**, roll the layer back and re-import. There
is no need to undo the grants by hand first — but do not open the SKINs tab
until you have, because the crash is the client refusing to resolve a skin it
was told it owns.

### Two EveJS folders, one EVE client: removing the other one's layer

Point two EveJS installations at the same client — an upgrade tested beside the
copy you play, most obviously — and only one of them can remove what it
installed. The layer is written into the shared client, and the record that
describes it stays in the folder that applied it, keyed and stored by
repository root. The other folder cannot see it, so the Serenity window reports
the target as unowned and the audit finds nothing to import: every type is
already in the client's FSD, which is the truth, and reads like a broken tool.

Two changes, and neither one alters a single-installation setup:

- **The audit says why it found nothing.** An empty result is impossible
  against a clean target — every seed category has Serenity-exclusive published
  content — so the summary now names the likeliest cause instead of leaving an
  empty tree to be read as a bug.
- **A rollback can be pointed at the folder holding the record.** In the window
  that is *Remove a layer from another folder…*, beside Remove and enabled only
  when this folder does not own an import layer; on the command line it is
  `elysian-serenity-importer rollback --target . --owner <the other folder>`.

It is refused unless that record's layer was applied to the client this folder
is configured to use, which is the only thing that makes it your business. The
whole layer then comes off — the owning folder's server files and market rows
along with the shared client — because they are one baseline and one record,
and a half-removed layer is worse than one nobody could remove. Every other
refusal is unchanged: another tool's record, the server-patch-only layer, and a
target that has drifted since the apply are all still turned away.

Close EveJS and the client in **both** folders first. And when you do have two
installations on one client, prefer rolling back from the folder that applied
the layer; this is the way out of the case where you cannot.

## What changed for v0.12.7

Nothing in the tools had to change. The anchor checks introduced for v0.12.6
are what made that possible, and this is the release that tested them: both
patched files were edited upstream, and every hook site survived.

`runtime.js` gained about 500 lines and `chatCommands.js` about 55, all of it
the new `/spawnsite` command and its dungeon content. The counts the adapter
pins are unchanged — ten `effectState` and two `presentationEffectState` module
bindings, eighteen `moduleTypeID:` sites in total, and all four helpers the
injected command handler calls. The patch applies with the same footprint it
has on v0.12.6: 31 changed lines in `runtime.js`, 69 in `chatCommands.js`.

The line-ending profile moved, and the splicing encoder handles it without a
change. On v0.12.7 `runtime.js` is uniform CRLF across all 55,427 lines, where
v0.12.6 carried 33 LF lines among them; `chatCommands.js` carries 296 LF lines
among 12,589 CRLF. Both files come out of the patch with their LF counts
exactly as they went in.

Four other things in v0.12.7 were checked and touch nothing these tools rely on:

- **Content packs are new.** They are data-only, versioned, and loaded at
  startup, with their own registry. `contentPackManager.js` makes no reference
  to `itemTypes`, `typeDogma` or `elysianItems`, so an installed pack and an
  Elysian layer do not see each other. Content packs are not a replacement for
  the runtime adapter either: they cannot patch server code.
- **The game store gained `dungeonClientContent`**, in both `tableOwnership.js`
  and the database creator's required-table list. The Elysian item manifest
  reads its own JSON directly through `fs` and never goes through the store
  loader, so table ownership does not apply to it.
- **The market schema is unchanged.** `market_types`, `seed_stock`,
  `region_summaries`, `system_seed_summaries` and `stations` all have the same
  columns, and the database is still at
  `externalservices\market-server\data\generated\market.sqlite`.
- **The client build is unchanged** at 24.01 build 3396210, so every FSD
  profile, export and compiler gate carries over untouched.

### Serenity installs a second server patch, for the Colossus springboard

The dogma overlay carries the turret's effect across, and stock EveJS then
ignores it. Serenity's Colossus mounts an XL turret through a two-stage shape:
the hull pre-assigns `ColossusRoleBonus1Springboard` (attribute 5550) at -99
onto every fitted item requiring a named capital turret skill, and effect 11933
on the turret post-percents its own `power` by whatever 5550 then holds —
137,500 MW becomes 1,375, against the Crescent's 14,755. Stage one works on
stock EveJS. Stage two does not, because
`applySelfAdditiveModifiersFromLocationSources` in
`server/src/services/fitting/liveFittingState.js` admitted a self-modifier row
only at ModAdd, and Serenity's is the same shape at PostPercent.

Serenity now installs that rule itself, as
`server-runtime:src/services/fitting/liveFittingState.js`. It is an anchored
splice like the other two, in the same artifact class, captured in the same
baseline — so it drift-checks before apply and unwinds with everything else on
rollback. It is a Serenity-only layer: Item Forge does not install it.

The patch was read against v0.12.7 only. Two anchors pin it — the self-modifier
operation gate, verbatim, and the pass's own declaration — plus the seven
symbols the spliced rule calls.

**A hook site that has moved does not refuse the import.** This is the one place
the suite skips rather than blocks, and deliberately: everything else in a
Serenity bundle is correct without this rule, so an unqualified EveJS release
still gets its hulls, modules, art and market rows. What it loses is the
springboard, and every XL turret goes on asking for its full powergrid. The skip
is reported in `prepared-bundle-report.json` under `fittingRuntime`, repeated by
`apply-bundle`, and raised as a dialog by the GUI. If you see it, qualify the
adapter against that release rather than living with it.

A target that **already carries the rule** in its own source keeps it. The
importer adds any other missing fitting rule around it, and rollback restores
the complete pre-apply file, including the rule that was already there.

### The Stellian drone cap is part of the same removable layer

The Stellian hull and its Drone Link Augmentor apply `charID` `ItemModifier`
rows to attribute 352, `maxActiveDrones`. EveJS's fitting snapshot admitted
only ship-domain rows, so it dropped both bonuses. Launch and reconnect then
used their five-drone fallback. The observed limits were 5 with or without the
module. Serenity expects 6 and 8.

The importer now patches `liveFittingState.js` to put that existing base of
five into the snapshot and admit only character-domain modifiers whose
destination is attribute 352. It does not globally project `charID` effects
onto ships. An online Stellian Drone Link Augmentor adds two; an offline one
adds nothing. The same rule also restores the Guardian-Vexor's matching bonus.

Living Universe versions with off-grid mining drones have one more consumer in
`server/src/services/drone/droneDogma.js`. When that anchored hook exists, the
importer changes it to read `buildShipResourceState` too. Both files are staged
as `server-runtime:` artifacts, captured in the normal baseline, drift-checked
on removal, and restored byte for byte on rollback. Older EveJS releases lack
that off-grid path and need no second file.

### Imported structures can be deployed again

Reported from a live install: every Serenity citadel and engineering complex was
refused at deployment with *"That structure type is not supported by the current
deployment service"*, while sitting quite happily in the client, the market and
the player's hangar.

It is not an allowlist. `structureState.js` seeds a `structureTypes` catalogue
**once**, from the category-65 static rows, the first time a server boots with
that table empty, and never consults the static table again. A server that had
already booted therefore carries a catalogue frozen at that moment, and the
eight structures the importer adds afterwards are simply not in it —
`getStructureTypeByID` returns nothing, and deployment refuses. A tree imported
before its first boot never hit this.

A third patch now reconciles the catalogue against the static table on every
cold start, in the pass EveJS already uses to backfill it. It only ever **adds**:
a row already in the catalogue keeps whatever is in it, so an operator's edits
survive, and no row is ever removed. It joins the same removable layer as the
two fitting rules and rolls back with them.

If you would rather not patch, the equivalent one-off is to delete
`_local/gameStore/data/structureTypes/data.json` and restart the server, which
makes EveJS re-seed the catalogue from scratch. The rows are entirely derived
data and deployed structures live in a different table, so nothing is lost —
unless you have hand-edited that file, in which case use the patch.

### The server patches can be installed without importing anything

All three rules are useful to a server that is not importing Serenity's ships: a
fork that already carries one of them and wants the others, or a tree whose pack
was built while a hook site had moved and shipped without them. **Apply missing
server patches** in the GUI, or `apply-server-patches` on the command line,
installs exactly the patches the target is missing and nothing else — no ships,
no market rows, no client resources.

It is a proper layer, not a shortcut around one. It takes its own ownership
record and its own baseline archive under the project
`serenity-server-fitting-rules`, so it stacks with everything else and comes
off with **Remove server patches** (`rollback-server-patches`), restoring the
server source byte for byte. A full Serenity import may be installed on top of
it and removed again in the usual order. Neither rollback path will touch the
other's record.

Two things it will not do. It **will not take ownership of a target it has
nothing to change**: a rule that is already present is dropped from the plan,
and a plan with nothing left reports that and stops. And it **will not offer a
patch whose hook site is in a mixed state** — the row reads *Incomplete*, the
adapter refuses to guess, and the button stays dark.

### If you already applied the server patches, you can just update them

A tool update can add a patch to a layer you have already installed — which is
exactly what the structure-catalogue patch above is. When that happens the new
row reads *Not applied yet* and the button changes to **Update server patches**
(`apply-server-patches` does the same thing from the command line).

That removes the installed layer and puts a new one on in a single action, so
the server source is restored and re-patched from one baseline, and whatever the
layer was sitting on — a full Serenity import, an Item Forge pack — is recorded
as its parent again exactly as before. There is no need to remove and re-apply
by hand. A layer that is already carrying every patch is left alone; the button
reads **Remove server patches** and does only that.

You still need to restart the EveJS server afterwards. The structure catalogue
is reconciled when the server starts, so a patch applied under a running server
takes effect on its next boot.

### Modules the target already has now accept the hulls they were built for

Reported from a live install: command bursts would not fit the Colossus hulls,
and entropic disintegrators would not fit the Dziewanna or the ★Tiamat. These
are Tranquility modules the target already owns. What they were missing is the
line in their own dogma record that names the Serenity hull — Serenity's copy
of the module has it, Tranquility's does not, and the import was not carrying
the difference.

It is carried now, on both halves. Measured against the export pair used to
develop it, 64 modules refuse at least one imported hull, across 165 (module,
hull) pairs, and all 165 are repaired. 39 of those modules get Serenity's whole
dogma record — client and server — because that record differs from the
target's in fitting slots and nothing else. 75 more needed only EveJS's copy of
a record both clients already agreed on. A module whose record diverges further
gets the restriction alone, server-side, so that no balance change rides in
under a fix about what fits where.

Five modules needed a slot as well as a value. Serenity extended the range of
fitting slots with attributes Tranquility never defined, and EveJS reads a
fixed list of slot names, so a restriction sitting in `canFitShipType20` is one
the target cannot read at all. Those move to a slot the target defines and was
not using. Nothing is ever written over a restriction the target owns, and a
restriction that cannot be placed is reported rather than dropped quietly.

*Revised for v0.12.7.1: the whole-record replacement described above could
drop a slot Tranquility had added after Serenity's build, and the
restriction-only repair reached the server but not the client. Both are
corrected; see the v0.12.7.1 notes.*

Two of the five Colossus hulls, the Gabriel and the Crescent, are on no command
burst's list in Serenity's own data. Those two never fit one, and that is
Serenity's design rather than something the import lost.

**If you already have an import applied, the order is: roll back, then build,
then apply.** All of this is data, so it reaches a target only through a new
layer. Roll the old one back *before* preparing the new bundle, not just before
applying it — `prepare-bundle` transplants into the target's files as they are,
so a pack built while the previous layer is applied has that layer's records
baked into it. The importer will not stop you: unlike Item Forge, it does not
replace its own layer, so a second bundle applied over the first stacks on it
and then needs two rollbacks to come apart.

Type IDs do not move in this change, so ships in hangars, assembled fits and
saved selection files all survive the cycle. What does not survive is market
activity: rolling back discards the market rows for the imported types, live
orders included, and re-applying re-seeds them from the plan. That is the
standing limitation of rolling back a played server, not something new here.

### Roll back before you upgrade EveJS

Upgrade the emulator with no Elysian layer applied. An upgrade rewrites server
source and regenerates the static authority under `_local\gameStore`, but it
does not know about the ownership record, so an applied layer survives the
upgrade pointing at files that are no longer the ones it captured.

Rolling that layer back afterwards would restore the old release's patched
server files over the new ones. All three tools now refuse it: before touching
anything, each compares every target it recorded against the digest it
installed and stops if one has moved, naming the files. Serenity has always
done this; Item Forge and FSD Workbench would previously have restored the
previous release's server code without saying so.

The refusal is not a failure state — nothing has been changed when you see it.
It does mean the layer cannot be removed by the tool that applied it, because
its baseline is older than the target. Reinstall the emulator release the layer
was applied to, remove the layer there, and upgrade with the target unowned.

## What changed for v0.12.6

The importer never carried a version string. Its only tie to v0.12.3.1 was in
the server runtime adapter that Item Forge and Serenity both install, and two
things in that adapter had to change.

**It gated on a whole-file SHA-256** of `server/src/space/runtime.js` and
`server/src/services/chat/chatCommands.js`. Both files change in every release,
and in any fork or mod, so the gate refused an install even when every hook
site was untouched. It now checks the hook sites themselves — the require
blocks, the ten `effectState` and two `presentationEffectState` module
bindings, the allowed-command and help entries, the create-item handler and the
give-item route — plus the four helpers the injected command handler calls.
All of them are identical on v0.12.3.1 and v0.12.6. A layout change is refused
by name and count instead of by an opaque hash mismatch.

**It re-encoded each whole file to one line ending.** EveJS source is mixed
CRLF/LF within single files: on v0.12.6 `runtime.js` carries 33 LF lines among
55,975 CRLF, and `chatCommands.js` 248 among 12,918. The old encoder flattened
every one of those 281 lines, which buries a 76-line patch inside a 281-line
diff and is rejected outright by that tree's `tools/eol-guard.js`. The adapter
now only splices text in; each inserted line takes the ending of the line it
follows, and no line the patch does not touch is rewritten.

**The manifest module moved** from `server/src/services/inventory/` to
`server/src/_secondary/elysianItems/`. `secondaryServiceLoader.js` only
auto-discovers files named `server.js`, so it stays inert until one of the two
patched files requires it — and it is no longer a core file that has to be
reconciled at the next upstream release.

## More than one tool on the same target

All the tools install into one shared ownership record, so only one of them is
the target's owner at a time. Any of them may layer over any other, to any
depth, recording the owner it found as its parent installation. The stack
unwinds strictly in reverse: each tool refuses to roll back unless it is the
current top owner, and each captures the ownership record in its own baseline
so a rollback restores the layer beneath rather than orphaning it.

The single policy lives in `elysian_fsd/ownership.py` and refuses three things,
all of them about whether the stack could come apart again rather than about
which tool wrote what. A record held outside the shared installation state
(ElysianRegion keeps its own) is not a file any baseline captures, so there
would be no way to restore it. An owner left mid-operation is somebody's
unfinished business and should not be buried under another layer. And a project
may not layer over itself — that is a replacement, and both builds write the
same files, so the lower baseline would be stranded underneath the upper one.
Item Forge rolls its own bundle back and re-applies for that case instead.

FSD Workbench used to refuse every owner outright and could not participate at
all; Item Forge accepted only a Serenity import underneath, and Serenity only an
Item Forge bundle.

Item Forge also recovers types that exist only in the server authority
documents. Serenity writes its ships there and into compiled client FSD
binaries, but it does not refresh the cached JSONL export under
`tools\.elysian-suite`, and that export is keyed by a build number an import
does not change. Imported hulls are listed as **(imported)**. Their attributes
and effects are read from the server and clone correctly; their icons and any
client-only fields are unavailable until the export is regenerated.

### Content drift no longer locks the build

A build profile records each of the 149 FSD tables' logical path, generated
loader, schema fingerprint and content MD5. The first three describe the binary
layout the encoders bind to; the MD5 only says the table is byte-for-byte what
CCP shipped. Comparing all four as a write gate meant that importing anything —
which is the entire point of these tools — marked the build `incomplete`, and
Item Forge then refused every pack with:

```text
[BLOCK] build: Build 3396210 does not match an exact writable profile.
```

even with 149/149 tables mutation-verified and the item encoder passing 8/8.
Content drift is now reported as drift. A changed schema fingerprint, loader or
resource path still blocks, and the compiler proofs remain the write gate.

Item Forge also names the reason now instead of just refusing, so a genuine
layout change is distinguishable from an imported client at a glance.

### Serenity imports ships, and the modules only those ships can fit

Superseded in part. The plan is still seeded from category 6, and the walk still
follows only what a ship's own record points at — `*typeID` fields and skill- or
type-valued dogma attributes. A hull does not reference the modules that fit
into it, so that walk alone reaches no category 7 item.

Two things now cross anyway, both because the reference runs the other way:

- **The dogma overlay** carries an effect onto a module the target already has.
  This is what lets a Colossus mount an XL turret; all fifteen turrets exist on
  Tranquility at Serenity's own powergrid values, so nothing new is created.
  See the v0.12.7 notes.
- **Hull-restricted modules** are Serenity-only items whose
  `canFitShipType`/`canFitShipGroup` restriction names a hull this import
  installs. `audit.py::hull_restricted_type_ids` follows that restriction back,
  and no further, so a Marauder no longer arrives without its bastion. Eight
  qualify against build 3416949: the Sacribis Bastion, Stellian Triage Module,
  Physeter Industrial Core, the Crescent's `'Moonlight'` Disruptive Lance,
  Mordu's Legion Rapid Torpedo Launcher, the Stellian Drone Link Augmentor,
  `"Dr. Gale"` damage control, and `'The Oldest'` Fighter Support Unit.

Seven of the eight are locked to one hull and can be fitted nowhere else. The
Fighter Support Unit is restricted by ship *group* rather than type, so it fits
every Tranquility carrier as well; the audit labels it `group` and warns.

`verify-install` used to fail an otherwise healthy install of these, because it
asserted `len(serenity_type_ids) == 23` — a literal from the ships-only era,
against a set that is now 31. The set is read out of the record's own
`allocatedIds`, so its size never said anything about the installation; what
does is that every allocated type is present in the server authority, which
`serverChecks` already asserts. The report now names the field
`installedTypeIDs` (it always held modules too) and adds `installedTypeCount`.

The rest of category 7 is still out of scope, and deliberately so. A module the
target has no icon or graphic for would import as an invisible item, so the
audit refuses one rather than staging client art through a path that has no
native render gate. That refusal is what keeps this a companion import instead
of a category 7 port.

*(Partly superseded — see "Serenity imports faction modules, precursor rigs and
charges" below. Modules are now also seeded by rule, and an icon is staged
rather than refused; a missing model is still refused.)*

### Serenity now imports drones, fighters, structures and MTUs too

Supersedes the seeding half of the section above. The plan is seeded from five
categories rather than from category 6 alone: ships, drones, deployables,
structures and fighters. On build 3416949 that is 74 types — 23 ships, 36
drones, 8 structures, 4 mobile tractor units and 3 fighters — plus the same 8
hull-restricted modules, for 82 grants and 73 market rows.

They qualified on the same evidence: their `graphicids` rows are the same shape
as a ship's, and every SOF root derived from them resolves in the Serenity
index, so they need no new art mechanism. What they did need:

- **A fighter gets a `fighterAbilities` record.** Without one the squadron
  launches with no abilities and reports nothing, so the compile checks it and
  `verify-install` checks it again on the installed tree. The document is
  written only when the bundle carries a fighter.
- **Only ships get a `shipTypes`, `movementAttributes` or
  `shipDogmaAttributes` row.** EveJS reads all three for category 6 alone and
  falls back to `typeDogma` for everything else, so a drone row there would be
  a row nothing reads in a document a database rebuild regenerates.
- **A structure gets no market row.** It has no market group. Every imported
  type is granted; only what can be seeded is seeded.
- **A graphic the target already has is reuse, not a conflict.** Four types
  share a stock model — the drone Hammerhead II (SF) and three Enhanced Mobile
  Tractor Units. The audit compares the two builds' rows and refuses only a
  real disagreement.

One thing is knowingly left behind. `spacecomponentsbytype` is named by every
one of the 51 non-hull types, and the two builds encode that table differently,
so records cannot be copied between them. EveJS's server never reads it, and
none of the target's own published ships has a row — but all of its drones,
structures, deployables and fighters do, and nothing has yet established what a
drone does in space without one. The bundle report names the gap under
`tablesNotCarried`.

### Serenity imports what you pick, not all of it

The importer's list is now grouped by category, shows each type's client icon,
and every type has a checkbox. Select and deselect freely; the build carries
what is ticked. Nothing else about a bundle changes — a partial import is still
one layer, with one ownership record, and it rolls back the same way.

Three things are deliberately not checkboxes:

- **A hull-restricted module follows its hull.** It reached the plan by having
  its fitting restriction traced back to a hull this import installs, so it is
  carried when that hull is and dropped when it is not. The list shows which
  hull each one follows, and says so before the build rather than after it.
- **The turret dogma overlay follows the selection.** It is derived from the
  effect closure of whatever is picked. Turning it off would not import fewer
  things; it would import the same things inert.
- **The fitting rule is always installed.** Without it the imported turrets ask
  for their full Tranquility powergrid and will not fit. It already skips
  itself, with a reason, when its hook site has moved.

A blocked type can no longer stop a build, because it can no longer be
selected. Before, one type the target could not accept refused the whole
import; now deselecting it is an answer.

To add to an existing import, roll the layer back and build again with the
wider selection. The importer already replaces its own layer rather than
stacking on it, so this is the supported path and not a workaround.

### Serenity imports faction modules, precursor rigs and charges

Two new sections in the list, and both are checkboxes rather than consequences.
On build 3416949 a full import installs **187 types** — the same 74 modelled
ones, plus 113 modules and charges — with 118 market rows, 1,535 artifacts and
the same 82 native models as before, since none of the new types has one.

- **Modules — 80.** Sixty faction modules (meta group 4) and twenty precursor
  weapon rigs. The rigs' two groups, 4784 and 4789, are absent from the target
  entirely, and their bonuses land on group 1986, which the target already has
  with its own twenty Entropic Disintegrators — so a rig fitted to a stock
  Tranquility hull does something.
- **Charges — 28**, of which 26 install. The two `Serenity 20 years Firework`
  charges are refused: their `graphicids` rows name a model file under
  `res:/dx9/model/turret/launcher/holiday/`, and this path stages no 3D art.

Three things made it possible, and two of them fixed something that was already
wrong rather than only adding scope:

- **Icons are staged now.** An `iconids` row and the PNG it names are carried
  together, content-addressed, with an acceptance gate proving every inserted
  row resolves in the applied target. Fourteen files cross. Before this the
  rows were copied and the files were not — which had been true since the first
  import, for groups, effects and attributes, and was masked by the module
  path refusing any absent icon outright.
- **A colour is not art.** Every charge names a `graphicids` row that is four
  floats of tracer colour. Refusing those refused nineteen of the twenty-eight
  charges over a data row.
- **An effect can name a type.** `OwnerRequiredSkillModifier` carries its skill
  inside `modifierInfo`, where nothing in the carrying type's record points at
  it. Selecting a Mech Drone damage amplifier without the drones used to
  install an effect keyed on a skill the target does not have.

No new skill is imported: all ten the modules require and all seven the charges
require are already in the target. One type is excluded by name — `84237`,
published by Serenity as `Unused Rig`, in a seeded group, with no market group.

The `spacecomponentsbytype` gap above is unchanged, and the live gameplay check
it calls for is still open.

On the command line the same scope is a file, and every build command takes
`--selection`:

```
elysian-serenity-importer compile-sof <source> --selection runtime/selection.json
```

Give it to all five build commands or none. `prepare-bundle` cross-checks the
four compiled reports against its own audit, so a selection that reached only
some of them fails the build instead of shipping a mismatched pack. The GUI
writes the file once and points the whole run at it. The bundle report records
the scope under `selection`, because the selection file itself is runtime state
and does not travel with the pack.

`compile-sof --type-id` still works as a one-off shorthand, and now behaves
better: it used to drop module and dependent art staging wholesale, because
there was no way to narrow it. Those now follow the selection.

### Two things no code change fixes

- **A database rebuild wipes the import.** `tools/DatabaseCreator` regenerates
  `itemTypes`, `shipTypes`, `typeDogma`, `skillTypes`, `movementAttributes`,
  `shipDogmaAttributes` and `fighterAbilities` — the same seven documents the
  importer writes into. Re-apply the bundle after any rebuild.
- **The generated state is large and lives in a tracked directory.**
  `tools\.elysian-suite` reaches roughly 1.2 GB of virtual environment, Python
  2.7 runtime and FSD exports. Add it to `.gitignore` before the first run.
