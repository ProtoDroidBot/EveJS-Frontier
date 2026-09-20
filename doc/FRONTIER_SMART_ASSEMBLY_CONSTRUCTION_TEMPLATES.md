# Smart Assembly construction templates

## Goal

Allow players and persistent NPCs to save, validate, preview, and execute the
same reusable **construction templates**. A construction template may describe
one assembly or a group of assemblies, their relative placement, whether each
node is deployed directly or through a construction site, dependency topology,
and the desired base loadout applied after construction.

The server remains authoritative over placement, inventory, construction,
access, activation, and Sui synchronization. A saved construction template is
an instruction set, not permission to create items or bypass those checks.

This system is separate from:

- Creation ship presets, which describe the interior and exterior composition
  of one modular ship;
- industry blueprint items and running industry jobs; and
- live assembly state, cargo, fuel burn, damage, access grants, or Sui object
  versions.

**Construction template** is the only public name for this feature. Do not call
these records blueprints, placement configurations, presets, or base templates
in RPCs, UI copy, logs, or persisted table names. A node's optional desired
starting state is its **base loadout**, stored inside the construction template.
The word blueprint remains reserved for industry blueprint items.

## Existing foundations

The implementation should extend the current authorities rather than create a
second placement or inventory path:

- `deploymentRuntime.ts` owns assembly definitions, construction costs,
  placement range, Network Node build radius, footprint overlap checks,
  construction-site realization, activation, and dismantling.
- `npcConstructionJobService.ts` already provides restart-safe NPC placement,
  travel, material reservation, construction, Network Node fueling, activation,
  Sui waiting, and faction registration.
- `assemblyAccessRuntime.ts` provides common player/NPC principals and
  `configure`, `operate`, and inventory capabilities.
- `smartAssemblyRequestRuntime.ts` provides durable requests, claims, status
  signals, idempotency, and NPC supply coordination.
- the assembly-specific fuel, storage, turret, industry, gate, and network-node
  runtimes remain authoritative for their own state changes.
- `suiAssemblySync.ts` remains the only asynchronous local-to-chain
  reconciliation authority.

The implementation adds durable construction-template storage, a common
validator/compiler, authoritative loadout handling, and a multi-assembly
executor usable by both player RPCs and NPC behavior jobs.

## Implemented server slice

The initial server-authoritative implementation now includes:

- owner/faction-isolated `smartAssemblyConstructionTemplates` records and
  restart-safe `smartAssemblyDeploymentPlans` records;
- normalized graph validation, dependency ordering, relative transform
  compilation, group-overlap checks, preview tokens, and revision pinning;
- player CRUD, preview, execute, inspect, pause, resume, cancel, and signed
  activation RPCs on `smartAssemblyService`;
- durable per-node states, construction-site capacity queueing, bounded live
  retries, reconnect/restart rehydration, and one-site-per-plan scheduler passes
  for owner-level fairness;
- embedded Network Node fuel, Smart Turret inventory, and desired online/offline
  loadout handling; and
- durable NPC `construction.template` parent jobs which execute existing
  `construction.*` child jobs for travel, reservations, site construction,
  fueling, activation, Sui convergence, and faction registration.

Placement policy is intentionally strict and shared by both actor paths:

- Portable Assembly client types use `directAssembly` and atomically consume
  their placement materials only when placed outside a completed owned Network
  Node build zone;
- Portable Assemblies placed inside a Network Node build zone use their
  authored `constructionSite` and build up through deposits; and
- every non-portable Smart Assembly, including Network Nodes, must use its
  authored `constructionSite` type and build up through material deposits.

Unsupported unattended loadout capabilities fail closed during template save
or remain explicit authorization actions; they never cause direct custom-info
writes into another subsystem.

## Construction template model

### Base loadout

A base loadout belongs to one or more compatible nodes within a construction
template, targets one `assemblyTypeID`, and contains declarative desired state
only:

- a template-local loadout ID and loadout-adapter schema version;
- target assembly type and required capabilities;
- desired final status (`offline` by default, or `online` when prerequisites
  can be met);
- typed resource policies such as exact quantity, minimum reserve, fill-to
  percentage, or best-effort;
- initial owner inventory by type and quantity, never physical item IDs;
- type-specific configuration accepted by a registered adapter; and
- optional logical connection roles consumed by other nodes in the same
  construction template.

Initial adapter coverage should be explicit:

| Assembly capability | Base-loadout state |
| --- | --- |
| Network Node | accepted fuel type policy, initial fuel target, desired online state, energy policy |
| Smart Storage Unit | initial owner inventory and reserve-space policy |
| Smart Turret / Field Sentry | ammunition, charge policy, defensive operating policy, desired online state |
| Industry assembly | supported facility configuration only; never copy active jobs, escrow, progress, or job outputs |
| Smart Gate / Catapult | endpoint role and desired online state; destination links are resolved by the deployment plan |
| Generic or portable assembly | desired status plus only capabilities exposed by its registered runtime adapter |

Unknown type-specific fields fail closed. Unsupported assembly types may still
use an empty base loadout and remain offline, but the preview must report every
unsupported requested capability.

Loadouts do not copy current fuel timestamps, transient timers, request queues,
guest storage partitions, access grants, targeting state, or chain identities.

### Template placement graph

A construction template is a versioned placement graph with stable logical
node IDs. It contains:

- template ID, owner principal, name, description, revision, schema
  version, timestamps, visibility scope, and canonical composition hash;
- a coordinate-frame definition and root anchor selector;
- nodes with a logical ID, assembly type, relative position, relative rotation,
  required/optional status, placement mode, and an optional template-local base
  loadout ID;
- dependency edges for Network Node attachment, construction order, Smart Gate
  pairing, request routing, and other explicitly supported relationships;
- configurable clearance above the authoritative footprint minimum;
- placement constraints such as maximum root radius, required anchor kind, and
  whether deterministic alternative positions may be attempted; and
- static-data and adapter fingerprints used when the construction template was
  saved.

Physical assembly IDs, construction-site IDs, inventory IDs, Sui object IDs,
NPC incarnation IDs, and solar-system coordinates are not durable parts of the
construction template.

Every node declares one placement mode:

- `auto`: use the assembly definition's authoritative deployment path;
- `directAssembly`: outside Network Node build zones, place a completed
  Portable Assembly directly and consume its required placement materials
  atomically; or
- `constructionSite`: place a construction site, deposit materials, wait for
  completion, and then configure the realized Smart Assembly.

`directAssembly` is rejected for every non-portable Smart Assembly and for a
Portable Assembly whose resolved position is inside a Network Node build zone.
It never turns an unsupported type into a free completed assembly.
`constructionSite` is required for non-portable Smart Assemblies and for
Portable Assemblies in Network Node build zones, and is valid only when the
assembly definition has an authored construction-site type.

Supported anchor selectors should initially be:

- an explicit world-space preview origin chosen at execution time;
- an existing, accessible Network Node;
- an existing, accessible assembly selected as the root;
- an authored celestial or Lagrange-point role; and
- the executing ship, for portable assemblies only.

Relative transforms are resolved into world space during preview. Rotation is
applied around the selected root frame before translation. Every resolved node
is then checked independently by `deploymentRuntime`, and the compiler also
checks the complete proposed group for node-to-node overlap.

### Deployment plan

A deployment plan is a short-lived preview followed by a durable execution
record. Compilation pins:

- construction-template revision and base-loadout adapter versions;
- actor principal, destination system, selected anchor, and resolved world
  transforms;
- SDE and adapter fingerprints;
- existing-assembly obstacle hash;
- construction material, fuel, ammunition, and initial-inventory requirements;
- inventory candidates and reservation policy;
- dependency DAG and deterministic node execution order;
- local/Sui prerequisites and expected access capabilities; and
- a canonical plan hash and idempotency key.

The preview token binds the compiled plan to the current revisions, actor,
anchor, obstacle set, and relevant inventory state. Execution recompiles and
rechecks all of them before creating the durable job.

## Shared actor authority

Introduce a `ConstructionTemplateActorContext` with two implementations:

- `player`: derived only from the authenticated session and active ship;
- `npc`: derived from the durable NPC entity, current incarnation, faction,
  owner principal, ship, and verified Sui profile where required.

Both actor types call the same compiler, reservation layer, placement
authority, loadout adapters, and executor. The context supplies identity and
travel/inventory adapters; it does not change validation rules.

Required capabilities are checked at preview and immediately before each
mutation:

- creating a new owned assembly requires valid ownership and construction
  authority for the actor;
- using an existing anchor requires `gui.view` plus the operation-specific
  `configure` or `operate` capability;
- seeding or withdrawing inventory uses the existing custody boundaries and
  never follows from `configure` alone; and
- non-owner Smart Assembly access is usable only after its Sui confirmation,
  as defined by `assemblyAccessRuntime.ts`.

NPCs never impersonate player sessions. Faction-wide construction templates use a faction
principal and verified membership receipt; no transponder secret, salt, or
preimage may enter a construction template, preview token, or job.

## Validation and compilation

Validation is split into three passes.

### Static validation

Run on save and again on preview:

- every assembly type has a current deployment definition;
- every node and edge ID is unique and all references resolve;
- transforms are finite and within configured plan limits;
- the dependency graph is acyclic except for an explicitly supported symmetric
  relationship such as a Smart Gate pair;
- loadout type matches the node's assembly type;
- all adapter payloads pass their current schema;
- assembly-type limits and required companion nodes are satisfied; and
- the canonical hash matches the normalized content.

### Dynamic placement validation

Run during preview and immediately before each placement:

- anchor still exists, is accessible, and is in the destination system;
- every node is within ship or Network Node build range as applicable;
- existing assemblies, construction sites, celestials, and the proposed nodes
  do not overlap their collision/footprint bounds;
- type-specific spacing and per-system limits are satisfied;
- Smart Gate distances and endpoint rules are valid; and
- an NPC builder can reach the placement without violating dungeon or movement
  scope.

The compiler may generate deterministic alternative positions only when the
construction template permits it. It must record the chosen attempt and resulting
world transform so restart recovery cannot silently move a partially built
template execution.

### Resource and state validation

Run during preview, reservation, and commit:

- aggregate construction costs and post-construction loadout requirements;
- resolve items by owner, type, quantity, location, and permitted custody;
- ensure fuel/ammunition types are accepted by the destination runtime;
- prevent initial inventory from exceeding capacity;
- verify Network Node power and attachment dependencies before onlining;
- reject active-job, occupied-berth, access, or other lifecycle conflicts; and
- report Sui readiness separately from local game readiness.

A construction template is always revalidated against current static data.
Saving a valid template never makes it permanently trusted.

## Execution lifecycle

Use a durable `assemblyDeploymentPlans` record and one idempotent operation per
node/action. A plan moves through:

1. `compiled`: revisions, authority, transforms, and requirements are pinned.
2. `reserving`: required physical items are reserved without embedding their
   IDs in the reusable construction template.
3. `queued`: ready construction-site nodes wait for an owner construction-site
   slot; direct-placement nodes do not consume a site slot.
4. `constructing`: eligible nodes are placed in dependency order through the
   existing player or NPC construction primitive.
5. `configuring`: loadout adapters deposit fuel, ammunition, and initial
   inventory and apply supported configuration.
6. `linking`: Network Node attachment, gate pairing, and request topology are
   applied only after both endpoints exist.
7. `activating`: assemblies are brought online in dependency order when the
   base loadout requests it.
8. `reconciling`: chain-enabled nodes wait for verified Sui convergence.
9. `completed`, `degraded`, `cancelled`, or `failed`: a terminal summary records
   each realized node and unresolved action.

### Construction-site limit and queue

The existing per-owner construction-site limit is a concurrency limit, not a
construction-template size limit. Preview reports:

- total construction-site nodes;
- the owner's currently active construction sites, including sites created
  outside this plan;
- slots available now;
- nodes that can start immediately; and
- nodes that will remain queued.

Submitting or resuming a valid plan must not fail solely because the limit is
currently full. The scheduler reads the limit and active count from the same
deployment authority that enforces manual and NPC construction; it must not
copy the current numeric limit into template data.

Execution places only as many construction sites as the current owner limit
allows. Remaining nodes persist as `queued-site-capacity` in deterministic
dependency/FIFO order. Whenever a site completes, is cancelled, or is
dismantled, the scheduler recounts authoritative active sites and starts the
next eligible node. The queue and its ordering survive restart.

The final placement call still rechecks the authoritative limit to close races.
If another manual or automated placement wins the last slot and placement
returns `TOO_MANY_CONSTRUCTION_SITES`, the node returns to
`queued-site-capacity` without consuming materials or incrementing its attempt
counter. Site lifecycle changes should wake the scheduler, with a bounded
periodic reconciliation as restart/missed-signal recovery.

Scheduling must be fair across multiple plans owned by the same principal. A
round-robin owner queue prevents one large template from permanently consuming
every newly available slot. Administrators may change the limit, and the next
scheduler pass must honor the new value without losing or duplicating nodes.

Queued nodes do not require the builder to remain nearby and do not reserve
physical materials indefinitely. The preview reports total requirements, but
the executor reserves and consumes materials only when a node is eligible to
start. If resources or custody change while a node waits, it moves to
`awaiting-resources` and may use the Smart Assembly request bus; it does not
forfeit its logical queue position. NPC travel begins only after both a site
slot and required resources are available.

Direct Portable Assembly nodes outside Network Node build zones may proceed
while construction-site nodes are capacity-queued, provided their dependencies
are satisfied. Portable direct nodes never increment the active construction-
site count; Portable Assembly nodes inside a Network Node build zone do.

Multi-assembly execution is not one database transaction. Every step must be
idempotent, restart-safe, and compensatable. Cancellation releases unspent
reservations and stops future nodes; it does not automatically dismantle
already completed assemblies. An explicit, separately authorized cleanup plan
may dismantle empty/offline nodes after presenting the exact consequences.

If placement becomes occupied after preview, the executor pauses before
consuming that node's materials. It may recompile an optional unbuilt node only
under the construction template's deterministic-relocation policy. Already built nodes
never move implicitly.

## Loadout adapter contract

Add a registry keyed by assembly capability/type. Each adapter implements:

- `normalizeAndValidate(assemblyTypeID, payload, context)`;
- `estimateRequirements(normalizedPayload, context)`;
- `preview(assembly, normalizedPayload, context)`;
- `apply(assembly, normalizedPayload, operationContext)`; and
- `readBack(assembly, normalizedPayload, context)`.

`apply` must call the existing authoritative subsystem and use an idempotency
key derived from plan ID, node ID, adapter name, and template revision.
`readBack` determines whether a retry is already complete. An adapter cannot
write another subsystem's custom-info fields directly.

Initial adapters should wrap Network Node fuel/energy, Smart Storage inventory,
Smart Turret ammunition/policy, assembly activation, and Smart Gate linking.
Industry support initially configures only the facility; running jobs remain
separate user/NPC actions after the plan completes.

## Persistence and ownership

Add two game-store tables:

- `smartAssemblyConstructionTemplates` grouped by canonical owner principal,
  with template-local base loadouts and placement nodes; and
- `smartAssemblyDeploymentPlans` keyed by durable plan ID.

Reusable records are revisioned and cloned before writes, following the
Creation preset store's restart-safe pattern. They participate in character
export/import, deletion, and owner-ID remapping. NPC/faction records are retained
or retired according to the durable NPC/faction lifecycle rather than player
character deletion.

Visibility is one of `private`, `tribe`, or `faction`. A shared construction
template remains owned by its authoring principal. Consumers execute a pinned
copy/reference and cannot modify the original without `manage_access` plus
template-management authority. Public/global templates, if later needed,
should be server-authored versioned catalog entries rather than ownerless
records.

Persist only public Sui references and proof digests. The normal assembly sync
worker creates and tracks actual Sui assembly objects after construction; a
construction template never predicts or reserves an object ID.

## Player surface

Extend `smartAssemblyService` with operations to:

- list/get/save/rename/delete construction templates;
- capture a one-node construction template and base loadout from one accessible
  completed assembly;
- capture a relative multi-node construction template from selected accessible
  assemblies;
- preview a construction template at an anchor, including which nodes deploy
  directly, start as construction sites, or remain site-capacity queued;
- execute, inspect, pause, resume, or cancel a deployment plan; and
- retry individual failed configuration/link/activation actions.

The client editor should provide a 3D ghost preview, root/anchor selection,
rotation and relative-offset editing, dependency/link visualization, collision
and range diagnostics, material/loadout totals, unsupported fields, Sui status,
and a per-node execution timeline. Execute remains disabled until a fresh
server preview succeeds.

## NPC surface

Extend durable NPC jobs with a `construction.template` job whose payload
contains only construction-template ID/revision, target system, anchor
selector, policy options, and public actor context. The handler:

1. compiles or resumes the durable deployment plan;
2. places directly supported Smart Assembly nodes and creates construction-site
   child work in dependency order;
3. uses the existing request bus for missing materials, fuel, or ammunition;
4. waits in the durable per-owner site-capacity queue before traveling the
   builder to each construction-site placement;
5. invokes the same loadout adapters used for players;
6. waits for activation/Sui confirmation without holding expired claims; and
7. stores stable checkpoints and wake-event keys for every pause.

NPC strategy decides *which* saved construction template to use and where to
anchor it. It does not generate unvalidated assembly state or skip the compiler.
A faction construction template may parameterize roles such as `command-node`,
`storage-1`, or `defense-east`; the compiler resolves those roles to concrete
plan nodes.

## Implementation phases

1. **Capability inventory and schemas.** Enumerate assembly-specific mutable
   state, define adapter coverage, schemas, canonicalization, fingerprints, and
   table ownership/export rules.
2. **Store and CRUD.** Implement an owner-isolated, revisioned construction
   template store with nested base loadouts, limits, idempotency, migration,
   deletion, and restart coverage.
3. **Validator/compiler.** Implement static graph validation, transform
   resolution, group collision checks, dependency ordering, requirement
   aggregation, and preview tokens.
4. **Shared actor and reservation authority.** Add player/NPC actor contexts,
   custody-aware item resolution, durable reservations, and stale-preview
   rejection.
5. **Durable executor and site queue.** Add the plan state machine, direct/site
   placement modes, fair per-owner construction-site capacity scheduling,
   per-action operations, restart recovery, pause/resume/cancel, degraded
   completion, and read-back reconciliation.
6. **Base loadout adapters.** Add activation, Network Node, storage, turret, and
   gate adapters; keep unsupported capabilities visible and fail closed.
7. **Player RPC and UI.** Add capture/edit/preview/execute/status controls and
   3D placement diagnostics.
8. **NPC integration.** Add `construction.template`, faction libraries, request-bus
   supply waits, deterministic placement retries, and behavior-tree wakeups.
9. **Sui and access hardening.** Verify shared-template access, chain convergence,
   transfer/delete behavior, world isolation, and proof-digest persistence.
10. **Operational hardening.** Add metrics, plan audit events, admin inspection,
    retention/cleanup, failure injection, and load testing for large layouts.

## Acceptance criteria

- The same saved construction template produces the same normalized plan for a
  player and an NPC given the same actor capabilities, anchor, inventory, and
  world state.
- Preview reports every construction material, loadout item, fuel/ammunition
  requirement, access failure, unsupported capability, collision, range error,
  and chain prerequisite before execution.
- No reusable construction template stores physical inventory, assembly,
  character-session, or Sui object IDs.
- Player and NPC execution use the existing placement, construction, inventory,
  access, activation, and sync authorities; tests prove there is no privileged
  NPC bypass.
- Restart at every execution phase resumes without duplicate items, duplicate
  chain submissions, repeated consumption, or changed placement.
- A template may contain more construction-site nodes than the active-site
  limit. Excess nodes remain durably queued, and one eligible node starts when
  a slot becomes available without requiring the player or NPC to resubmit it.
- Direct Portable Assembly nodes and construction-site nodes can coexist;
  portable direct nodes outside Network Node build zones use the costed
  deployment path and do not consume construction-site capacity, while
  Portable Assemblies inside a node zone do consume it.
- Revision, SDE, adapter, inventory, access, anchor, or obstacle changes make a
  stale preview unusable.
- Partial failure leaves an inspectable durable plan with exact per-node state;
  cancellation never silently deletes completed assemblies or occupied cargo.
- Gate pairs, Network Node dependencies, fuel, ammunition, storage seeding, and
  desired online state are applied only after their prerequisites are verified.
- Active industry jobs, escrow, transient timers, access grants, request queues,
  guest inventory, and secrets are never captured or cloned.

## Required test matrix

- store restart, owner isolation, sharing, revision races, export/import,
  deletion, and owner-ID remapping;
- canonical hash stability and stale SDE/adapter migrations;
- rotations, anchor frames, group overlap, existing-object overlap, range,
  per-system limits, and deterministic retry exhaustion;
- missing, stacked, moved, consumed, cross-owner, and capacity-constrained
  inventory;
- Network Node plus storage/turret/gate dependency graphs and online ordering;
- player/NPC parity fixtures using the same construction template;
- templates mixing direct assemblies and construction sites, active-site
  limits of zero/one/many, pre-existing external sites, multiple competing
  plans, fair slot release, limit changes, and queue recovery after restart;
- NPC supply requests, death/incarnation changes, travel interruption, and
  faction membership revocation;
- restart and failure injection before and after every material, placement,
  configuration, link, activation, and chain step;
- cancellation with zero, some, and all nodes constructed; and
- Sui disabled, pending, rejected, uncertain, recovered, and fully converged
  outcomes.
