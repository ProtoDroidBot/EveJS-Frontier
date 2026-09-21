# Remote Solar System Scanning Plan

## Purpose

Build a server-authoritative system for remotely surveying solar systems for:

- Dungeon sites and anomalies
- Resource composition and remaining resource potential
- Ship activity, without disclosing whether an actor is a player or NPC
- Bases, without disclosing whether an owner is a player or NPC
- Transient activity such as scan emissions and jump-drive signature blooms

The system should reuse the existing gravimetric, electromagnetic, and thermal
signature model while avoiding the cost and information leakage of sending every
small entity to the client. A remote result is an aggregate observation. It must
not create a ballpark entity, target lock, exact warp destination, or locally
resolved scanning contact.

The design supports two scan modes:

- A **cold survey** reads persistent world indexes without creating a scene.
- A **deep survey** may reconcile dungeon state and warm the target system when
  fresher information is required.

Randomized jump-drive travel also produces a transient signature bloom. The
bloom enters the same system heat map and decays without exposing the traveling
ship as an individually rendered entity.

## Design Decisions

1. Remote scans use a separate result namespace from local directional scans,
   probes, passive contacts, and `frontierResolvedScanningContactsByID`.
2. Persistent world authorities feed a per-system scan index. Scans query the
   index instead of enumerating or rendering the entire scene.
3. Large resource fields contribute one site aggregate rather than one
   contribution per asteroid or gas cloud.
4. Heat maps use sparse adaptive spatial cells with bounded result counts.
5. Scanner strength, range, power, fuel, cooldown, and authorization are always
   resolved by the server.
6. Exact identities and exact positions remain a local-resolution reward.
7. Deep scans may warm a system, but the scanning character is never attached
   to the target scene and receives no Destiny ball updates from it.
8. Jump-drive code remains the authority for jump behavior and physics. It
   publishes neutral signature-bloom events to the scanning system.
9. Public observations are actor-blind. Player and NPC ships share the `ship`
   class, player and NPC bases share the `base` class, and authority-specific
   revision keys are combined before a result is serialized.
10. The first interface is the existing authenticated Network Node dApp. Its
    range is configurable in stargate hops. Scan jobs remain source-neutral so
    the contract can move to a dedicated scanning Smart Assembly and Creation
    module when those types are authored.

## Existing Server Foundations

The new system should compose the existing authorities rather than create a
second world model.

| Foundation | Existing role | Required extension |
| --- | --- | --- |
| `server/src/services/frontier/scanningRuntime.ts` | Gravimetric, EM, and thermal signal-to-noise, scanner profiles, emissions, and resolution | Add aggregate-cell evaluation without producing ball contacts |
| `server/src/services/exploration/signatures/signatureRuntime.ts` | Lists signatures, anomalies, static sites, and structures | Add read-only persistent providers for cold systems |
| `server/src/services/dungeon/dungeonRuntime.ts` | Stores active dungeon instances, positions, lifecycle, and spawn state | Supply persistent site contributions without requiring a scene |
| `server/src/services/dungeon/dungeonAuthority.ts` | Stores dungeon templates and authored resource composition | Supply potential resource composition and site classification |
| `server/src/services/mining/miningResourceSiteService.ts` | Stores generated site members, resource types, and remaining quantities | Supply one aggregate contribution per resource field |
| `server/src/services/inventory/itemStore.ts` | Stores ships, Smart Assemblies, persistent positions, ownership, and state | Supply persistent ship and base contributions |
| `server/src/services/structure/structureState.ts` | Stores conventional structures | Supply player and NPC base contributions |
| `server/src/space/npc/nativeNpcStore.ts` | Stores durable and virtualized NPC entities and controllers | Supply NPC activity, role, faction, and staleness information |
| `server/src/space/runtime.ts` | Creates, prepares, and wakes solar-system scenes | Provide controlled deep-scan warm-up and live aggregate capture |
| `server/src/services/ship/mobileScanInhibitorRuntime.ts` | Defines local scan-inhibitor state and volumes | Attenuate or suppress remote contributions inside inhibited volumes |
| `server/src/services/dungeon/dungeonVisibilityPolicy.ts` | Controls private dungeon visibility | Filter private sites before they enter a remote result |

`systemInfoService` already defines a useful resource-composition shape, but it
deliberately returns an empty result where an authored aggregate is unavailable.
Remote scan observations should remain separate and must not overwrite static
system information.

## Architecture

```text
Dungeon, mining, structure, NPC, ship, and transient-event authorities
                              |
                              v
                 Per-system scan contribution index
                persistent facts and transient activity
                              |
                   sparse spatial aggregation
                              |
                              v
     Remote scan job: authorization, cost, SNR, cooldown, optional warm-up
                              |
                              v
        Redacted sites, resource composition, and entity-type heat map
```

## Implemented First Release

The first server release implements the following seams:

- `remoteSystemScanRuntime` owns durable, idempotent jobs, configurable
  stargate-hop reach, cooldown and energy-headroom checks, survey/deep modes,
  cancellation, bounded results, and ordered signals.
- `systemScanIndex` builds cold aggregate snapshots directly from persistent
  dungeon, mining, inventory, structure, NPC, and transient-event authorities.
- `systemSignatureEventRuntime` persists normalized departure/arrival blooms,
  independently decays all three channels, and exposes a neutral API for the
  separate jump-drive implementation.
- The Network Node energy dApp API exposes configuration, reachable systems,
  scan start, status, result, and cancellation endpoints under
  `/evejs/energy/:networkNodeID/scanning/...`.
- Deep scans share one target-system warm-up promise and never attach the
  requesting character or create remote targetable contacts.

The eventual Sui contract move is intentionally isolated behind the generic
scanner-source resolver. No authored scanning assembly or Creation module is
invented by this release.

### Package and World-Contract Boundary

This release changes the EveJS server package, not the deployed `world` Move
package. It deliberately does not add fields to `world::network_node::NetworkNode`
or publish a temporary scanning object whose type identity would become part of
the permanent on-chain model. The existing Network Node ownership and signed
wallet flow authenticate the dApp caller; the server remains authoritative for
route reach, energy headroom, cooldowns, scan jobs, warm-up, redaction, and
results.

The server package exposes `npm run test:frontier-remote-scanning` as the focused
verification entry point. When the dedicated scanning Smart Assembly and
Creation module are authored, their Move package should provide the generic
scanner-source capability consumed here and may commit request/result hashes on
chain without changing the durable server job or public result schemas.

### Remote Scanning Service

Add a dedicated `remoteScanning` service instead of extending the existing
directional-scan response. The existing response is tied to local
`CombinedScanResult` behavior and ballpark resolution.

The service owns:

- Scanner-source validation
- Reach and attenuation
- Power or fuel cost
- Cooldowns
- Operation-key idempotency
- Scan timing and job state
- Optional warm-up coordination
- Result redaction and delivery
- Operational signals

### System Scan Index

Add a `systemScanIndex` that stores normalized contributions by system and
source domain.

```ts
interface SystemScanContribution {
  contributorKey: string;
  systemID: number;
  position: { x: number; y: number; z: number };
  kind:
    | "dungeon"
    | "resource_field"
    | "ship"
    | "base"
    | "transient_travel";
  baseSignature: number;
  massKg?: number;
  emMultiplier?: number;
  thermalMultiplier?: number;
  siteMetadata?: SystemScanSiteMetadata;
  resourceSummary?: SystemScanResourceSummary;
  sourceRevision: number;
  observedAtMs: number;
}
```

The index should maintain a domain revision vector for each system. A completed
scan records the exact dungeon, mining, inventory, structure, NPC, live-scene,
and transient-event revisions it observed. If a revision changes during
capture, the scan retries once or marks that layer stale.

### Event Driven Updates

The following events update one contribution or mark a system dirty:

- Dungeon creation, rotation, completion, and expiry
- Mining depletion and resource respawn
- Ship system transition, docking, destruction, and logout
- NPC spawn, travel, death, respawn, virtualization, and role change
- Structure and Smart Assembly deployment, dismantling, and online-state change
- Scanner, module, weapon, and high-energy emissions
- Jump-drive departure and arrival blooms

A scan should not rescan every database table on every request. A cold rebuild
is a recovery path, not the normal query path.

## Contributor Classification

| Source | Classification | Cold authority | Live refinement |
| --- | --- | --- | --- |
| Active dungeon instance | `dungeon` | Persisted instance and template | Trigger and active-room state |
| Ore, gas, or ice field | `resource_field` | Generated site state and remaining totals | Current materialized depletion |
| Ship | `ship` | Persistent in-space item or native entity state | Current mass, heat, modules, and emissions; actor origin is not serialized |
| Structure or assembly | `base` | Structure and inventory state | Online state, modules, and energy use; owner origin is not serialized |
| Jump-drive bloom | `transient_travel` | Transient signature-event journal | No individual entity required |

Base classification should use durable anchored objects, structure categories,
and authored Smart Assembly types. Temporary field deployables should remain a
separate category unless configuration explicitly classifies one as a base.

## Sparse Entity Heat Map

### Spatial Model

Use a sparse octree rooted at the SDE solar-system radius.

- Begin with coarse cells.
- Subdivide occupied cells only when scanner strength and population justify
  more detail.
- Preserve three-dimensional cell coordinates; the UI can project them onto
  its map.
- Cap the result at a configurable number of occupied cells. A practical
  initial cap is 256.
- Merge the weakest adjacent cells when the result would exceed the cap.

### Aggregate Signature Power

For each cell and signature channel:

```text
channelPower = sum(weight * individualSignature^2)
cellSignature = sqrt(channelPower)
heat = normalize(log1p(cellSignature))
```

This keeps a concentration of many small objects detectable without returning
one result per object.

The aggregate evaluator should reuse the current scanning runtime's channel
definitions, multipliers, and signal-to-noise threshold. It receives cell-level
channel power rather than a type ID and ball ID, and therefore cannot create a
synthetic resolved ball.

### Heat Map Result

```ts
interface RemoteSystemHeatMapCell {
  cellID: string;
  approximateCenter: { x: number; y: number; z: number };
  uncertaintyRadiusMeters: number;
  confidence: number;
  channels: {
    gravimetric: number;
    electromagnetic: number;
    thermal: number;
  };
  entities: {
    ships: CountBand;
    bases: CountBand;
    transientTravel: CountBand;
  };
  observedAtMs: number;
  sourceRevision: number;
}
```

Recommended count bands are:

- `0`
- `1`
- `2-4`
- `5-9`
- `10-24`
- `25+`

Position uncertainty should be deterministic for the system, scanner, source
revision, and observation epoch. Independent random jitter on every scan would
allow repeated scans to be averaged into an exact location.

## Resolution Tiers

| Tier | Dungeon sites | Resources | Entities and bases |
| --- | --- | --- | --- |
| Trace | Total unexplained site activity | Ore, gas, or ice presence | Combined unknown activity |
| Coarse | Site-family count bands | Broad composition percentages | Ship and base categories with count bands |
| Identified | Stable signature codes and approximate cells | Resource families | Ship or base class and permitted size class, never player/NPC origin |
| Deep | Permitted dungeon family and type | Type IDs and remaining-quantity bands | Detailed class without character identity |
| Local | Existing probe and directional behavior | Existing local details | Actual resolvable ballpark contacts |

Remote resolution must not satisfy target-lock, weapon, approach, or warp
resolution checks.

## Dungeon Site Discovery

The current scene-based signature providers return no sites when a scene does
not exist. Add read-only persistent providers that use active dungeon runtime
instances and templates directly.

The cold provider must not use a path that creates a shadow dungeon instance as
a side effect of reading. It should:

1. List active instances for the target system.
2. Resolve the instance template through `dungeonAuthority`.
3. Apply the existing visibility policy.
4. Produce a stable remote signature ID that is separate from a local ball ID.
5. Include the authored position and a scan-dependent deviation.
6. Include family, kind, difficulty, and type only when resolution permits.

Private, scoped, or unfinished sites should remain hidden unless the requesting
actor has explicit visibility authority.

## Resource Composition

Every resource result should identify its provenance:

| Field | Meaning | Primary authority |
| --- | --- | --- |
| `potential` | Resources the authored site can contain | Dungeon template `resourceComposition` |
| `remaining` | Persisted undepleted totals and member counts | Dungeon spawn state or generated mining state |
| `observed` | Composition inferred by the current scan | Aggregate signature evaluation |
| `confidence` | Strength of the classification | Scanner profile, attenuation, and noise |
| `asOfMs` | Observation time used for staleness | Captured source revision |

Large fields should contribute:

- Site anchor and radius
- Resource kinds
- Resource type IDs where allowed
- Original and remaining quantity bands
- Original and active member-count bands
- A field-level gravimetric, EM, and thermal contribution

They should not contribute a separate remote scan result for every asteroid or
cloud.

## Randomized Jump Drive Signature Bloom

### Required Behavior

Randomized jump-drive travel emits the same physical signature classes as other
jump-drive travel. Random destination selection does not suppress mass
displacement, drive activation, fuel use, or jump heat.

The remote-scanning implementation should not own jump formulas. The jump-drive
authority publishes normalized signature events after authoritative state
transitions. This keeps jump-drive behavior isolated from scanning while still
allowing remote detection.

### Event Contract

```ts
interface SystemSignatureBloomEvent {
  eventKey: string;
  systemID: number;
  phase: "departure" | "arrival";
  travelMode: "random" | "directed";
  occurredAtMs: number;
  approximatePosition: { x: number; y: number; z: number };
  massKg: number;
  fuelTypeID?: number;
  fuelConsumed?: number;
  heatAdded?: number;
  channelIntensity: {
    gravimetric: number;
    electromagnetic: number;
    thermal: number;
  };
  halfLifeMs: {
    gravimetric: number;
    electromagnetic: number;
    thermal: number;
  };
  expiresAtMs: number;
}
```

### Bloom Lifecycle

1. Preparing, previewing, or selecting a randomized destination emits no bloom.
2. Crossing the irreversible departure boundary emits a departure bloom in the
   source system.
3. Successful arrival emits a separate arrival bloom in the destination system.
4. A failure after departure leaves the departure bloom intact because drive
   activation already occurred.
5. A cancelled jump or failed initiation emits no bloom.
6. A jump that never arrives emits no arrival bloom.
7. The scan index removes the transient contribution after expiry.

### Intensity

The jump authority supplies normalized channel intensities from authoritative
facts:

- Gravimetric intensity reflects ship mass and displacement.
- Electromagnetic intensity reflects drive activation and energy expenditure.
- Thermal intensity reflects jump heat and fuel thermal behavior.

The scanning system applies scanner attenuation, noise, spatial aggregation,
and resolution thresholds. It must not recalculate jump physics.

### Decay

Each channel decays independently:

```text
intensity(t) = initialIntensity * 2^(-elapsedMs / halfLifeMs)
```

Half-lives and expiry should be configuration-driven. Do not hardcode tuning
values until gameplay testing establishes appropriate persistence.

### Privacy and Correlation

- Departure and arrival blooms use separate client-visible observation IDs.
- The server retains an internal event key for idempotency and auditing.
- Results do not expose the traveling ship ID, character ID, or exact owner.
- A high-strength scan may classify a bloom as randomized jump activity.
- Clients cannot automatically correlate departure and arrival endpoints.
- A bloom remains a heat-map contribution and never becomes a targetable entity.

### Signals

Publish ordered bloom signals for:

- `signature_bloom.created`
- `signature_bloom.updated`
- `signature_bloom.expired`
- `signature_bloom.detected`

NPC behaviors may use detected bloom signals to investigate recent travel
without receiving information the detecting scanner did not resolve.

## Cold Survey

A cold survey reads persistent contributions and rollups only.

- It does not create or wake a scene.
- It does not materialize dungeon rooms, NPCs, asteroids, or deployables.
- It returns cached live activity with a timestamp and reduced confidence.
- It marks unavailable domain layers incomplete instead of inventing data.
- It is suitable for broad map reconnaissance and frequent refreshes.

## Deep Survey and System Warm Up

A deep survey may reconcile persistent dungeon state and warm the target scene
when the requested resolution needs current player, NPC, module, thermal, or
emission information.

### Execution Order

1. Authorize the scanner and reserve its cost.
2. Deduplicate concurrent deep scans for the target system.
3. Capture the current domain revision vector.
4. Reconcile persistent dungeon and generated-mining authority when required.
5. Call `ensureSceneReady` with a new `purpose: "remote-scan"` option.
6. Suppress remote-session attachment and ballpark presentation.
7. Capture live aggregate contributions and transient emissions.
8. Recheck domain revisions.
9. Retry once or mark changed layers stale.
10. Hold a short warm lease, then return control to normal scene lifecycle
    management.

### Warm Up Controls

- Global and per-system concurrency limits
- A hard warm-up timeout and cancellation path
- A cooldown before another scan-triggered warm-up
- Audit fields for world revision before and after warm-up
- No remote Destiny broadcast
- No attachment of the scanning character to the target system
- Normal NPC and dungeon side effects once the system is genuinely awake

The scan response should expose:

```ts
{
  warmedByScan: true,
  worldRevisionBefore: 41,
  worldRevisionAfter: 43
}
```

## Request and Result Contracts

### Start Scan

```ts
StartRemoteSystemScan({
  operationKey: string,
  scannerSourceID: number,
  targetSystemID: number,
  mode: "survey" | "deep",
  layers: Array<"sites" | "resources" | "entities">
})
```

The server resolves:

- Source owner and actor authority
- Online and powered state
- Sensor profile and channel strengths
- Reach and route attenuation
- Energy or fuel cost
- Cooldown and concurrency limit
- Target-system eligibility

The request returns a durable job:

```ts
interface RemoteSystemScanJob {
  scanID: string;
  state:
    | "queued"
    | "warming"
    | "scanning"
    | "complete"
    | "cancelled"
    | "failed";
  startedAtMs: number;
  completesAtMs?: number;
}
```

### Read Result

```ts
interface RemoteSystemScanResult {
  scanID: string;
  targetSystemID: number;
  state: string;
  scannerProfileID: string;
  startedAtMs: number;
  completedAtMs?: number;
  asOfMs: number;
  staleAfterMs: number;
  warmedByScan: boolean;
  worldRevisionBefore?: number;
  worldRevisionAfter?: number;
  sites: RemoteSiteObservation[];
  resources: RemoteResourceObservation[];
  heatMapCells: RemoteSystemHeatMapCell[];
  sourceRevisions: Record<string, number>;
  incompleteLayers: string[];
  truncated: boolean;
}
```

Operation-key idempotency must prevent a retry from charging the scanner or
warming the system twice.

## Persistence

Add a `remoteSystemScans` table containing:

- Durable job state
- Operation-key receipts
- Scanner and target identity snapshots
- Cost commitment and completion state
- Source revision vector
- Result expiry
- Bounded final result
- Safe failure code

The system scan index may persist durable contributions and system rollups.
Short-lived live emissions may stay in memory or use a compact transient event
journal. Jump blooms need durable idempotency and recovery for at least their
configured lifetime.

## Operational Signals

Publish ordered scan signals for:

- `remote_scan.requested`
- `remote_scan.queued`
- `remote_scan.warming`
- `remote_scan.started`
- `remote_scan.completed`
- `remote_scan.cancelled`
- `remote_scan.failed`
- `remote_scan.detected`

Signals should include scan ID, target system, source class, phase, confidence,
and safe error codes. A target-system detection signal can support NPC reactions
or counter-scanning without exposing the requesting character to ordinary
clients.

## Authorization and Counterplay

The first release requires an owned, online, powered Network Node through its
wallet-authenticated dApp. The runtime accepts a generic resolved scanner-source
profile so a future fitted scanner or dedicated sensor assembly can replace the
temporary Network Node source without changing job or result records.

Reach may be expressed as stargate hops or sensor-network coverage. Scan
duration, cost, attenuation, cooldowns, and concurrency limits should remain
configuration-driven until authored SDE attributes exist.

| Control | Required behavior |
| --- | --- |
| Cloaking | Omit cloaked entities unless an authoritative detection rule resolves them |
| Mobile scan inhibitor | Suppress or attenuate contributions inside the inhibitor volume rather than hiding the whole system |
| Private dungeon visibility | Apply the existing visibility policy before a site enters the result |
| Ownership and identity | Return player or NPC class and permitted faction class without exact IDs |
| Targeting | Remote heat cells and signatures never satisfy target-lock or warp checks |
| Scan emission | Record source EM activity and optionally a detectable target-system scan ping |
| Replay control | Use operation-key idempotency so retries do not repeat cost or warm-up |

## Performance Limits

Initial configurable limits should include:

- Maximum occupied heat-map cells per result
- Maximum site rows per result
- Maximum resource rows per result
- Maximum serialized result size
- Maximum concurrent global warm-ups
- Maximum concurrent warm-ups per target system
- Snapshot cache lifetime
- Deep-scan timeout
- Transient signature-event retention

If a result exceeds its limit, it should merge low-confidence cells, preserve
the strongest site and activity observations, set `truncated: true`, and report
which layer was truncated.

## Proposed Repository Layout

```text
server/src/services/frontier/remoteSystemScanRuntime.ts
server/src/services/frontier/remoteScanningService.ts
server/src/services/frontier/systemScanIndex.ts
server/src/services/frontier/systemSignatureEventRuntime.ts
server/src/services/frontier/systemScanContributors/
server/tests/frontierRemoteSystemScanning.test.ts
server/tests/frontierSystemScanIndex.test.ts
server/tests/frontierRemoteScanWarmup.test.ts
```

The existing jump-drive implementation should only need to call
`systemSignatureEventRuntime.recordSystemSignatureBloom()` at its authoritative
departure and arrival boundaries.

## Implementation Phases

### Phase 1 Contracts and Authority

- Define job, request, result, contribution, heat-cell, and bloom contracts.
- Add source validation, costs, cooldowns, idempotency, and safe errors.
- Add `remoteSystemScans` table ownership and recovery.
- Add scan and bloom operational signals.

Completion evidence:

- Invalid or spoofed sources fail before cost or state changes.
- Repeated operation keys return the original job.
- Result schemas enforce bounded arrays and safe numeric values.

### Phase 2 Cold Index

- Add dungeon, resource, structure, Smart Assembly, ship, and NPC contributors.
- Add the transient signature-event journal and bloom contributor.
- Add persistent read-only signature providers for cold systems.
- Add domain revision tracking and dirty-system rebuilding.

Completion evidence:

- A cold survey returns bounded results without creating a scene.
- Dungeon sites can be discovered from persistent state.
- Large resource sites produce one contribution each.

### Phase 3 Heat Map Resolution

- Add sparse octree aggregation.
- Add aggregate gravimetric, EM, and thermal power.
- Add scanner attenuation, SNR, confidence, and resolution tiers.
- Add stable position uncertainty and count bands.
- Add resource provenance and quantity bands.

Completion evidence:

- Large populations remain bounded and deterministic.
- Remote observations never enter local contact maps.
- Repeated scans cannot average uncertainty into exact coordinates.

### Phase 4 Warm Scans

- Add controlled dungeon reconciliation and scene warm-up.
- Add live player, NPC, module, temperature, and emission refinements.
- Add warm leases, deduplication, cancellation, and timeouts.
- Add revision rechecks and stale-layer reporting.

Completion evidence:

- Concurrent deep scans share one warm-up.
- The remote client receives no ballpark entities.
- Before and after world revisions are reported.

### Phase 5 Interface Integration

- Add remote scan start, status, cancel, and result methods.
- Add progress notifications.
- Add system-map heat cells, site list, and resource panel.
- Add scan history and staleness presentation.

Completion evidence:

- The UI renders aggregate cells without requiring remote balls.
- Site and resource detail changes with scan confidence.
- Warm-up and incomplete-layer states are visible.

### Phase 6 Hardening

- Integrate cloaking, inhibitors, and private-site policy.
- Add payload limits and load shedding.
- Add recovery and fault injection.
- Add metrics for index age, scan latency, warm-up frequency, payload size,
  revision retries, and truncation.

Completion evidence:

- Security and countermeasure tests pass.
- Restart and retry paths do not duplicate costs or bloom events.
- Load tests remain within configured memory and payload budgets.

## Acceptance Tests

### Index and Scene Behavior

- A cold survey of a dormant system does not create a scene.
- A deep survey can warm exactly one target system.
- Concurrent deep surveys share one warm-up operation.
- A domain revision change during capture retries or marks the layer stale.
- A failed warm-up produces a safe retryable error and no partial complete
  result.

### Dungeon and Resource Behavior

- Active dungeon sites are discoverable before scene materialization.
- Private or unauthorized sites remain absent.
- Resource potential, remaining quantities, and observed composition stay
  distinct.
- Ten thousand asteroids produce bounded field and heat-map aggregates rather
  than ten thousand results.
- Depletion updates the field contribution without rebuilding unrelated
  systems.

### Entity and Privacy Behavior

- Player and NPC ships enter one `ship` class; player and NPC bases enter one
  `base` class, with no actor-origin field in the result.
- Cold virtualized contributions may have lower confidence than live signals,
  but the public result does not reveal which authority supplied them.
- Cloaked entities remain absent unless an explicit detection rule resolves
  them.
- Mobile scan inhibitors suppress or attenuate only affected cells.
- Exact character, owner, ship, and NPC entity IDs never appear in remote
  results.
- Remote results never create target locks, exact warp points, Destiny balls,
  or local resolved contacts.

### Jump Bloom Behavior

- Randomized jump departure creates a departure bloom after irreversible
  initiation.
- Randomized jump arrival creates an independent arrival bloom.
- A cancelled jump creates no bloom.
- A failure after departure retains the departure bloom but creates no arrival
  bloom.
- Directed and randomized jumps use the same event contract with distinct
  `travelMode` values.
- Gravimetric, EM, and thermal intensities decay independently under a fake
  clock.
- Expired blooms disappear from the scan index and heat map.
- A server restart does not duplicate an idempotent bloom event.
- Client-visible departure and arrival observations cannot be directly
  correlated by ID.

### Request and Recovery Behavior

- Invalid scanner sources fail before cost reservation.
- Duplicate operation keys return the original job.
- A retry after a lost response does not repeat cost or warm-up.
- Cancellation releases uncommitted costs and warm-up reservations.
- Completed results survive restart until their configured expiry.
- Truncated results preserve the strongest observations and declare the
  affected layer.

## Recommended Implementation Order

Implement the cold index first and keep warm-up as an explicit deep-scan
capability. Define the neutral signature-bloom event API during Phase 1 so the
separate jump-drive work can integrate without importing scanning internals.

The first playable version should reveal broad site, resource, entity, base,
and transient-travel classes with confidence and count bands. Exact identities
and positions should remain local-scan information. This provides useful remote
reconnaissance while preserving cloaking, scan inhibitors, private-site policy,
and targeting boundaries.
