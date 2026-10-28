# Dungeon prop collision health and mass — proposed plan

## Scope and inventory

Cover every dungeon-materialized prop: scenery, resource rocks, containers,
gates, objectives, hazards, and killable structures. A physical prop damaged
by a collision must also receive a push attempt. Collision pushing is
instance-scoped physics: it must not invoke `/dungeonprop detach`, allocate a
detached world ID, write `detachedDungeonProps`, or run the controlled motion
in `DUNGEON_PROP_MOVEMENT.md`.

The build-3502403 `frontierDungeonTemplates.jsonl` has 54,433 scenery
placements and 870 distinct scenery type IDs. Of those types, 777 lack Dogma
structure HP; 637 have type mass zero and 110 have type mass one. Some use a
sentinel mass of `1e35`. The server also synthesizes props from environment
templates and encounter plans, so these 870 types are a baseline inventory,
not the whole set of emitted balls.

At spawn, every emitted prop should resolve an explicit policy record:
`physical`, `damageable`, `pushable`, `structureHP`, `massKg`,
`effectiveRadiusM`, and a source for each value. Key it by emitted type and
runtime role, with instance radius/scale overrides. A generated audit catalog
must enumerate every reachable type/role and report unresolved policies.
Never silently use zero HP or one kilogram as a physical fallback.

## Classes and coverage

| Class | Examples | HP policy | Push policy |
| --- | --- | --- | --- |
| Passive solid scenery | debris, wreckage, kitbash pieces, collidable rocks and structures | Structure tier below or reviewed type override | Pushable through 500 m radius unless explicitly fixed |
| Resource rock | mining shell and rift material | Preserve resource-specific health rules; fill absent structure HP from a tier | Enable only after mining state follows displaced position |
| Gameplay structure | killable structure, container, hive, objective | Preserve valid authored shield, armor, and structure HP; fill absent structure HP from a tier | Fixed until its behavior is made position aware |
| Gate and site anchor | acceleration gate, warp target, entry marker | Preserve authored health when applicable | Fixed |
| Visual or trigger only | cloud, weather, music, invisible locator, visual forcefield shell | No collision HP or mass | Excluded from physical collision |

Resolve class from runtime role flags, then explicit type overrides, then
authored collision geometry. Group 1975 contains both rocks and visual effects,
so a group name alone cannot prove solidity. A collision profile, or a
deliberate sphere profile for a known resource or solid, is required for a
physical fallback. A physical fixed prop may damage a ship even when the prop
cannot be moved; a purely visual prop must not participate in impact damage.

## Proposed structure HP and collision mass

Determine effective radius for each spawned instance from the scaled authored
collision bound, or a positive authored radius when no profile exists. A type
radius of 1 m on a large scenery asset is a placeholder, not a size estimate.
For a known physical role with no usable geometry, use a documented role
fallback radius: 10 m for containers, 25 m for debris/wreck pieces, 50 m for
kitbash pieces, 100 m for resource rocks, and 250 m for structures. Mark the
catalog row `radiusSource=roleFallback` for review. An unrecognized role with
no usable geometry remains fixed and collision-damage-disabled until a type
override establishes its physical size.

These are initial balance defaults for physical props without a reviewed
type policy. `structureHP` is hull HP in `combat/damage.ts`. Passive scenery
gets no artificial shield or armor. Existing authored layers on gameplay
objects remain intact. Mass here is effective collision mass, not cargo mass.

| Effective radius | Default structure HP | Default mass (kg) | Passive scenery push |
| --- | ---: | ---: | --- |
| Up to 25 m | 500 | 100,000 | Yes |
| Over 25 to 100 m | 2,000 | 2,000,000 | Yes |
| Over 100 to 500 m | 10,000 | 50,000,000 | Yes |
| Over 500 m to 2 km | 50,000 | 1,000,000,000 | No |
| Over 2 to 10 km | 200,000 | 20,000,000,000 | No |
| Over 10 km | 1,000,000 | 1,000,000,000,000 | No |

For a physical prop, accept positive SDE mass only if it falls within a factor
of ten of its radius-tier mass and is below `1e15` kg. Otherwise use the tier
mass and record why. A reviewed override takes precedence. For passive
scenery, use authored positive structure HP only when that type has been
reviewed as intentionally damageable; generic asteroid values such as `1e8`
are not automatically balance values. Gameplay structures keep their authored
HP. Reject nonfinite or nonpositive override values.

The audit catalog should record type ID/name, runtime role, source placement
count, collision profile, radius source, SDE HP/mass, chosen tier or override,
final HP/mass, and push eligibility. Review all missing HP, zero/one/sentinel
mass, radius-1, huge-radius, and visual-only rows. Include synthesized resource
shells, containers, gates, hazards, objectives, and encounter structures.
Add a coverage test so new emitted prop types cannot bypass this policy.

## Collision damage and push attempt

1. Use the server impact snapshot before velocity resolution. Ignore overlap
   corrections, separating contacts, and nonphysical props. Deduplicate damage
   by contact episode. Use the prop's effective mass for reduced mass and
   damage share; the ship uses its stable base-speed allowance.
2. Apply kinetic damage through `applyDamageToEntity`, then run the prop's
   normal health notification, persistence, and destruction path. A fixed,
   destructible prop needs an explicit ramming policy as described in
   `COLLISION_DAMAGE_PLAN.md`.
3. For every eligible damaging physical-prop contact, record a push attempt
   even if the prop's shield/armor absorbed its damage share. Ordinary contact
   may also push without damage, as the collision damage plan specifies.
   Damage remains valid when a push fails. A prop destroyed by the hit is
   removed instead of displaced.
4. Aggregate this tick's inward contacts per recipient. A single pusher must
   have at least the prop's mass to push it; several lighter pushers may meet
   that threshold when their directional mass vectors combine. Opposing
   pushers cancel. A fixed role, oversize prop, disabled motion, or blocked
   path returns a recorded rejection reason. Do not use stale `lastCollision`.
5. Once eligible, calculate a bounded velocity change from normal momentum.
   The contact normal points from prop to ship, so the prop moves opposite the
   normal. Sweep each next step through authored balls, boxes, and capsules,
   or the conservative sphere fallback. Stop on an obstacle; never teleport
   through scenery. Send a one-time client movement correction when needed.

A `siteEnvironmentProp` begins as a static ball. On a successful impulse,
replace it with a dynamic ball **under the same entity ID**, retaining
`dungeonSiteID`, `dungeonSiteInstanceID`, visibility scope, gameplay flags,
health, type, and collision metadata. `collisionStatic=true` describes its
pre-impact representation; an independent `impulseMovable` decision must keep
a pushable prop out of the infinite-mass damage branch. Settle the prop back
to a static site ball when motion ends. Use collision-specific speed and
damping limits, not GM move limits or its scan FX.

The displaced pose, damage, and destroyed-source suppression belong to the
live dungeon instance. Restore them only if that instance is restored; remove
them at ordinary site teardown/reset. The existing detached store must remain
untouched. If a GM later explicitly detaches a damaged prop, copy its current
pose, mass, and health into the durable world record. The detached record
currently copies mass but not health, so that handoff needs a schema update.

## Implementation order and acceptance

1. Generate and review the complete emitted-prop catalog; resolve ambiguous
   radius-1 and visual-only rows with explicit overrides.
2. Attach HP, mass, and push policy in every dungeon prop constructor while
   preserving authored gameplay health layers. Enforce catalog coverage.
3. Add site-prop collision damage lifecycle and instance-scoped persistence.
   Rematerializing one instance must not heal or recreate a damaged/destroyed
   prop.
4. Add collision impulse aggregation and same-ID static/dynamic transitions.
   Normal dungeon cleanup must still remove a moving site prop.
5. Verify every radius tier, missing/sentinel SDE values, head-on/glancing/
   overlap/separating contacts, lighter and combined pushers, opposing pushes,
   blocked pushes, fixed props taking damage, lethal damage, resource and
   gameplay exclusions, dungeon reset, active-instance restart, and a damaged
   prop later detached explicitly by a GM.

Acceptance requires finite positive structure HP and mass on every physical,
damageable dungeon prop, explicit physical opt-out on visual props, and a
recorded push attempt for every eligible damaging physical-prop contact.
Collision displacement must preserve the site entity ID and lifecycle and
must never create a detached world prop.
