# NPC Dogma Workbench implementation plan

## Outcome

Add an **Elysian NPC Dogma Workbench** that inventories the NPC hulls available
to the selected client and EveJS installation, shows both published and hidden
types, compares an NPC with a player ship, and creates reviewable changes to
the NPC's `typeDogma` attributes and effects.

The tool must be safe for single-record and batch work. It must not publish a
hidden type, erase NPC combat behavior, or leave the client FSD and EveJS
runtime data at different revisions as a side effect of copying ship data.

The proposed implementation is a separate PySide6 application under
`tools/ElysianNpcDogma`. It should reuse the build discovery, native export,
compiler verification, locking, transaction, ownership, and rollback support
in `tools/ElysianFSD/elysian_fsd` rather than add another FSD writer.

## Existing system and constraints

The relevant authorities are:

| Authority | Role |
| --- | --- |
| Client `types` and `groups` FSD | Type identity, category/group, name, graphics, and `published` state |
| Client `typeDogma` FSD | Per-type `dogmaAttributes` and `dogmaEffects` assignments |
| Client `dogmaAttributes` FSD | Attribute names, units, defaults, data type, display metadata, and publication state |
| Client `dogmaEffects` FSD | Effect definitions, categories, flags, attribute references, and modifiers |
| EveJS `typeDogma/data.json` | Runtime projection consumed by Dogma, fitting, movement, and related services |
| EveJS `itemTypes/data.json` | Runtime projection of type identity and publication metadata |
| Authored NPC tables | `npcProfiles`, spawn pools/groups, loadouts, startup rules, dungeon references, and capital NPC authority |

`tools/DatabaseCreator/database-creator.ts` already creates the runtime
`typeDogma` projection. `tools/ElysianFSD/elysian_fsd/general_compiler.py`
already has verified encoders for resizing both `dogmaAttributes` and
`dogmaEffects` vectors. `deployment.py`, `transaction.py`, and `ownership.py`
provide the transaction primitives this tool should use.

The generated runtime representation is not identical to the client source:

- Client `typeDogma` stores attributes as `{attributeID, value}` and effects as
  `{effectID, isDefault}`.
- EveJS currently stores attributes in an ID-to-value map and effects as an
  array of effect IDs. The `isDefault` value is discarded by
  `typeDogmaRecord()`.

Preserve the existing `effects: number[]` field for runtime compatibility and
add an `effectEntries: { effectID, isDefault }[]` field during this project.
The Workbench must always retain the complete client form even if a current
runtime consumer only reads the ID list.

### Observed Frontier 3502403 baseline

The available 3502403 snapshot is useful for sizing, not as a hard-coded
catalog:

- 43,775 total types.
- 6,187 category 11 (`Entity`) types: 18 published and 6,169 hidden.
- 583 category 6 player ship types: 17 published and 566 hidden.
- 4,618 category 11 types have at least one assigned effect, spanning 70
  distinct effect IDs.

Category 11 is not synonymous with “NPC ship.” It also contains containers,
collidable structures, sentry guns, terminals, and other entities. Conversely,
some EveJS NPC profiles intentionally use a category 6 player hull. The tool
must therefore display these independent facts for every row:

1. client publication state;
2. client entity classification;
3. references from current EveJS NPC configuration;
4. whether the type is reachable from a spawn pool, startup rule, or dungeon;
5. whether a complete `typeDogma` row is available.

The scan must derive counts from the selected live target every time. The
figures above belong only in diagnostics and test expectations for build
3502403 fixtures.

## Scope

### Included in the first releasable version

- Review published and hidden NPC/entity types without changing publication.
- Include configured NPC hulls referenced by EveJS even when their client
  category is 6.
- Filter by publication, classification, group, faction/name, type ID,
  configured/unused, spawn-reachable, changed/unchanged, and data health.
- Compare one NPC target with one player ship source.
- Apply a source ship's selected attribute values to one or more NPC targets.
- Set an explicit value or remove an attribute from a target.
- Review, add, merge, replace, or explicitly remove selected effect
  assignments while preserving `isDefault`.
- Show a semantic before/after diff and a raw `typeDogma` diff.
- Save portable, target-fingerprinted change projects.
- Compile and verify the client `typeDogma` FSD with the selected client's
  native loader.
- Generate the EveJS runtime projection from the verified semantic output.
- Install client and server artifacts in one recoverable transaction and
  support exact rollback.
- Offer equivalent scan, validate, apply, and rollback CLI commands for tests
  and automation.

### Deliberately excluded

- Changing the `types.published` flag.
- Editing global `dogmaAttributes` or `dogmaEffects` definitions in the normal
  workflow.
- Copying a player's modules, fitting, skills, or inventory.
- Treating an NPC as player-fittable solely because it now has slot counts.
- Automatically rewriting `npcProfiles`, loadouts, behavior profiles, or
  `npcFittingRestrictions`.
- Hot-reloading static Dogma into an already running server.
- Importing effect definitions from a different build without an explicit
  cross-build conversion and review.

These boundaries keep the operation about assignments on NPC type rows. The
impact report may identify related authored data that shadows the new values,
but it should not silently modify that data.

## Catalog and classification

### Build one joined catalog

Create `catalog.py` to load the current exports of `types`, `groups`,
`typeDogma`, `dogmaAttributes`, and `dogmaEffects`. When an EveJS root is
selected, also load:

- `npcProfiles` and capital NPC authority;
- `npcSpawnPools` and `npcSpawnGroups`;
- `npcStartupRules` and dungeon authority;
- configured presentation and player-fitting hull IDs where present.

Each catalog row should include:

- `typeID`, name, group/category, published state, race and graphic/SOF hints;
- classification: `npc_ship`, `player_hull_used_by_npc`,
  `structure_or_container`, `other_entity`, or `unresolved`;
- profile IDs and reference counts;
- spawn reachability and the paths that make it reachable;
- current attributes and effects;
- missing/dangling-reference diagnostics;
- whether server configuration contains fitting restrictions that can shadow
  slots, CPU, or powergrid.

The inventory view should initially select `npc_ship` and
`player_hull_used_by_npc`, but “All category 11 entities” must remain
available. This prevents a container from accidentally receiving ship fitting
attributes without making it impossible to inspect unusual types.

### Player-ship source catalog

Player-copy sources are current-build category 6 types with a valid
`typeDogma` row. Both published and hidden ships remain selectable and their
status is visible. Manual source selection is authoritative.

Source suggestions may be ranked using, in order:

1. an authored `playerFittingHullTypeID` or known presentation/hull mapping;
2. exact SOF hull or dependable graphic identity;
3. race and hull-class compatibility;
4. normalized name tokens and group-name hints.

No suggestion should be applied automatically. Shared placeholder graphics,
NPC variants, and names such as “Raven” in a longer NPC name make heuristic
matches unsafe.

## Attribute model

Resolve attributes by canonical name from the selected build and retain the
resolved ID in the project. Do not assume IDs are stable across builds. For
Frontier 3502403, the core preset is expected to resolve as follows:

| Preset | Canonical name | Expected ID | Copy rule |
| --- | --- | ---: | --- |
| Fuel | `fuelCapacity` | 5633 | Non-negative finite value |
| High slots | `hiSlots` | 14 | Non-negative integer |
| Medium slots | `medSlots` | 13 | Non-negative integer |
| Low slots | `lowSlots` | 12 | Non-negative integer |
| Engine slots | `engineSlots` | 5652 | Non-negative integer |
| Rig slots | `rigSlots` | 1137 | Non-negative integer |
| Powergrid | `powerOutput` | 11 | Non-negative finite value |
| CPU | `cpuOutput` | 48 | Non-negative finite value |
| Launcher hardpoints | `launcherSlotsLeft` | 101 | Non-negative integer |
| Turret hardpoints | `turretSlotsLeft` | 102 | Non-negative integer |
| Calibration | `upgradeCapacity` | 1132 | Non-negative finite value |
| Rig hardpoints | `upgradeSlotsLeft` | 1154 | Non-negative integer |

`fuelCapacity` is intentionally not the legacy `capacity` (38) or
`specialFuelBayCapacity` (1549). Normal cargo capacity currently comes from
type metadata rather than a `typeDogma` value on the Frontier ships in the
observed snapshot, so it is outside a Dogma-only edit.

Offer additional opt-in presets:

- **Durability:** `hp`, `shieldCapacity`, `armorHP`, shield recharge, damage
  resonances, and structure/armor resonances.
- **Capacitor:** `capacitorCapacity` and capacitor recharge.
- **Navigation:** mass, agility, maximum velocity, signature radius, and warp
  speed multiplier.
- **Targeting:** maximum target range, maximum locked targets, scan
  resolution, sensor type/strength, and scan/radar/ladar/magnetometric values.
- **Drone/fighter:** drone capacity, bandwidth, fighter capacity/tubes, and
  only the related limits present on the selected source.

The user can also add any current-build attribute through an advanced picker.
Definition publication state, unit, data type, default value, and description
must be shown there.

### Attribute operations

Represent every edit as one of:

- `set-from-source`: materialize the selected source value on each target;
- `set-explicit`: materialize a reviewed numeric value;
- `remove`: remove the target assignment and expose the definition default;
- `no-change`.

Absent source attributes must never become zero implicitly. The user chooses
skip, explicit value, or removal. Preserve all attributes that are not in the
change set and write the final vector in ascending `attributeID` order.

The validator should identify related-value inconsistencies without silently
changing them. Examples include `rigSlots` versus `upgradeSlotsLeft`, a turret
or launcher count larger than high slots, and nonzero drone bandwidth with no
drone capacity.

## Dogma effect model

Effects are a first-class tab beside attributes, not an unchecked “copy all”
option.

For each source and target effect show:

- effect ID, name, display name, definition publication state, and
  `isDefault`;
- effect category and offensive/assistance/warp-safe flags;
- duration, discharge, range, falloff, tracking, resistance, usage-chance,
  and activation-chance attribute references;
- every `modifierInfo` entry, including domain, operation, modified and
  modifying attributes, group, effect, and skill references;
- a classification such as NPC combat/behavior, player hull bonus, passive,
  activation, or unknown.

The default operation is **merge selected source effects while preserving all
target-only effects**. Replacement of the complete target vector belongs
behind an advanced warning. Removal must always be explicit.

This default is important because NPC rows commonly carry effects such as
`targetAttack`, `missileLaunchingForEntity`, NPC repair, electronic warfare,
or behavior effects. Player hull rows can instead carry skill-based ship bonus
effects. Replacing one complete vector with the other can disable an NPC or add
a bonus whose required skill context does not exist for an NPC.

Merge by `effectID`. If source and target use the same effect ID with different
`isDefault` values, report a conflict and require a choice. Preserve source
`isDefault` exactly when adding an effect and preserve target ordering for
unchanged entries; append new entries in deterministic effect-ID order.

### Effect dependency validation

For every resulting effect assignment:

1. require its definition in the current build's `dogmaEffects` table;
2. validate all top-level referenced attribute IDs;
3. validate every modifier's modified and modifying attribute IDs;
4. validate referenced skill types, groups, and nested effect IDs;
5. warn when a modifying attribute is absent from the target and has no
   meaningful definition default;
6. warn when a player skill bonus is assigned to an NPC with no demonstrated
   skill context;
7. block dangling references, duplicate effect IDs, invalid `isDefault`
   values, and unsupported effect shapes.

The first release attaches existing current-build effect definitions only. A
project opened against another build must re-resolve effects by canonical name
and compare their full definitions. ID equality alone is not sufficient for a
cross-build apply.

## Review workflow and UI

Use a four-pane workflow:

1. **Target inventory:** searchable NPC/entity grid with publication,
   classification, configuration, spawn reachability, and health badges.
2. **Source ship:** searchable player-hull selector with match suggestions and
   a clear manual override.
3. **Attributes and effects:** side-by-side current/source/result values with
   checkboxes for the exact assignments to change.
4. **Change basket:** all target changes, validation messages, impact paths,
   and semantic/raw diffs.

The normal sequence is:

1. Select the current client and EveJS root.
2. Scan the exact target and review unresolved or stale server references.
3. Filter published, hidden, configured, spawnable, or all ship-like NPCs.
4. Select one or more targets and a player-ship source per target or batch.
5. Choose attribute presets/individual attributes and effect assignments.
6. Review the per-target result; no value is committed at selection time.
7. Validate and save a portable project.
8. Compile, native-load, and compare the candidate.
9. Apply the verified client and server artifacts transactionally.
10. Restart the client/server processes before testing changed types.

For batch work, every row must retain its resolved source and resulting value;
the project must not store an ambiguous instruction such as “copy the best
matching cruiser.”

## Project and change-set format

Use a new `.elysiannpcdogma` project containing authored deltas, not exported
CCP baseline data. The manifest should include:

- format/schema version and project UUID;
- selected build and build-profile fingerprint;
- client resource logical path and original semantic hash;
- EveJS runtime authority hash when server sync is enabled;
- target type IDs plus their publication/classification snapshot;
- resolved source type ID for each target;
- attribute operations with canonical name, resolved ID, before value, and
  requested result;
- effect operations with effect ID/name, full assignment entry, and definition
  fingerprint;
- warnings explicitly acknowledged by the user;
- creation/update timestamps and free-form notes.

Before compile or apply, rebase the project against the live target. Unchanged
baselines proceed; drifted rows receive a three-way conflict view. Never apply
the saved “before” state over a newly changed target without review.

## Validation and impact analysis

Validation has three levels.

### Record validity

- All values are finite and match integer/unit expectations.
- Attribute and effect IDs resolve in the selected build.
- No duplicate attribute/effect assignments exist.
- Effect entries preserve the exact `{effectID, isDefault}` schema.
- Required `typeDogma` vectors are sorted/deterministic.
- A missing target row is created only by the dedicated verified
  `typeDogma` record adapter, never by copying unrelated binary bytes and
  patching optimistically.

### Semantic consistency

- Slot/hardpoint and rig/calibration relationships are plausible.
- Fuel, CPU, and power values are non-negative.
- Effects have complete dependencies and do not unintentionally remove NPC
  behavior effects.
- The target remains classifiable and its publication flag is unchanged.
- Batch targets have explicit sources and no unresolved conflicts.

### Runtime impact

The report must distinguish a successful data write from actual runtime use:

- `server/src/services/fitting/liveFittingState.ts` reads slots, CPU,
  powergrid, and hardpoints from `typeDogma` for player-style fitting.
- `server/src/services/dogma/dogmaService.ts` uses Frontier `fuelCapacity`.
- `server/src/space/npc/npcFittingService.ts` can use
  `npcFittingRestrictions.roleSlots`, `cpuOutput`, and `powerOutput` instead of
  the target row. These are shadowing values and must be reported.
- NPC behavior and combat may depend on NPC-specific effects and attributes,
  so preserved assignments are part of the acceptance gate.
- Static tables are cached; applying data does not promise live hot reload.

The Workbench should say “written but shadowed by profile restriction” rather
than implying a slot or resource change is active when another authority wins.

## Compile, server projection, installation, and rollback

### Candidate build

1. Re-export/read the current client resource through the native loader.
2. Apply the semantic change set to a copy of its decoded `typeDogma` records.
3. Compile with the verified build-profile encoder.
4. Load the compiled resource through the selected client's native
   `typeDogmaLoader`.
5. Assert every requested value/effect, row count, unchanged peer record, and
   expected semantic hash.
6. Produce the EveJS runtime JSON from that verified semantic result, not from
   a second independent edit path.
7. Verify `effects` and `effectEntries`, counts, attribute metadata, and source
   provenance in the generated server artifact.

If a target lacks a `typeDogma` row, add a table-specific adapter that creates
the 24-byte root record and its two typed vectors using a schema-compatible
template, then proves the result with the native loader. Until that adapter's
compiler proof passes for the target build, such rows remain reviewable but
not writable.

### Apply

Require the client and EveJS processes to be stopped. Under the shared Elysian
target lock:

- verify current target hashes and ownership again;
- capture the exact client resource/index and server JSON baselines;
- stage the content-addressed client payload and updated resource index;
- stage the generated EveJS `typeDogma/data.json`;
- write a persistent journal;
- replace all artifacts as one transaction;
- write an ownership receipt only after every verification succeeds.

Any failure restores all staged targets. Rollback restores the captured files
byte-for-byte and refuses when their installed hashes drifted. The new tool
must participate in the same ownership rules as Item Forge, Serenity, Merge &
Import, and the FSD Workbench so layered tools cannot unknowingly overwrite one
another.

Offer a **server-only export** for development review, but label it as a
non-installed artifact. Normal Apply keeps client and server Dogma aligned.

## CLI surface

The GUI should call the same application service used by commands resembling:

```text
python -m elysian_npc_dogma scan --server <evejs-root> --format json
python -m elysian_npc_dogma validate <project.elysiannpcdogma>
python -m elysian_npc_dogma diff <project.elysiannpcdogma>
python -m elysian_npc_dogma apply <project.elysiannpcdogma> --server <evejs-root>
python -m elysian_npc_dogma rollback --server <evejs-root>
```

`scan` and `diff` are read-only. `apply` must use the same compile proof,
process, ownership, and transaction gates as the GUI.

## Proposed code layout

```text
tools/ElysianNpcDogma/
  pyproject.toml
  Launch-Elysian-NPC-Dogma.bat
  elysian_npc_dogma/
    __init__.py
    __main__.py
    catalog.py
    classification.py
    models.py
    presets.py
    effects.py
    changes.py
    validation.py
    compiler.py
    server_projection.py
    deployment.py
    cli.py
    ui/app.py
  tests/
```

Also update:

- `tools/Launch-Elysian-Tools.bat` with a Workbench menu entry;
- `tools/ElysianToolSuite/Bootstrap.ps1` to install/launch the package;
- `tools/ELYSIAN-TOOLS-README.md` with usage, ownership, restart, and rollback
  guidance;
- `tools/DatabaseCreator/database-creator.ts` to preserve `effectEntries`;
- the relevant DatabaseCreator and runtime tests.

Keep catalog, change-set, validation, projection, and deployment logic free of
Qt so it can be tested and used by the CLI.

## Implementation phases

### Phase 1: read-only inventory and proof fixtures

- Add build-3502403 fixtures containing a published NPC ship, hidden NPC ship,
  non-ship category 11 entity, configured category 6 NPC hull, player source,
  missing Dogma row, NPC behavior effects, and player bonus effects.
- Implement joined catalog loading, classification, filters, current server
  reference graph, and source suggestions.
- Deliver the scan CLI and read-only GUI inventory.

Exit gate: every selected-client NPC/entity is accounted for exactly once,
published and hidden totals match the native export, and stale server
references are reported rather than dropped.

### Phase 2: attribute and effect change engine

- Implement build-resolved presets and the advanced attribute picker.
- Implement exact attribute set/remove behavior.
- Implement effect merge/replace/remove behavior with `isDefault` retention.
- Add dependency traversal, shadowing/impact analysis, deterministic diffs, and
  portable project serialization/rebase.
- Extend the runtime projection with backward-compatible `effectEntries`.

Exit gate: pure unit tests cover conflict behavior, missing values, duplicate
  detection, dependency failures, effect collisions, and deterministic output.

### Phase 3: verified compilation

- Adapt the existing general `typeDogma` compiler for the Workbench change
  set.
- Add and prove arbitrary missing-row creation if required by the live scan.
- Native-load the compiled candidate and compare all changed and collision-peer
  rows.
- Generate server data only from the verified semantic candidate.

Exit gate: edit existing attributes, append/remove attributes, append/remove
effects, change `isDefault`, and create a missing row in supported builds; all
operations reload through the native loader and preserve unrelated records.

### Phase 4: transactional deployment and rollback

- Integrate the shared target lock, ownership checks, process checks,
  content-addressed payloads, journal recovery, baseline archive, and exact
  rollback.
- Install the client resource/index and EveJS runtime projection together.
- Add drift and interrupted-transaction tests.

Exit gate: forced failure at each transaction step leaves either the complete
old state or complete new state, never a split client/server revision.

### Phase 5: release integration and runtime acceptance

- Add the suite launcher/bootstrap entry and documentation.
- Test a published NPC and a hidden NPC through scan, edit, apply, server
  restart, spawn, inspection, and rollback.
- Verify requested fitting/fuel values through runtime Dogma APIs and verify
  NPC targeting, weapons, repair/EWAR behavior, movement, destruction, and
  loot still operate for the chosen fixtures.
- Record restrictions that shadow the edited values in the acceptance report.

Exit gate: the clean-machine bootstrap installs the sixth tool, the native
proof passes, the two representative NPCs exhibit the intended values, their
selected effects remain correct, and rollback restores original hashes and
runtime behavior.

## Test matrix

| Area | Required cases |
| --- | --- |
| Catalog | Published/hidden, category 11 non-ship, category 6 configured hull, unresolved server reference, missing Dogma row |
| Attributes | Existing set, append, remove, absent source, explicit zero, integer/unit validation, related-value warning, batch determinism |
| Effects | Preserve NPC-only, merge player effect, explicit remove, replace warning, `isDefault` conflict, missing definition, missing modifying attribute, skill-context warning |
| Compiler | No-op byte equality, deterministic compile, native reload, hash-bucket peer preservation, vector grow/shrink, missing-row insert |
| Projection | Attribute map parity, legacy effect ID parity, `effectEntries` parity, correct counts/provenance |
| Deployment | Target drift, active process, ownership conflict, failure recovery, redeploy, exact rollback |
| Runtime | Slots/resources, Frontier fuel capacity, shadowed NPC restrictions, retained combat/behavior effects, published flag unchanged |
| UI/CLI | Same validation and diff, cancellation, large catalog responsiveness, accessible filters, actionable errors |

## Acceptance criteria

The implementation is complete when:

1. The tool lists every relevant type from the selected live target and can
   independently filter published, hidden, configured, spawnable, and
   ship-like NPCs.
2. A user can select a player hull and copy only the requested values,
   including fuel, high/medium/low/engine/rig slots, CPU, powergrid, and other
   opted-in stats, without altering unrelated NPC Dogma.
3. A user can review and selectively merge/remove `dogmaEffects`, with full
   definitions and dependencies visible, while NPC-only effects are preserved
   by default.
4. The diff names every changed target, attribute, effect, source, old value,
   and new value before Apply is enabled.
5. The candidate reloads through the native client loader and the server
   projection is derived from that verified candidate.
6. Publication state and unrelated records are byte/semantically unchanged.
7. Client and server changes install atomically, interrupted work recovers,
   and rollback restores the exact baseline.
8. Runtime acceptance demonstrates intended values and effects and clearly
   reports any NPC-profile restriction that shadows them.

## Recommended first vertical slice

Implement one existing-row workflow before batch editing: choose one hidden
ship-like NPC, select one current-build player ship, copy the eight requested
core attributes, merge one explicitly selected effect, compile/native-verify,
generate the server projection, display the full diff, and export without
installing. This exercises the catalog, attribute/effect semantics, compiler,
and projection boundaries while leaving deployment risk for the next phase.
