# Selective dungeon prop movement

## Goal

Move one chosen dungeon scenery prop at a time. A moved prop becomes an ordinary,
durable world object: dungeon teardown or reset must not delete it, and a server
restart must restore its last settled pose. Movement should use the prop's
authored collision geometry when available and a conservative radius otherwise.

Status: phases 1–4 are implemented. The GM-only preview is a client-side
hologram. `/dungeonprop detach <entityID>` durably detaches the selected prop
in place. `/dungeonprop move <entityID> <x> <y> <z> [yaw pitch roll]` detaches a
live dungeon prop if needed, then moves its world ball. It also accepts the
world entity ID of an already detached prop. `/dungeonprop stop <worldEntityID>`
settles a moving prop at its last checkpoint.

## Existing boundaries

- `dungeonUniverseSiteService.buildEnvironmentEntities` makes environment
  props as site-scoped static balls. Their IDs are derived from the site ID and
  slot, and `dungeonMaterializedSiteContent` makes teardown remove them.
- `SpaceScene` advances dynamic balls through the movement and swept-collision
  path. Static balls are not advanced by that tick; its existing teleport API
  accepts dynamic balls only.
- The collision bundle resolves a prop's graphic ID, collision scale, and
  `dunRotation`. The server has a sphere fallback for missing profiles.
- `authoredSpaceProps` is read-only configuration, so moved props need a
  separate runtime store rather than edits to authored scenery data.

## Phase 1 — selection and validation

Provide a server-side resolver for a single entity ID and destination pose.
The initial caller is a GM-only `/dungeonprop preview` command. It reports
whether the proposed move is valid and changes no entity. An accepted request
sends an owner-only `OnDungeonPropMovePreview` notification. The client draws a
cyan, non-pickable wireframe hologram of the prop's authored collision shapes
at the proposed position and rotation. If the graphic has no collision data,
it draws a radius hologram. The hologram is not a ball, has no collision or
gameplay behavior, and never enters world persistence. A new preview replaces
the previous one; `/dungeonprop clear`, a scene teardown, or the 45-second
expiry removes it. The resolver checks:

- the actor is in a ship in the same scene and active dungeon instance;
- the entity is a live site environment prop visible to that actor;
- the prop is passive scenery, with no mining, hive, component, encounter,
  gate, objective, container, or hazard behavior;
- the actor is within 50 km of the prop's surface;
- the destination and optional rotation are finite, and displacement is at
  most 100 km per request.

The eventual mutation must call the resolver again at commit time. A preview
does not reserve a prop or grant authority to move it later. Eligibility is a
small allowlist; new gameplay props stay immovable until explicitly supported.

## Phase 2 — durable detachment

The `detachedDungeonProps` SQLite runtime table is owned by the in-space
service. A detached record
holds a new world entity ID, system ID, source instance/site/entity IDs, type
and presentation fields, collision fields, pose, and revision. Its source key
also suppresses the original site prop while that instance remains active.
`/dungeonprop detach <entityID>` calls the phase 1 resolver again and writes
the record durably before removing the old site ball. If the write fails,
leave the scene untouched. Replaying the record after a crash must converge on
one world ball and one suppressed site ball. Never reuse the site-derived ID:
the dungeon template may instantiate its slot again in a later instance.

After the durable write, remove the old static ball, construct the world prop
without `dungeon*` scope/behavior fields, and reconcile visibility. Preserve
rotation and collision metadata. Keep provenance in the store, not on the
world ball. Phase 2 keeps the world prop at its original pose; the phase 3
move command can then move it. A new dungeon instance may create its own original template prop; the
detached prop remains an independent object in space. Scene construction
restores detached props from the runtime table before dungeon content is
materialized, and materialization skips source IDs detached from that exact
instance.

## Phase 3 — movement and collision

An actively moving world prop is a free dynamic ball with a 1,500 m/s speed
limit and 750 m/s² acceleration limit. Each scene tick sweeps the next bounded
step through the existing collision resolver and stops on first contact.
An inverse relative sweep also tests the moving prop's authored balls, boxes,
and capsules against nearby collision bounds. The prop retains its authored
collision scale and rotation, with the radius fallback when no profile exists.
The server sends a `GotoPoint` command,
reconciles bubble membership, and refreshes the moving ball every two seconds.
Every step is durably checkpointed before its pose changes in the scene. If a
checkpoint fails, the prop settles at the last durable pose. After a crash,
scene startup restores that last checkpoint as a static world prop; it does
not resume the interrupted motion.

During actual movement, play a scan-like effect on the real prop using the
same `OnSpecialFX` start/stop broadcast pattern as Feral Drone/NPC scanning.
`npcScanning.broadcastScanFx` uses `effects.FrontierScanningTest` for the
inventory-scan visual; use that as the initial effect candidate.
The moving world prop is the FX target; the issuing ship is the source, matching
the scanner's source/target payload semantics. Start after the world ball is
visible, and stop when motion settles or aborts.
Use the visual effect only: no scanning, feralization, inventory,
or NPC gameplay callbacks. The effect must be visible to observers in the
prop's bubble, while the phase 1 hologram stays visible only to the requesting
GM. The wire payload matches the Feral inventory-scanning pattern; visual
appearance still needs confirmation in a live client session.

## Phase 4 — lifecycle and verification

Dungeon reset and teardown must ignore detached props. Verify a single
selection, denial cases, authored and fallback collisions, visibility for
observers, a mid-move disconnect, server restart, and dungeon reset. Crash
tests should cover both sides of the durable detachment write and repeated
materialization of the original dungeon instance.

The teardown filter explicitly excludes `detachedDungeonProp` balls, including
live balls that somehow acquire stale site markers. The focused tests exercise
failed writes, restart immediately after a committed write with the source
present or already removed, idempotent replay, restart during movement at the
last durable checkpoint, repeated materialization of the same instance,
template-slot reuse by a later instance, and site cleanup while the world prop
is settled or moving. Selection denials, collision fallback and
authored shapes, GM disconnect, and durable movement checkpoints are covered
by the phase 1–3 tests. The SQLite/scene integration test checks static
visibility and scan FX delivery for an observer in the prop's bubble.
The FX's appearance still requires a live client visual check.

## Proposed player module

`docs/DUNGEON_PROP_PHYSICS_TURRET.md` plans a fitted physics turret that can
grab and reposition eligible props using this durable movement path. Its SDE
entry has not been implemented, so the player module is not active yet.
