# Collision damage plan

Status: phases 1–3 are implemented. Phase 4 has pair deduplication and contact
cooldown; broader live-client and gameplay verification remains.

## Goal

Physical impacts can damage objects according to their closing speed and mass
and attempt to push a movable object. Damage enters the existing kinetic damage
pipeline, which consumes shields first, then armor, then hull/structure. A
collision is resolved by the server and never awards damage or movement based
on a client reported speed.

## Existing boundaries

- `destiny/simulation/collisions.ts` finds the earliest swept contact, corrects
  position, and removes inward relative velocity. The contact normal points from
  the candidate toward the moving entity.
- `space/runtime.ts` advances ordinary moving entities and receives that contact.
  Detached dungeon props have an additional authored-profile collision path in
  `space/dungeonPropMovement.ts`.
- Station entities carry their authored graphic ID so the collision bundle's
  compound geometry is used in place of the station interaction sphere when
  the bundle contains that graphic.
- `combat/damage.ts` applies kinetic damage through shield, armor, and structure
  with layer resistances and spillover. Runtime code must also persist health,
  notify observers, and run the appropriate destruction path.

## Phase 1 — capture impact inputs (implemented)

The movement collision result has an `impact` snapshot made before velocity
resolution. It records the two velocities, their relative velocity, inward
closing speed in metres per second, each valid positive mass below 10^15 kg
(or `null` when unknown or an authored placeholder), and whether the candidate
is immovable. Existing contact
fields still supply the normal and `startedOverlapping` flag. A tangent or
separating velocity yields zero closing speed. These are also the inputs for a
later push attempt. The snapshot is diagnostic input; this phase does not apply
damage or change collision response.

The ordinary swept collision path and the detached prop's inverse
authored-profile path are covered. The latter reverses its contact normal so
it points from the obstacle toward the moving prop. Its checkpoint must
succeed before any impact is eligible for damage in phase 3. Detached props
also need a valid mass and explicit safe-speed policy before damage is enabled.

## Phase 2 — calculate damage

Use the impact snapshot and reject overlap correction, non-physical objects,
and contacts with no inward speed. Require a valid positive mass for the mover
and for a movable candidate; an immovable surface does not need its own mass.
Compute the speed above a safe baseline, then scale damage with reduced mass
(the mover mass against an immovable surface) and the square of that excess
speed. The initial tuning is `100 HP * (reducedMass / 1,000,000 kg) *
(excessSpeed / 100 m/s)^2`, capped at 1,000,000 HP per contact. The HP scale,
cap, and maximum push velocity change are server environment settings:
`EVEJS_COLLISION_DAMAGE_AT_REFERENCE`,
`EVEJS_COLLISION_MAX_DAMAGE_PER_CONTACT`, and
`EVEJS_COLLISION_MAX_PUSH_DELTA_SPEED` (250 m/s by default).

The safe baseline for a ship is **50% of its stable, unmodified maximum
velocity**. The maximum velocity must come from the ship's base speed
attribute or a preserved spawn-time value, not `entity.maxVelocity` after
modules or other temporary modifiers. Each body's allowance is limited to its
actual inward speed at contact, so a stationary target adds no allowance. For
two approaching ships, subtract their individual allowances from the actual
closing speed. Motion away from the contact lowers that closing speed. Other
movable objects use a zero safe-speed baseline unless assigned
`collisionStableMaxVelocity`. Damage begins only when the resulting excess
closing speed is greater than zero; a ship striking a stationary object at
exactly half its base speed takes no collision damage.
Modular Creation hulls can have a static type speed of zero. For those hulls,
the assembled passive speed is preserved as the stable baseline and refreshed
with passive fitting changes; temporary active thrust does not change it.

For two movable objects, divide impact damage according to the mass ratio so
the lighter object receives the larger share. An immovable, indestructible
surface takes no HP damage; the mover receives the damaging share. Destructible
fixed structures require an explicit ramming policy before enabling damage.
The safe-speed threshold controls damage; ordinary physical contact can still
attempt a push without causing damage.

## Phase 3 — apply damage, attempt movement, and handle lifecycle

At the authoritative scene tick, turn each eligible share into a kinetic-only
damage vector and apply it to each damageable object. Reuse the current
shield → armor → structure calculation, including resistance and spillover.
Reuse the shared damage lifecycle for health notifications, persistence, and
destruction with a collision-specific option that bypasses weapon line
occlusion and aggression. Attribute a two-body impact to the other body; a
ship striking immovable scenery takes environmental damage.
Send the existing client damage-message notification to involved pilots for
each positive collision hit, using the effective damage absorbed across shield,
armor, and structure for the floating number.
Resolve eligible damage and send its notification as soon as the server's swept
contact is found, rather than waiting for the end of the scene tick. Retain
the contact for end-of-tick mass aggregation and push; the contact episode
state prevents that later pass from applying the same damage again. Client
collision effects may also play for contacts below the 50% damage threshold.
Include the detached prop collision path after its durable pose checkpoint.

Attempt to move a movable object away from an active contact using the same
positive masses captured for damage. A single pusher with mass at least that of
the recipient can push it. A single lighter pusher cannot move a heavier
recipient, regardless of its speed. Several lighter pushers can move it when
their net directional mass reaches the recipient's mass. For each active
pusher, add `pusherMass * pushDirection` to a per-recipient vector; require its
magnitude to be at least `recipientMass` before attempting movement. Count only
simultaneous contacts with inward movement intent, so aligned pushers combine
and opposing pushes cancel. Aggregate after all movers have been processed for
the scene tick, with one contribution per pusher. Use this tick's contact
results, not a stale `lastCollision`, and discard contributions when contact or
inward effort ends.

Once the mass condition passes, derive a bounded velocity change from the
pushers' normal momentum and the recipient's mass. The server must reject a
push into an immovable, anchored, docking, warping, or otherwise
movement-disabled object. Apply the change to movement state and let the
existing swept collision path validate subsequent travel; never teleport an
object through scenery. Send a one-time movement correction when velocity
changes, rather than a correction every tick. A blocked or ineligible push
leaves any damage result intact.

`DUNGEON_PROP_COLLISION_HEALTH_AND_MASS_PLAN.md` specifies HP, mass, and
instance-scoped collision displacement for dungeon props. A collision push
keeps the site's entity ID and lifecycle; it does not use the durable
detachment or controlled movement path in `DUNGEON_PROP_MOVEMENT.md`.

## Phase 4 — contact episodes and verification

Deduplicate a pair by unordered entity IDs and contact episode. Damage once
when contact begins, then require separation before another hit. Make the
result independent of which entity advances first in a tick. Test head-on,
glancing, separating, overlapping, static, and two-moving-object contacts;
base-speed versus boosted-speed thresholds; mass ratios; shield-to-armor-to-
structure spillover; lethal damage; a larger object pushing a smaller one;
one smaller object failing to move a larger one; enough simultaneous smaller
pushers moving a larger one; opposing pushers; immovable targets; a push
blocked by another obstacle; and detached prop checkpoint failure.
