# Physics turret for dungeon props

## Status and dependency

The base item is Physics Gun (99999), a local copy of Cutting Laser (95317);
see `docs/PHYSICS_GUN.md`. The held-beam contract sends a fitted module ID and
aim direction. The server now uses the first authoritative collision as its
selection, detaches an eligible object, tethers it while the beam is held, and
settles it when the beam ends. Mineable asteroids are included. The sections
below record the broader design and future SDE-driven balance work.

The existing GM dungeon prop workflow is described in
`docs/DUNGEON_PROP_MOVEMENT.md`. It already supplies passive-scenery eligibility,
durable detachment, scene replay, collision sweeps, and pose checkpoints. The
ordinary tractor beam in `server/src/space/modules/tractorBeamRuntime.ts` is a
reference for fitted-module activation, cycles, capacitor, and deactivation;
its container/wreck target policy and movement path are not suitable for
dungeon scenery.

## Player interaction

1. The pilot aims the fitted Physics Gun at a visible movable ball and fires
   the held beam. The server selects the first physical collision, verifies the
   ship, module, dungeon scope when applicable, and an exclusive grab.
2. On successful grab, the server durably detaches that exact source prop, then
   replaces its site ball with the independent world ball. The initial pose is
   unchanged. The detached prop remains in the world even if the pilot releases
   it immediately or the dungeon resets.
3. The turret draws the prop toward a safe standoff from the ship, then carries
   it as the ship moves. The hold point follows the ship and the beam aim; it
   stays outside the combined ship/prop collision radii.
4. Deactivating the module releases the prop at its last durable pose. A later
   grab uses the detached world ID and does not make another detached record.
   The GM move command remains available as an administrative override.

The source ball has a site-derived ID and the world ball has a different ID.
The activation path must retarget the active effect to the world ID and update
the client's target/bracket state after the remove/add transition. Verify this
with the actual client once the SDE entry exists; if it cannot retain the
selection, add a small client retarget notification rather than reusing the
site-derived ID.

## Server authority and physics

- Share passive-scenery selection with the GM workflow without granting GM
  commands. Include mineable asteroids and dungeon resource asteroids. Deny
  encounter, gate, objective, container, hazard, component, and explicitly
  immovable props.
- Add a dedicated physics turret module adapter to the normal fitted-module
  activation/cycle/deactivation path. Use its authored effect identity and live
  Dogma attributes when available. Require an online, powered, fitted module;
  validate capacitor, range, local scope, and target visibility at activation
  and each cycle. Missing required SDE data fails closed.
- Give each world prop one scene-owned controller lease. A second turret cannot
  take it while grabbed. Module removal, power loss, capacitor failure, range
  break, warp, jump, dock, disconnect, dungeon teardown, or GM override ends
  the lease and settles the prop. A newly grabbed prop stays detached even if
  the first motion step never occurs.
- Reuse one shared detached-prop motion kernel for the GM move and turret. The
  turret supplies a changing hold point, not direct position writes. Each tick
  computes a bounded spring/damper force toward that point, applies mass-based
  acceleration and speed caps, then sweeps the proposed step against scene
  collision candidates. Test the prop's authored balls, boxes, and capsules;
  use the existing radius fallback if no authored shape exists. Contact stops
  the grab at the safe pose rather than tunneling or repeatedly pushing through
  an obstacle. Do not apply impulse or damage to other ships in the first
  version.
- Prefer a valid authored prop mass, then an item-type mass. If neither exists,
  use one documented conservative effective-mass estimate derived from the
  prop's collision volume. Clamp extreme or invalid values. Map turret force,
  acceleration, velocity, mass/size limits, range, hold distance, cycle time,
  and capacitor cost from the eventual SDE wherever authored. Set and document
  any remaining server balance and safety limits only after inspecting it.
- Commit each pose checkpoint to `detachedDungeonProps` before changing the
  visible ball, as the GM mover does. A failed checkpoint releases at the last
  durable pose. A restart restores a static prop there and does not resume the
  tether. Dungeon materialization suppresses only the detached source in its
  original instance; later instances may use the authored slot normally.

## Presentation

The grab starts only after the world ball is visible. Use the existing
scan-like prop FX while the prop is moving, with start/stop delivery to
observers in its bubble. If the new SDE supplies a physics turret beam effect,
use that authored module FX for the ship-to-prop link. Stop both on release,
collision, or abort. Retarget and bubble changes must refresh the visible ball
without exposing the GM-only preview hologram to other pilots.

## SDE and client integration

Physics Gun currently inherits Cutting Laser's group 4767, category 7,
Creation weapon hardpoint, and effects 16, 1212, and 12887. Its held-beam
activation effect is 12887. The implemented grab uses the server's first beam
collision, retargets beam FX to the independent world ball, and uses
`EndHeldBeam` for release. A future SDE entry can add dedicated force, mass,
size, range, and visual attributes. Live client verification of the
replacement-ball presentation remains necessary.

## Implementation sequence and acceptance

1. **Contract:** extend Physics Gun's current held-beam client contract with
   an explicit prop selection and grab/release payload. Define physics limits
   and test that an incomplete contract disables grabbing without affecting
   ordinary Cutting Laser behavior or tractor beams.
2. **Authority:** share scenery eligibility, add player/module validation and
   the exclusive lease, then commit detachment before scene replacement. Test
   stale target, wrong instance, hidden/active props, oversized props, failed
   storage, and two simultaneous turrets.
3. **Motion:** extract the collision/checkpoint kernel, implement bounded
   mass-based tether motion and release on contact. Test authored and fallback
   collision shapes, moving ship/hold point, no tunneling, and checkpoint
   failure.
4. **Lifecycle and client:** wire module cycles, capacitor and power events,
   disconnect and scene transitions, target-ID retargeting, and FX start/stop.
   Test observer visibility, immediate release, dungeon reset, repeated
   materialization, restart during a grab, and live client activation/visuals.

The current server implementation covers the fitted beam, one active grab per
prop, collision-aware movement, release, and durable replay. The original
four-step list remains a roadmap for dedicated SDE balance, mass-based tuning,
and live-client validation.
