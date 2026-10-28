# Frontier Creation Presets

## Goal

Allow a character to save the validated spatial composition of the active
Creation ship and later preview and atomically apply that composition to an
active Creation of the same hull type.

The Creation hull `typeID` remains the SDE template identity. A preset stores
the component type IDs and their spatial relationships, and receives a
separate canonical composition hash. Physical inventory item IDs are never
part of the durable preset.

## SDE authority

Build 3502403 supplies four authoritative tables:

- `creationTemplates`: hull parts, authored starting layouts, and type and
  capability restrictions.
- `creationParts`: valid cells and model hardpoint locators for each graphic
  part.
- `creationModules`: component occupancy shapes, capabilities, and hardpoint
  compatibility.
- `creationHardpointTypes`: mapping from logical hardpoint types to model
  locator sets.

The repo-local snapshot at `_local/frontier-sde/3502403` and its imported
game store at `_local/frontier-gameStore/3502403` are the build-3502403
authority. The snapshot validator reports three templates, 39 modules, 15
parts, and three hardpoint types.

Interior occupancy follows the native client convention: transform each local
cell, then add the placement position. EveJS uses the otherwise-unused
`rotation.x` and `rotation.y` fields as backwards-compatible planar reflection
flags: `180` mirrors that local coordinate within the authored occupancy
bounding box and `0` leaves it unchanged. Reflections happen before the native
`rotation.z` quarter-turn. The quarter-turn transforms are:

- 90 degrees: `(-y, x)`
- 180 degrees: `(-x, -y)`
- 270 degrees: `(y, -x)`

The `must_be_in_root` field is not enforced yet. The authored template 95968
places command module 95323, which has `must_be_in_root=1`, on part graphic
34871 whose variant is `part`. The native client validator also does not
enforce this field. It must remain advisory until its intended semantics are
resolved without invalidating an authored layout.

## Preset schema

Create a character-owned `creationPresets` runtime table. Each record contains:

- preset ID, owner ID, name, description, timestamps, and revision;
- target Creation hull type ID;
- schema version and SDE build/fingerprint;
- canonical composition hash;
- interior module logical node ID, type ID, part ID, grid position, local-X and
  local-Y reflection flags, and quarter-turn rotation;
- hardpoint provider node ID and provider index, target part ID, locator set
  and locator index, plus an optional attached exterior module type ID.

Do not store cargo, fuel, capacitor charge, ammunition, health, active
effects, industry jobs, escrow, or physical item IDs.

## Validation boundary

The server validates every complete final layout. Saving a previously valid
preset does not make it trusted forever. Loading revalidates it against the
current SDE immediately before the atomic commit.

Validation includes:

- known hull, logical parts, part graphics, and module types;
- discrete supported reflection/rotation transforms and integer cell placement;
- transformed occupancy entirely within the selected part;
- no cell collisions;
- final type and capability minimum/maximum restrictions;
- all declared provider hardpoints placed on a matching SDE locator;
- unique physical locator claims and provider slots;
- exterior compatibility and exactly one attachment per exterior module.

## Save flow

1. Require the requested ship to be the session's active, character-owned
   Creation.
2. Read the authoritative server state rather than accepting a layout from
   the client.
3. Validate the complete state.
4. Replace physical item IDs with deterministic logical node IDs.
5. Resolve hardpoint transforms to stable SDE locator identities.
6. Canonically sort the composition, calculate its hash, and persist it.

## Preview and apply flow

Preview requires the same active-ship check and a matching hull type. It
revalidates the preset, reuses already fitted same-type items first, and then
resolves missing components from active-ship cargo. It returns additions,
removals, missing components, cargo-capacity failures, industry/escrow
blockers, and resulting capacity changes.

The preview token is bound to the preset revision and current ship-state
hash. Apply rechecks both, rebuilds the plan, revalidates inventory and the
complete final layout, and commits all inventory moves and the Creation state
in one `moveItemsToLocationsAndUpdateItem` operation. It then sends one
`OnCreationChanged` notification and performs one derived-state refresh.

## Service and UI

Add Creation service operations for listing, saving, previewing, applying,
renaming, and deleting presets. Extend the existing Creation client service
adapter and management window with a Presets panel. The panel shows hull and
SDE compatibility, module and cell counts, a load diff, missing or blocked
items, and enables Apply only after a successful server preview.

## Implementation phases

1. **Complete.** Verify/restore the build-3502403 Creation SDE snapshot and
   imported tables.
2. **Complete.** Add the authoritative server layout validator and golden-test all authored
   templates.
3. **Complete.** Add `creationPresets` persistence, ownership, deletion, and player-transfer
   handling.
4. **Complete.** Implement save/list/rename/delete service operations.
5. **Complete.** Implement preview, item resolution, optimistic concurrency, and atomic
   apply.
6. **Complete.** Add the client service adapter and Presets management UI.
7. **Complete.** Add restart, owner-isolation, missing-item, blocked-removal, stale-SDE,
   concurrency, and client functional coverage.

**Pre-phase-6 patch complete.** Validated module mirror/flip transforms are
persisted in schema version 2, and the exact build-3502403 client adapter is
installed.

## Creation module mirror/flip extension

Build 3502403 already serializes all three `Rotation` fields but the retail
management editor only emits `rotation.x=0` and `rotation.y=0`. The EveJS client
adapter adds two non-conflicting held-module controls:

- `Shift + mouse wheel` toggles the local-X mirror;
- `Ctrl + mouse wheel` toggles the local-Y flip;
- an unmodified mouse wheel retains the retail 90-degree rotation behavior.

The server accepts only `0` or `180` on the reflection axes and still validates
the fully transformed SDE occupancy for part bounds and collisions. Preset
schema version 2 persists both axes; version-1 records remain loadable and
default missing reflection values to zero.

## Phase 1 verification

On 2026-09-20, `npm run frontier:validate -- --snapshot
_local/frontier-sde/3502403` completed successfully. The imported database
validation reports three Creation templates, 39 modules, 15 parts, and three
hardpoint types. No regeneration or replacement of the existing attested
snapshot was required.

## Phases 3-5 implementation

The `creationPresets` runtime table is SQLite-backed and grouped by character
owner. It participates in player export/import remapping and is purged with
private character state on character deletion. New database builds include the
table, while existing databases bootstrap it on first use.

The Creation service now exposes `list_presets`/`get_presets`, `save_preset`,
`rename_preset`, `delete_preset`, `preview_preset`, and `apply_preset`. Save,
preview, and apply require the requested Creation to be the session's active,
owned ship. Presets are owner-isolated and metadata changes increment their
revision.

Save canonicalizes the authoritative validated state into logical nodes and
SDE locator identities. Preview revalidates the composition hash and SDE
fingerprint, resolves fitted items before active-ship cargo, reports additions,
removals, missing types, industry/escrow blockers, and cargo/fuel/capacitor
capacity changes. Repeated component requirements may be fulfilled from one
cargo stack; the atomic inventory transaction assigns the resulting singleton
item IDs into the committed layout. Its short-lived token binds the owner, ship, preset revision,
complete Creation state, relevant cargo/fitting inventory, and deterministic
resolution plan.

Apply rebuilds that plan, rejects changed revisions or ship/inventory state,
revalidates the complete physical layout, and commits final module moves and
the serialized hull layout through one atomic item-table transaction. A
successful service apply emits one `OnCreationChanged` notification and one
derived-state refresh.

## Phases 6-7 implementation

The build-3502403 Creation client service now exposes typed convenience
methods for all preset RPCs and emits a local change signal after successful
save, rename, delete, or apply mutations. The native Creation management view
has a Presets tab with save, rename, confirmed delete, refresh, preview, and
apply controls. It displays hull and current-SDE compatibility, interior and
exterior module totals, authored occupancy-cell counts, cargo/load changes,
missing components, and server blockers. Apply remains disabled until a
successful preview supplies a short-lived token; all preset mutations consume
or invalidate the visible preview state.

The exact bytecode adapters remain fail-closed to build 3502403 and support a
verified transactional upgrade from the earlier mirror/flip-only wrapper.
The staged client is checked after patching and its manifest hashes are
refreshed without changing the signed retail source.

Coverage now proves SQLite persistence across a backend close/reopen,
owner-isolated RPC access, complete missing-component reporting, active
industry-job removal blocking, stale-SDE rejection, revision races, one-shot
preview tokens, client service forwarding and signals, presenter state, and
exact archive upgrade/idempotence. The restart test also caught and fixed a
cache-aliasing bug in the preset store: records are now cloned before mutation
so the game-store equality guard cannot suppress their durable write.
