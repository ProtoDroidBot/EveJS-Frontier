# Selective dungeon prop movement

## Goal

Move one chosen dungeon scenery prop at a time. A moved prop becomes an ordinary,
durable world object: dungeon teardown or reset must not delete it, and a server
restart must restore its last settled pose. Movement should use the prop's
authored collision geometry when available and a conservative radius otherwise.

Status: phase 1 is implemented as a read-only GM preview. Phases 2–4 remain
planned; the preview command does not detach or move a prop.

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
whether the proposed move is valid and changes no entity. The resolver checks:

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

Introduce one runtime store owned by the in-space service. A detached record
holds a new world entity ID, system ID, source instance/site/entity IDs, type
and presentation fields, collision fields, pose, and revision. Its source key
also suppresses the original site prop while that instance remains active.
Write the record durably before removing the old site ball. If the write fails,
leave the scene untouched. Replaying the record after a crash must converge on
one world ball and one suppressed site ball. Never reuse the site-derived ID:
the dungeon template may instantiate its slot again in a later instance.

After the durable write, remove the old static ball, construct the world prop
without `dungeon*` scope/behavior fields, and reconcile visibility. Preserve
rotation and collision metadata. Keep provenance in the store, not on the
world ball. A new dungeon instance may create its own original template prop;
the detached prop remains an independent object in space.

## Phase 3 — movement and collision

Represent an actively moving world prop as a dynamic ball with bounded speed
and acceleration. Integrate it in the server tick and sweep each step using
the existing collision resolver. Stop on contact initially; add sliding or
impulse response only after server/client behavior is verified. Preserve the
authored collision profile, scale, and rotation, using the radius fallback
when no profile exists. Reconcile bubble membership and stream movement from
the server. Add a dedicated persistence hook for this dynamic kind; the
existing dynamic persister handles ships, NPCs, and inventory-backed kinds.
Checkpoint motion and final pose so a restart cannot restore an old location.

## Phase 4 — lifecycle and verification

Load detached records when a system scene is created, independently of dungeon
materialization. Dungeon reset and teardown must ignore them. Verify a single
selection, denial cases, authored and fallback collisions, visibility for
observers, a mid-move disconnect, server restart, and dungeon reset. Crash
tests should cover both sides of the durable detachment write and repeated
materialization of the original dungeon instance.
