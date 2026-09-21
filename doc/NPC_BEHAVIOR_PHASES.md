# Persistent NPC behavior roadmap

This document preserves the implementation plan for durable autonomous NPCs. The phases are deliberately ordered so that equipment custody, resource production, construction, signal-driven infrastructure recovery, reinforcement dispatch, and inter-system movement cannot duplicate identities, items, resources, or blockchain transactions after a server restart or crash.

Status snapshot: 2026-09-20.

## Implementation status

Status terms in this document mean:

- **Complete**: the planned server/contract foundation is implemented and covered by focused tests. Optional player-facing UI or additional content adapters may still be planned.
- **In progress**: a usable subset or prerequisite exists, but at least one required end-to-end boundary is not implemented or activated yet.
- **Planning**: the design and dependencies are recorded, but the phase's coordinating runtime is not implemented.

| Phase | Status | Implemented now | Remaining work |
| --- | --- | --- | --- |
| 0 — crash-safe persistence | **Complete** | Behavior-tree primitives, durable jobs and reservations, incarnation-bound spawn leases, operation journals, reconciliation/quarantine, checkpoints, verified snapshots, durable assembly-signal cursors, atomic signal-to-job checkpointing, truncated-journal resnapshot recovery, and recovery tests. | No remaining Phase 0 foundation work. Domain policy that converts network-node states into specific logistics/capacity jobs belongs to Phases 3 and 6. |
| 1 — fitting and equipment custody | **Complete** | Atomic player/faction item custody, player-compatible hull fitting, NPC-specific restrictions, semantic module roles, charge handling, destruction policy, restart recovery, server-authoritative trust/locality RPCs, trusted-only context action, and a player-facing NPC fitting window. | Expand authored NPC fitting profiles and replace/augment the narrow same-faction or explicitly authored trust rule when the broader NPC trust behavior is implemented. |
| 2 — resource work | **Complete** | Durable resource jobs, target reservations, lens-authoritative asteroid/Crude-Rift work, mining/crude/gas/ice tool selection, group-5133 salvageable-wreckage mining, canonical cargo, delivery/crash recovery, threat suspension, Phase 1 tool provisioning, and correct durable-NPC identity propagation into legacy module activation. | Register authoritative Salvager, recovery, and other resource adapters; connect network-node fuel signals to automatic faction logistics jobs. |
| 3 — assemblies and access | **In progress** | NPC construction sites, placement clearance, material fulfilment, atomic realization, network-node placement/fuel integration, local access requests/grants, split Sui access contracts active on the current Localnet, chain proof verification, idempotent cross-owner custody transactions, and crash-safe multi-lane Industry execution. | Consume network-node journals with durable NPC cursors, complete load-shedding policy, add optional player assembly-access GUI controls, and define an on-chain representation for Industry lanes beyond the legacy lane-1 projection. |
| 4 — faction backup | **Complete** | Durable incidents, deduplication/cooldowns, fitting-aware responder selection, interruption/resume, same-system dispatch, and restart recovery. | Cross-system responders remain suspended until Phase 5 travel is available. Optional player incident/dispatch UI remains planned. |
| 5 — cross-system travel | **In progress** | Smart-gate link validation, one-way smart-catapult routes, player jump-drive runtime, celestial-stargate maintenance, Sui route synchronization, and network-node availability prerequisites. | Implement the unified NPC route graph, session-independent ship transition operations, durable dematerialize/materialize journal, NPC gate/catapult/jump-drive execution, and recovery at every travel boundary. |
| 6 — integrated faction autonomy | **Planning** | Its persistence, fitting, resource, construction, access, support, signal, and travel prerequisites are defined or partially implemented in Phases 0–5. | Implement the faction planner, strategic job arbitration, faction-level signal cursors, budget reservation, infrastructure/resource goals, route replanning, and the end-to-end autonomy scenario. |

The status above describes repository implementation. Optional client UI exists only where a phase explicitly says so; Phase 1 includes it, while later-phase optional controls remain planned. The split feature contracts, including `assembly_access`, are active on the Localnet deployment verified below. A Localnet reset or a new base-world deployment invalidates that statement until the new deployment manifest is synchronized and verified again.

## World-contract deployment verification and package-split findings

This is an audit snapshot, not runtime configuration. The authoritative values remain the efctl-managed `world-contracts/deployments/localnet/npc-deployment.json` manifest synchronized by `FrontierWorld.ps1`.

### Verified current deployment

The 2026-09-20 read-only audit verified chain `0609212e` directly through the Localnet RPC:

| Package | Current call package | Normalized module set | Registry/type check |
| --- | --- | --- | --- |
| Base world | `0x930779a2d72f891ba77b7c646a7e5c4466817e60c762b954e8f0101618f299ed` | Base world modules | World, Object Registry, and Admin ACL match the synchronized deployment. |
| NPC | `0x0ebf053946218f14b23500505e32e87062f7e2825413bb0ffda8e5e1fb9e937d` | `npc` | Shared `npc::NpcRegistry` exists at the manifest ID. |
| Assembly access | `0xf373994863a15b2219e26b357829fd912d72d76d5d11649938c733595cf1a1f2` | `assembly_access` | Shared `assembly_access::AssemblyAccessRegistry` exists at the manifest ID. |
| Catapult | `0xdf9d2ba5c69893a85195aea83f5aeed76a6b707885b8a3d27e9b6f0d9cd76093` | `catapult` | Shared catapult registry exists with the exact manifest type origin. |
| Smart Industry | `0xe0d9ac2bad5e72a0ee1ce29d6fc86476a0948e58d51d808ff6e1ebc0c50d5e82` | `smart_industry` | Shared Industry registry exists with the exact manifest type origin. |
| Transponder | `0xa82296f457e50d1cd202a87be6a2e6af9c12787b88a341e929d31851a0e40c0d` | `transponder` | Shared transponder registry exists with the exact manifest type origin. |

All six package objects are immutable. Their six `UpgradeCap` objects still exist, report policy `0`, and are address-owned by the same deployment admin, `0x0ed11258a64c4a1275c1f291f5345ffd6dbe7d45c1bbedfc411ba184fbc77082`. On this fresh split deployment each feature's type origin equals its initial feature-package ID. The authoritative and synchronized copies of `npc-deployment.json` are byte-for-byte equivalent.

Focused EveJS deployment/configuration tests passed 46/46 for world sync, NPC deployment validation, split NPC/access configuration, transponder commitments, assembly access, and Industry configuration. The private-key-backed read-only NPC transaction simulator could not be rerun from the audit sandbox because `world.private.json` correctly denies that sandbox identity; its ACL was not weakened. The sibling TypeScript harness also could not load its current `node_modules` reparse points or fetch a replacement under restricted networking. Therefore this snapshot proves public package/module/registry consistency, not a new signed or simulated end-to-end transaction for every feature.

### Incomplete deployment work and split-package risks

1. **P0 — add a supported upgrade workflow.** `deploy-world.sh` is a destructive fresh-publish path: it runs `pnpm clean`, removes publication metadata, and publishes the base plus all five feature packages. There is no efctl command that upgrades one package with its existing `UpgradeCap`, keeps the original type origin and shared registry, updates only that feature's call-package ID, and preserves the other synchronized identities. `write-npc-deployment.ts` currently writes fresh-publish origins as the new package IDs, so it cannot safely author an upgrade manifest.
2. **P0 — remove the cross-package access fallback.** When the manifest is absent, `suiNpcWorldConfig.ts` defaults `accessPackageId` to `npcPackageId`. With the split layout the NPC package contains only `npc`, so an NPC-only override can silently direct `assembly_access` calls to the wrong package. Split fields must resolve independently: use an explicit access override/manifest value, fall back to a base package only when it actually contains the module, or fail closed.
3. **P1 — version and rename the combined feature manifest.** The historical `npc-deployment.json` now atomically requires NPC, access, catapult, Industry, and transponder metadata. One missing feature blocks all feature configuration, while the filename obscures its expanded role. Introduce a versioned world-feature manifest or explicit capability records, with an intentional migration path for partially deployed environments.
4. **P1 — validate and hash every split artifact.** Sync currently proves the base deployment/publication binding and validates feature addresses, but it does not query the live call packages for their expected modules. The live verifier proves that package and registry objects exist but likewise needs module checks or a feature-specific dry run. Include the combined feature manifest and per-feature publish/upgrade artifacts in synchronized hashes; do not rely only on the shared base `Pub.localnet.toml` accumulator.
5. **P1 — publish a base/feature compatibility matrix.** The split packages still depend on public bridge functions added to the base world, and access/transponder also depend on `world_npc`. They cannot be treated as installable on an arbitrary older base package. Record the minimum base and NPC ABI for every feature and test upgrade combinations. Base-package guards also do not retroactively change callable bytecode from older package versions, so identity hardening must account for historical entry points.
6. **Resolved — make the deployment reproducible from source control.** The five feature packages, deployment/configuration scripts, tests, and supporting documentation now live in the pinned `world-contracts` submodule. Generated deployment artifacts remain ignored and are reproduced by efctl from that exact gitlink.
7. **P1 — complete current-chain efctl validation.** After rebuilding the environment, run Move tests for all six packages, the manifest/Industry TypeScript tests, the NPC read-only transaction simulation, and feature-specific access/catapult/Industry/transponder transaction smoke tests. Keep the private deployment config protected; run the simulator under the intended service/admin identity instead of loosening its ACL.
8. **P1 — decide the on-chain Industry lane model.** The server and patched client support multiple lanes, but only lane 1 is mirrored into the existing Sui Industry production field. Either version the Industry contract/registry for lane-aware state and events or explicitly preserve Sui as a lane-1 compatibility projection.

The 2026-09-20 documentation audit completed the former stale-documentation
item: the contract repository now has one authoritative package map, all
feature guides use the split call-package/type-origin/registry model, and the
obsolete standalone `industry.json` instructions have been removed. Keep that
map and the generated manifest schema synchronized with future package changes.

## Design model

NPC autonomy uses a hybrid model:

- Behavior trees choose immediate priorities and interrupt lower-priority work.
- Durable jobs store multi-step work that must survive restarts.
- The existing combat controller remains the tactical combat branch.
- The in-memory blackboard contains observations and caches, never authoritative ownership state.
- Durable smart-assembly status signals wake NPC jobs and faction planners; they are observations, not authority to mutate fuel, energy, or assembly state.
- Assembly GUI visibility and assembly-operation authority are separate, explicitly granted capabilities. An open GUI or a received signal never proves access.
- Sui stores identity, authorization, ownership, transponder commitments, assembly state, and strategic route configuration. Per-tick movement and targeting stay off-chain.

The intended root tree is:

```text
Priority Selector
├─ Recover lifecycle / respawn state
├─ Emergency survival
├─ Execute direct player or admin order
├─ Respond to aggression / call for backup
├─ Maintain ship, equipment, fuel, and ammunition
├─ Continue assigned durable job
├─ Accept faction work
├─ Perform an optional local opportunity
└─ Patrol, guard, or idle
```

Behavior nodes return `success`, `failure`, `running`, or `suspended`. A suspended node records a wake time or waits for an event rather than polling every simulation tick.

## Cross-phase network-node signal contract

The network-node signal producer is implemented in `networkNodeEnergyRuntime.ts`, `networkNodeFuelRuntime.ts`, and `smartAssemblyRequestRuntime.ts`. It publishes idempotent `status_changed` journal entries with signal type `network_node.resources`. The producer records band transitions rather than every fuel burn or energy-unit change. A consumer that needs exact quantities or remaining capacity must wake on the signal and then read the canonical network-node status.

The signal keeps fuel and power as independent dimensions so simultaneous warnings cannot overwrite each other:

| Signal state | Meaning | Planned NPC response |
| --- | --- | --- |
| `FUEL_LOW` | Fuel is at or below 20% of node volume | Create or reprioritize one deduplicated fuel-acquisition and delivery job. |
| `FUEL_EMPTY` | No usable fuel remains | Block dependent activation/travel, mark the node unavailable, and raise critical refueling work. |
| `POWER_USAGE_LOW` | Usage is at most 50% | Clear capacity waits and permit normal planning. |
| `POWER_USAGE_MEDIUM` | Usage is above 50% and at most 80% | Retain telemetry and avoid speculative reserve spawning; no emergency job by itself. |
| `POWER_USAGE_HIGH` | Usage is above 80% and at most 100% | Defer nonessential activation and pre-plan capacity, load shedding, or another node. |
| `POWER_USAGE_OVER_LIMIT` / `POWER_LIMIT_EXCEEDED` | A projected or requested reservation exceeds production | Suspend the requesting activation, record the rejected assembly and energy amount, and replan capacity or connection. |
| `POWER_USAGE_OFFLINE` | The node is offline | Remove dependent services from route and work planning until a canonical status read confirms recovery. |

The durable journal supplies `sequence`, `oldestSequence`, `nextSequence`, and `truncated`. Each NPC command node or faction planner will persist a cursor per observed assembly and signal type. Processing is idempotent by `{assemblyID, signalType, revision}`. If `truncated` is true, the consumer must discard incremental assumptions, read `getAssemblyOperationalStatus`, fetch exact network-node status, rebuild its derived view, and only then advance the cursor. In-process `subscribeToSignals` is a latency optimization; restart recovery always uses the durable journal and current-status resnapshot.

Signal authorization follows assembly ownership and faction registration. NPCs observe faction nodes through an online, faction-registered command node. A signal never carries a private transponder code, salt, wallet key, or membership receipt, and a caller-supplied signal payload is never treated as authorization. The existing Sui/local assembly state remains authoritative for online status, confirmed energy reservations, and mutations.

Signals translate into behavior events and durable jobs rather than executing inventory or assembly writes inside a callback. Repeated equivalent status is naturally deduplicated by the signal producer; the NPC layer additionally deduplicates generated work by node, problem class, and signal revision. Recovery reads canonical state before resuming a job so an old warning cannot cause a second fuel delivery, activation, or load-shedding operation.

## Phase 0 — crash-safe behavior and persistence foundation

> **Status: Complete.** Phase 3 and Phase 6 can consume assembly journals through the durable Phase 0 cursor/reconciliation API without adding another persistence model.

Phase 0 is the mandatory dependency for every later phase. Its implementation lives primarily in:

- `server/src/space/npc/npcBehaviorTreeRuntime.ts`
- `server/src/space/npc/npcRuntimePersistence.ts`
- `server/src/space/npc/nativeNpcStore.ts`
- `server/src/space/npc/nativeNpcService.ts`
- `server/src/space/npc/npcBehaviorLoop.ts`
- `server/src/space/npc/npcService.ts`

### 0A. Behavior-tree primitives

The runtime provides action, condition, sequence, and selector nodes. It also provides:

- `NpcEventInbox`, a bounded, deduplicated, transient event queue.
- `NpcActionLockManager`, which serializes movement, targeting, fitting, cargo, assembly, and travel actions.
- `registerNpcJobHandler`, the extension point used by later phases.
- `tickDurableNpcJob`, integrated into the idle/no-combat portion of the existing NPC loop.

Manual orders, active threats, assistance, and special Drifter behavior remain higher priority than ordinary work. Unregistered jobs remain durable but do not block existing NPC behavior.

### 0B. Authoritative state classes

NPC data is divided into four classes:

1. Durable identity: NPC character ID, identity slot, faction key, faction wallet, Sui profile objects, incarnation, and respawn policy.
2. Durable simulation state: system, position checkpoint, damage, fitting, cargo, ammunition, fuel, job, and reservations.
3. Recoverable operations: spawn, destruction, construction, cargo custody, fitting, travel, and pending Sui transactions.
4. Ephemeral runtime state: target locks, active effects, steering velocity, scans, event inboxes, and blackboard caches.

Jobs and leases bind to `npcCharacterID` and `incarnation`. `entityID` remains the current physical ship identity. A delayed action from an earlier incarnation cannot control a respawned NPC.

### 0C. Versioned persistence

`npcRuntimeState` is a versioned, checksummed aggregate containing:

- Durable jobs
- Faction-support incidents and cooldowns
- Spawn leases
- Operation journals
- Quarantine records
- Verified logical snapshots
- Startup and clean-shutdown metadata
- Recovery summaries

Native entity, controller, module, cargo, wreck, and wreck-item records carry:

- `schemaVersion`
- `recordRevision`
- Persistence timestamps
- `recordChecksum`

Optimistic revision checks reject stale updates. Unknown schemas and checksum mismatches fail closed.

The underlying `gameStore` SQLite WAL and durable persistence outbox remain responsible for physical database recovery. NPC operation journals add application-level recovery across several NPC tables.

The aggregate stores `assemblySignalCursors` keyed by faction planner or command node plus observed assembly and signal type. A cursor records the last scanned journal sequence, last applied relevant sequence, latest applied status revision and fingerprint, resnapshot count, and its own optimistic record revision. `applyNpcAssemblySignalCheckpoint` advances the relevant cursor and creates or reprioritizes its idempotent durable job in one checksummed persistence mutation. `reconcileNpcAssemblySignalJournal` reads the external journal through injected adapters, ignores unrelated signal types while advancing `lastScannedSequence`, and fetches canonical operational status before crossing a truncated range. A crash before the atomic mutation leaves the cursor untouched; replay therefore creates exactly one job and cannot acknowledge work that was never recorded. Signal payloads remain in the smart-assembly journal and are not copied wholesale into every NPC record.

### 0D. Durable jobs

A job record contains:

```text
jobID
npcCharacterID
incarnation
jobType
status
step
target
payload
checkpoint
reservations
retryCount
nextWakeAtMs
lastError
idempotencyKey
recordRevision
```

Only meaningful work boundaries are checkpointed. The normal behavior tick is not written to disk. Job creation is idempotent per NPC and idempotency key, active-job concurrency is rejected by default, and updates support optimistic revision guards.

### 0E. Spawn leases and single materialization

A durable NPC must acquire a spawn lease before it is materialized. A lease binds:

```text
npcCharacterID + incarnation + entityID + server generation
```

Repeated materialization of the same entity reuses its lease. A competing entity is rejected. Leases never survive a server generation boundary; startup recovery clears the old generation and reconciles identity records before issuing new leases.

Exactly one active physical ship may represent a persistent NPC identity. Duplicate identity records are quarantined, with the pilot identity ledger's `activeEntityID` preferred as the canonical record.

### 0F. Operation journal and write ordering

Ownership-changing operations are recorded and synchronously flushed before dependent writes. Each operation has an idempotency key, status, step, payload, revision, and terminal result.

Durable spawning checkpoints these boundaries:

```text
prepared
→ entity-written
→ modules-written
→ cargo-written
→ controller-written
→ committed
```

If recovery finds an entity and controller, the spawn is completed idempotently. If the spawn is incomplete, its partial records are removed and the operation becomes `compensated`.

Destruction is journaled before the entity/module/cargo/controller cascade. Recovery finishes an interrupted cascade exactly once. The pilot identity record is retained and its incarnation/death policy remains authoritative.

Later phases must use the same journal API for fitting custody, cargo transfers, construction, and cross-system travel.

### 0G. Reconciliation and quarantine

Before durable NPCs resume, recovery:

1. Validates the runtime-state checksum and schema.
2. Reconciles incomplete operation journals.
3. Compares entities and controllers.
4. Validates system identity and record checksums.
5. Compares NPC entities with the pilot identity ledger.
6. Detects duplicate persistent identities.
7. Detects orphan modules and cargo.
8. Resolves old quarantine entries and records current failures.
9. Rehydrates only non-transient, non-quarantined controllers.
10. Lets authored startup populations run their existing exact-count reconciliation.

Invalid records are retained as evidence and excluded from materialization. Recovery does not silently discard an ambiguous identity or invent replacement inventory.

### 0H. Checkpoints, shutdown, and snapshots

The database exposes synchronous shutdown hooks that execute before the final database flush. NPC shutdown handling:

- Stops by virtue of the process shutdown boundary.
- Checkpoints every materialized durable entity and controller.
- Flushes entity, module, cargo, controller, pilot identity, wreck, and wreck-item tables.
- Creates a compressed logical snapshot.
- Verifies the snapshot with SHA-256.
- Retains the newest three snapshots.
- Marks a clean shutdown and releases spawn leases.

While the server is running, an unreferenced five-minute timer checkpoints durable NPCs and rotates the same verified logical snapshots. The interval can be raised with `EVEJS_NPC_PERSISTENCE_SNAPSHOT_INTERVAL_MS`; it is clamped to a one-minute safety minimum.

Snapshot restoration is explicit and requires a force flag. Automatic startup recovery uses journals and quarantine; it does not overwrite live data from an older snapshot.

Snapshots cover entity, module, cargo, controller, pilot identity, wreck, and wreck-item tables together with durable jobs, faction-support incidents/cooldowns, assembly-signal cursors, operation journals, and quarantine state. Cursor state is restored inside the same verified snapshot boundary as its signal-derived jobs.

### 0I. Phase 0 acceptance criteria

Tests must cover:

- Behavior-tree running and suspended propagation.
- Event deduplication and ordered draining.
- Lock exclusion, renewal, release, and expiry.
- Idempotent job creation and revision conflicts.
- Exclusive spawn leases and generation reclamation.
- Quarantine without destructive cleanup.
- Interrupted spawn compensation.
- Interrupted destruction completion.
- Snapshot checksum verification and explicit restoration.
- Signal replay deduplication, monotonic cursor advancement, and `truncated` journal resnapshot recovery.
- A crash between signal observation and job creation must produce exactly one durable maintenance/logistics job after recovery.
- Existing NPC identity, combat, mining, and startup-rule regressions.

Crash injection should terminate the process after every durable operation checkpoint. After restart there must be one active NPC per identity, stable Sui profile IDs, conserved inventory, no duplicated transaction, and a resumable or safely compensated job.

## Phase 1 — player equipment custody and NPC fitting

> **Status: Complete.** Server custody, trusted RPC access, context action, and the build-3502403 NPC fitting window are implemented.

Phase 1 is implemented server-side in `server/src/space/npc/npcFittingService.ts`. The atomic `NpcFittingService` moves a real player or faction item into NPC custody while retaining its canonical item identity and provenance. It validates slot, CPU, power grid, charges, NPC capability, and faction hardware policy. Unfitting returns the same item unless it was legitimately destroyed. Partial module and charge stacks keep the selected canonical item ID on the fitted or loaded item; a new ID is assigned to the remainder.

NPC loadout selection is semantic: weapons, ammunition, remote repair, mining tools, salvage, tractors, scanners, cloaks, propulsion, jump drives, and fuel. Equipment now carries a primary `semanticRole` for fitting policy plus a `semanticRoles` capability set for multi-purpose use. This prevents tools such as the Cutting Laser and Needle from being reduced to mining-only equipment: their primary policy role remains `weapon`, while mining jobs can still select their `mining` capability. The Crude Extractor remains mining-only because its held-beam profile explicitly disallows combat damage.

Classification is authored-data-first. Legacy non-skillshot miners and harvesters are recognized from their mining Dogma effects, and legacy turret/launcher equipment is recognized through the shared weapon-family resolver. Creation/modular equipment is recognized from `creationModules`, with its behavior, capability, system, root-placement rule, and hardpoint/compatible-hardpoint declarations retained in the NPC equipment record. Creation repair, propulsion, scanning, and weapon capabilities map to their NPC semantic roles; modular interiors without an executable NPC behavior map to `passive` instead of being rejected as unknown. An equipment profile also records whether activation is ordinary Dogma, skill-shot, or held-beam. These classifications make the full equipment catalog fit-visible and behavior-discoverable without falsely claiming that every Creation ability already has an NPC behavior adapter.

The existing fitted-module combat paths should be reused. Legacy combat modules already enter those paths through the shared weapon-family resolver. Fitted propulsion remains disabled until synthetic navigation and module propulsion share one movement authority. Creation layout metadata is preserved for the future NPC-specific modular fitting validator; current player-compatible hulls still obey ordinary player fitting, while NPC-specific hulls use their authored role-slot restrictions.

Every custody change uses a Phase 0 operation journal so a crash cannot place one item in both player and NPC inventories or in neither inventory.

### 1A. Player-compatible and NPC-specific hulls

NPC ships use ordinary player fitting rules wherever the physical or presentation hull resolves to a player ship type. A spawn may set `playerFittingHullTypeID` explicitly when its NPC inventory type is only a presentation shell for a player-compatible hull. Standard fitting validation then enforces slot family, hull type/group restrictions, hardpoints, calibration, CPU, and power. NPC fitting intentionally skips player-character skill prerequisites because capability and faction policy are the NPC authorization boundary.

NPC ships may also have their own fitting profiles and restrictions. A durable entity stores `npcFittingProfileID` and `npcFittingRestrictions`. The current profile fields are:

```json
{
  "allowedRoles": ["weapon", "ammunition", "propulsion"],
  "allowedTypeIDs": [],
  "deniedTypeIDs": [],
  "allowPlayerOwned": true,
  "allowFactionOwned": true,
  "allowCrossFactionDonation": false,
  "roleSlots": {
    "weapon": [11, 12],
    "propulsion": [19]
  },
  "cpuOutput": 100,
  "powerOutput": 100,
  "moduleResources": {
    "12345": { "cpu": 10, "power": 20 }
  },
  "chargeCompatibility": {
    "12345": { "allowedTypeIDs": [54321], "capacity": 100 }
  },
  "equipmentLossPolicy": "return"
}
```

Hull restrictions can only narrow the faction hardware policy; they cannot grant a role, type, ownership source, or cross-faction transfer that the faction denies. The faction policy is configured under `defaults.hardwarePolicy` or a faction's `hardwarePolicy` in `npc-factions.config.json`.

### 1B. Custody, recovery, and destruction

Fit, unfit, charge-load, and charge-unload each journal inventory movement before committing the native module/cargo mirror. Recovery either completes the mirror record or compensates the inventory move. Idempotency keys make caller retries safe. Custody records retain source item, owner, location, flag, stack origin, actor, ownership kind, NPC character identity, and incarnation.

NPC removal settles externally owned equipment before deleting the entity. The default and non-destructive behavior returns equipment to its recorded source. A hull or faction may choose `equipmentLossPolicy: "destroy"`; it is honored only for a destruction path.

### 1C. Client boundary

Server jobs, admin tooling, and NPC AI still use the custody service directly. Players use the build-3502403 `Manage NPC Fitting` celestial-menu action and its native NPC fitting window. The action is omitted unless `npcFittingMgr.CanOpenNpcFitting` returns a positive server trust decision; `OpenNpcFitting` performs a second state read before constructing the window. Refresh, fit, unfit, charge-load, and charge-unload each re-evaluate identity, locality, 2,500-meter range, and trust. If trust is revoked or cannot be revalidated, the open window fails closed on its next refresh or action.

The initial trust rule is intentionally narrow. A player is trusted when their authoritative character faction matches the NPC faction, or when the durable NPC record explicitly lists the character under `npcFittingTrust.trustedCharacterIDs` (the `trustedFitterCharacterIDs` compatibility field is also accepted). `npcFittingTrust.deniedCharacterIDs`/`deniedFitterCharacterIDs` takes precedence. `registerNpcFittingTrustResolver` is the extension boundary for the planned standings, relationship, and behavior-tree trust model; the client cannot submit or assert trust.

The RPC returns only sanitized hull, policy, fitted-module, charge, and active-ship-cargo rows. Custody provenance is not exposed. Player-supplied modules and charges must be owned by the authenticated character and located in that character's active ship cargo hold. The client cannot select arbitrary source or destination locations, owner IDs, faction identity, authorization lists, or idempotency keys. Existing player fitting and Creation management remain unchanged.

## Phase 2 — general resource work

> **Status: Complete for the common executor and mining-family adapters.** Additional resource adapters and automatic signal-driven fuel logistics remain planned extensions.

Phase 2 is implemented server-side in `server/src/space/npc/npcResourceJobService.ts`. It generalizes the existing mining fleet implementation into a reusable, durable resource job:

```text
Validate assignment
→ inspect fitted tools
→ acquire or request a missing tool
→ find and reserve a target
→ travel and approach
→ lock and activate a compatible effect
→ monitor threat and cargo
→ select an unloading destination
→ deliver cargo
→ release reservations
```

Tool matching is effect-driven rather than name-driven. Resource definitions specify compatible effects, charges, ranges, and cargo constraints. Begin with mining, then reuse the executor for salvage, gas, ice, recovery, and construction resources.

Reservations must be durable whenever losing one could duplicate consumption or delivery.

### 2A. Durable jobs and reservations

`createNpcResourceJob` creates a Phase 0 job for a durable NPC identity and incarnation. The built-in job aliases are `resource.work`, `resource.mine`, `resource.mining`, `resource.crude`, `resource.gas`, and `resource.ice`. A job payload selects `resourceKind`, optional target and quantity goal, cargo threshold, threat cooldown, reservation TTL, optional tool provisioning request, and an unloading destination.

The Phase 0 store now exposes atomic acquire, renew, list, and release operations for job reservations. Exclusive claims use a stable resource key such as `resource-target:<systemID>:<entityID>`, expire by lease time, survive server restart, and are cleared when the job completes, fails, is cancelled, or crosses an NPC incarnation boundary. A competing NPC skips a claimed target instead of consuming it concurrently.

Every executor transition persists a named step and checkpoint: `awaiting-tool`, `acquire-target`, `travel-target`, `lock-target`, `harvesting`, `select-destination`, `travel-delivery`, and `delivery-retry`. Combat remains higher priority in the NPC behavior loop. Recent aggression suspends work, deactivates the resource module, and resumes after the configured threat cooldown.

### 2B. Equipment and resource adapters

The mining adapter selects an online Phase 1 fitting whose `semanticRoles` includes `mining`, resolves its authored dogma effect, builds the effective range/yield/charge snapshot, and accepts only compatible mineable state. This includes legacy non-skillshot mining lasers, strip miners, gas harvesters, and ice harvesters when their authored effect and charge rules match; it does not require the module's primary policy role to be mining. Basic legacy mining modules that have no authored charge bay can mine compatible asteroids without a lens. Modulated/crystal-capable legacy miners require a loaded target-valid crystal, while Cutting Laser and Needle require a loaded list-612 lens. Crude Rifts are a distinct `crude` resource kind and require a Crude Extractor with a loaded list-601 Crude Lens; neither an ordinary mining crystal nor a list-612 Cutting/Needle lens can extract them. Cutting Laser, Crude Extractor, and Needle execute through the lock-free held-beam mining cycle instead of generic target-locked activation. Ore, crude, gas, and ice otherwise reuse the durable executor. Target selection prefers the nearest compatible unreserved entity.

Authored salvageable wreckage in group `5133` remains part of the asteroid/mining loop. A basic legacy mining module may process it without a charge; a charge-capable legacy miner must have a target-valid crystal, and a Cutting Laser or Needle must have a compatible list-612 lens. This is resource extraction from a mineable landscape prop, not the unimplemented Salvager or recovery behavior. Ordinary wrecks, `resource.salvage`, and `resource.recovery` fail closed until their authoritative adapters are introduced.

Additional resource mechanics register a definition through `registerNpcResourceDefinition`. A definition supplies tool resolution and target discovery and may supply compatibility, distance, approach, locking, activation, deactivation, cargo, and reservation-key hooks. Salvage, recovery, and construction collection can therefore reuse the durable state machine when their authoritative production adapters are introduced in their owning phases.

If no compatible tool is fitted, the job writes a durable tool request and suspends. A job may include `toolProvisioning` with an item, fitting flag, actor authorization, and idempotency key; that path delegates to the Phase 1 custody service. This does not bypass faction policy, hull restrictions, CPU/power checks, or player-item authorization.

### 2C. Canonical cargo and recovery

Resource yield produced by a durable NPC is now a canonical `items` row. The native cargo mirror uses that exact item ID; transient mining fleets retain their lightweight negative/allocated cargo path. Legacy durable mining cargo is migrated into a canonical stack the next time that resource type is appended. Cargo volume is reconstructed from authored item metadata after a restart, so threshold decisions remain stable.

Delivery moves a recorded set of whole canonical stacks atomically, then removes their NPC cargo mirrors. The `npc-resource-delivery` operation journal records item IDs, quantities, and destination before movement. Recovery handles all crash boundaries: items still at the NPC are moved, items already at the destination have stale mirrors removed, and the operation is committed once. Missing or unexpectedly relocated items stop recovery rather than guessing.

NPC removal also settles canonical resource rows. Destruction first projects the native cargo mirror into wreck contents and then removes the NPC-held canonical row; a delivery row already moved to its destination is left untouched. This prevents invisible inventory items from remaining at a deleted NPC location.

Example job input:

```json
{
  "entityID": 980000000801,
  "resourceKind": "mining",
  "idempotencyKey": "mine:site-7:slot-1",
  "payload": {
    "quantityGoal": 1000,
    "cargoThresholdRatio": 0.85,
    "threatCooldownMs": 15000,
    "continuous": false
  },
  "destination": {
    "locationID": 600000801,
    "flagID": 4,
    "entityID": 900000801,
    "interactionRangeMeters": 2500
  }
}
```

The destination owner must already match the resource stack owner; Phase 2 changes location and flag, not legal ownership. Cross-owner trade, refining, and construction consumption remain explicit later-phase transactions.

### 2D. Network-node fuel demand

`network_node.resources` is the demand signal for future NPC fuel logistics. `FUEL_LOW` creates or raises the priority of a node-scoped resource job; `FUEL_EMPTY` raises it to critical and prevents the planner from assigning new work that depends on the node. The worker must fetch exact fuel type, quantity, unit volume, capacity, burn state, owner, and location from the canonical fuel/energy runtimes before reserving inventory. The compact signal is not a substitute for that read.

The fuel workflow reuses Phase 2 discovery, reservation, hauling, and delivery mechanics, but the final deposit must use the Phase 3 NPC network-node fuel entry point and its idempotency receipt. Its stable job key is based on faction, network-node ID, and unresolved fuel-demand generation. A transition back to `normal` cancels an uncommitted duplicate request or lets an in-flight delivery finish only when current policy still permits the resulting reserve. Multiple low-fuel transitions cannot reserve the same stack or overfill the node.

## Phase 3 — field and smart assemblies

> **Status: In progress.** Construction, placement, fulfilment, Industry lanes, local access control, Sui contract source, proof verification, and cross-owner custody are implemented. The split `assembly_access` package and registry are live on the currently verified Localnet. Durable network-node signal consumption, load-shedding policy, player access UI, upgrade-safe deployment tooling, and a lane-aware on-chain Industry representation remain outstanding.

The implemented Phase 3 server foundation consists of:

- `server/src/space/npc/npcAssemblyActorContext.ts`
- `server/src/space/npc/npcConstructionJobService.ts`
- `server/src/space/npc/npcConstructionTemplateJobService.ts`
- `server/src/space/npc/npcIndustryJobService.ts`
- `server/src/space/npc/npcTransponderMembership.ts`
- the NPC entry points in `server/src/services/frontier/deploymentRuntime.ts`
- the NPC fuel entry point in `server/src/services/frontier/networkNodeFuelRuntime.ts`
- the faction-signer integration in `server/src/services/frontier/suiAssemblySync.ts`

Deployment operations now accept a session-free actor context:

```text
kind: player | npc
actorID
ownerPrincipalID
factionID
shipID
solarSystemID
suiProfileObjectID
suiWalletAddress
```

The NPC construction job is:

```text
Resolve blueprint and policy
→ haul to the target system
→ resolve a system-wide Network Node location or an owned node build zone
→ warp/fly into the player's placement envelope and revalidate clearance
→ place and durably checkpoint a construction site
→ reserve, gather/request, and deliver missing materials to that site
→ verify full material fulfilment
→ atomically consume the fulfilled materials and realize the structure
→ fund and fuel
→ submit smart-assembly transaction
→ await Sui confirmation
→ activate
→ register for faction use
```

`construction.field`, `construction.smart`, and `construction.assembly` jobs use the Phase 0 job and operation journals. The executor resolves the canonical assembly definition and places a real construction-site item idempotently by job ID before it plans or requests materials. It then plans exact source stacks, reserves them, moves them into that site, verifies the complete bill of materials, and atomically consumes those materials in the same inventory commit that replaces the site with the finished assembly. The target structure type is therefore never realized merely because a job exists or a partial delivery arrived. This removes the crash window in which materials could be consumed without producing an assembly, or an assembly could complete without consuming its materials. Network-node fuel uses the same atomic consumption/update pattern and a bounded idempotency receipt.

A missing material or fuel plan emits one deduplicated behavior event and suspends the job. A job assigned to another solar system suspends at `awaiting-system`; Phase 5 will supply the route and cross-system transition rather than letting Phase 3 teleport the builder. Construction and activation timers survive through the canonical assembly state. Each external inventory/deployment operation is journaled and recovered on startup.

Field assemblies remain local/off-chain. Smart assemblies are locally owned by the durable NPC character ID, whose confirmed on-chain Character is controlled by the canonical per-faction wallet. The existing Sui assembly worker remains the only blockchain writer: it resolves that faction signer, verifies the confirmed NPC profile/Character binding, uses the admin-sponsored gas path, and submits the existing idempotent transaction journal. NPC code never receives wallet seeds or private keys. The public NPC profile, faction, wallet, job, and builder metadata are recorded for audit and faction registration.

The existing smart-assembly request bus stays assembly-to-assembly. NPC requests originate through an online, faction-registered command-node assembly and may target only another assembly registered for that faction. Cross-owner delivery is enabled only after those checks. A request includes the confirmed NPC profile as public operator metadata.

Caller-supplied `verified: true` membership flags are not trusted. The server validates a freshly fetched Sui faction commitment with the private code/salt bundle, then exchanges it for a random, short-lived in-memory receipt bound to the NPC, faction, command node, target assembly, request type, and request UUID. The durable request receives only the commitment object ID, revision, and faction scope. The code, salt, preimage, and opaque receipt are never persisted or logged. Exact idempotent retries can reuse the receipt until expiry; any changed binding is rejected.

### 3A. Construction placement and fulfilment

Network Nodes are root infrastructure and do not require an existing Network Node build zone. An authored finite world coordinate may target anywhere in the solar system. Without one, the deterministic placement planner prefers Lagrange-point anchors (group `4870` or the `lagrangepoint` kind), offsets the site to avoid exact-anchor overlap, and falls back to another celestial or the builder's current system coordinate when the system has no Lagrange point. Lagrange placement is a preference, never an eligibility restriction. “Anywhere” describes the destination: the NPC must warp or fly to it and enter the same 2.5 km placement envelope used by a player before the server commits the site.

Every other NPC-built field or smart assembly requires a completed Network Node owned by the durable NPC character. The planner accepts an explicitly selected `networkNodeID`, otherwise chooses deterministically (or the nearest node to an authored target), and places the construction site within the node's 80 km build radius. The durable job checkpoints that target, travels into player placement range, and then reruns the same authoritative range and node checks immediately before creation. An authored point outside the selected node radius is rejected rather than silently moved.

Player and NPC placement share an assembly-footprint clearance check. It uses the larger of the construction-site and finished-assembly radii, with a conservative fallback when static radius data is absent, and compares that footprint with every completed assembly and unfinished site in the system. Network Nodes, portable assemblies, smart assemblies, and their construction sites cannot be created inside one another. Automatically selected NPC coordinates retry deterministic radial slots when occupied; an explicitly authored coordinate is rejected and left for its caller to correct. A concurrent placement is caught again at commit time, so planning races cannot create overlapping assemblies.

The construction-site item stores the job ID, public NPC operator/faction identity, selected node or system anchor, placement preference, coordinates, and lifecycle phase. Missing-material events include both the construction-site ID and selected Network Node ID so Phase 2 haulers have an authoritative delivery target. Restarts recover the same site by job ID. Full fulfilment is checked again inside the atomic completion transaction; only then is the site's type/model replaced by the target structure and its activation/Sui lifecycle allowed to begin. Definitions without a construction-site type are rejected for NPC construction instead of falling back to direct realization.

### 3B. Network-node signal consumption

Construction and assembly-operation jobs subscribe through their faction command node to `network_node.resources` for the node selected by the job. They still call `validateAssemblyOnline` immediately before an activation commit. Signals reduce polling and wake suspended jobs; they do not reserve energy and cannot make a stale activation safe.

- `POWER_USAGE_HIGH` prevents speculative activation of nonessential assemblies and asks the planner to consider another node, another system, or deliberate load shedding.
- `POWER_LIMIT_EXCEEDED` binds the warning to the rejected `requestedAssemblyID` and `requestedEnergy`. That construction job checkpoints `awaiting-energy-capacity` rather than repeatedly submitting the same transition.
- `POWER_USAGE_OFFLINE` or `FUEL_EMPTY` checkpoints dependent assembly jobs at `awaiting-network-node` and prevents a smart gate, catapult, storage, turret, or industry facility from being registered as operational.
- A later usable power band and non-empty fuel signal wakes affected jobs, which resnapshot exact status, revalidate ownership/faction registration, and retry through the existing idempotent deployment or activation journal.

Load shedding is an explicit durable request, never an automatic side effect of observing high usage. Policy chooses eligible nonessential consumers and records why they were taken offline. Defense, navigation, production, and maintenance priority flags can coexist on the resulting assembly request while urgency remains the queue-order scalar.

No client change is required for server-directed NPC construction or operation. A player-facing NPC construction-order interface would be a separate client/RPC feature; Phase 3 exposes the authoritative server services it would call.

### 3C. Entity, tribe, and faction assembly access

Phase 3 now has a server-side common assembly-access service for players and durable NPCs in `assemblyAccessRuntime.ts`, native player RPCs in `smartAssemblyService.ts`, and NPC-safe entry points in `npcAssemblyAccessService.ts`. A subject is identified as exactly one typed principal so numeric identifiers cannot collide:

```text
entity:player:<gameCharacterID>
entity:npc:<npcCharacterID>
tribe:<tribeID>
faction:<canonical factionID-factionStringOnlyID>
```

An entity can request access for itself, and an assembly owner or authorized access manager can share access with another player, NPC, tribe, or faction. Requests and grants are scoped to one assembly and to an explicit capability set. The initial capability vocabulary is:

- `gui.view`: discover the assembly and open its permitted GUI/status views.
- `operate`: perform ordinary type-specific actions such as using storage, activating an industry job, or requesting gate/catapult travel.
- `inventory.deposit` and `inventory.withdraw`: separated so logistics access does not imply custody removal.
- `configure`: change non-ownership assembly configuration, links, routes, or policy allowed by that assembly type.
- `manage_access`: approve, deny, share, shorten, or revoke grants. This never implies ownership transfer.

Assembly types narrow this vocabulary to their supported actions. A grant may include an expiry, usage constraints, and a `delegable` flag. A delegate can share only a subset of capabilities it currently holds, for no longer than its own expiry, and with a strictly smaller remaining delegation depth. Owners may always revoke. A grantor with `manage_access` may revoke grants within its delegation lineage; a recipient may relinquish its own access or withdraw its pending request. Denying a request does not create a negative grant unless an owner deliberately adds a separate block policy.

Access follows a durable request lifecycle:

```text
REQUESTED → APPROVED | DENIED | CANCELLED | EXPIRED
APPROVED → REVOKED | EXPIRED
```

Each request carries an idempotency key, requester principal, intended recipient scope, assembly ID, requested capabilities, reason metadata, creation/expiry time, and the access-policy revision observed when submitted. Approval creates a uniquely identified grant rather than mutating the request into an ambient boolean. Repeating the same operation is safe; changing its bindings under the same idempotency key is rejected. Approval, denial, relinquishment, sharing, and revocation produce an append-only audit event with public identities and capability names but no private transponder code, salt, preimage, wallet key, or membership receipt.

Completed smart assemblies keep their authoritative grant/revocation state in deterministic `<accessPackageId>::assembly_access` shared objects on Sui. Direct issuance proves the assembly's exact `OwnerCap`; player and NPC delegation proves the parent grant plus its Character or NPC profile. The contract prevents capability amplification, excessive expiry, delegation-cycle abuse, and replay. Field and portable assemblies use the equivalent durable local policy model. A local projection may accelerate reads but cannot override the authoritative source.

The server marks a smart-assembly grant `local_projection_pending_chain` and refuses to authorize with it. The synchronized Sui verifier derives every object ID from the trusted Object Registry/type origin, fetches current policy/grant objects, walks the complete bounded ancestor chain, and only then promotes the grant to `sui_confirmed`. If the current deployed world lacks `assembly_access`, shared smart-assembly access fails closed. Portable and field-assembly grants are immediately active because their durable local policy is authoritative.

Cross-owner cargo custody is a separate transaction boundary. The Move module validates direct deposit/withdraw grants and emits an operation-ID-bound event for ship/storage or atomic storage/storage movement. The server verifies the finalized event against the exact actor, assemblies, type, and quantity, rechecks the source item after that asynchronous read, then commits the game owner/location mutation with a durable idempotency receipt. GUI access or `operate` never implies inventory custody; delegated grants cannot carry custody capabilities.

Tribe and faction grants authorize current members, not a copied list of character IDs. The resolver verifies current tribe membership or the confirmed NPC faction profile/commitment each time a privileged operation begins. Leaving a tribe/faction, rotating its authority, revoking its commitment, an NPC incarnation mismatch, grant expiry, or a newer revocation immediately invalidates cached authorization. An entity-level grant remains bound to the persistent player or NPC character identity across ship changes and NPC respawns, but never transfers to a reused ship entity ID.

Opening an assembly GUI returns a short-lived, assembly-bound session capability containing the subject, allowed GUI panels/actions, policy revision, and expiry. It is opaque to the client and is not a transferable bearer credential. Every GUI RPC and every NPC assembly job re-resolves or revalidates authorization at commit time; a window opened before revocation becomes read-only or closes on the next refresh, and an already queued operation cannot commit using stale access. Destructive or strategic actions can additionally require fresh transponder proof or owner confirmation according to assembly policy.

NPC behavior represents an access request as a durable Phase 0 job step such as `awaiting-assembly-access`, then suspends on the request ID instead of polling. The implemented NPC entry point returns the request ID, wake-event key, and this checkpoint shape without persisting private membership material. Approval wakes the job and causes a fresh capability check; denial, expiry, or revocation causes policy-directed replanning, escalation to the faction planner, or safe cancellation. The access-event cursor and outstanding request/grant references are included in the Phase 0 checksum, snapshot, and restart recovery boundary. Access loss never causes an NPC to abandon inventory in an inconsistent custody state: active inventory or travel transactions finish or compensate at their existing durable boundary before the job releases its reservations.

Server APIs and NPC behavior can use this model without a client change. Player-facing request, inbox, share, scope/capability picker, active-access list, expiry editor, and revoke controls require assembly-GUI client work. The GUI must explain whether access is direct, tribe-derived, faction-derived, or delegated and must never display private transponder inputs or secret membership receipts to another principal.

### 3D. Smart Industry lanes

Durable NPCs can execute one or several lanes on an existing Smart Industry facility through the same blueprint, shared input escrow, per-lane policy, paid-run commit, and output escrow used by players. An `industry.production` job binds one facility and one blueprint to a unique, bounded set of lane IDs and run counts. It reserves every selected lane before moving materials, so another durable worker cannot be assigned overlapping work.

The executor follows this state flow:

```text
validate facility, locality, and access
→ reserve selected lanes
→ load the owner blueprint when needed
→ calculate and stage exact aggregate inputs
→ start each paid lane independently
→ settle every lane to its requested run count
→ verify output cargo capacity
→ collect only the output delta produced by this job
→ complete and release reservations
```

NPC facility validation recreates the durable actor from the authoritative native record and requires the current NPC incarnation, canonical ship, same solar system, a completed/non-activating facility, and the same 5 km interaction boundary as the player path. An owner-controlled facility may load its blueprint. A delegated NPC must use the already selected blueprint and pass both the lane policy and the assembly `operate` capability. Cross-owner input deposit and output collection additionally require `inventory.deposit` and `inventory.withdraw`, respectively.

Inputs remain faction- or NPC-owned ship cargo until a journalled custody operation moves an exact stack quantity into the facility owner's input escrow. Outputs are moved back to the faction-owned NPC ship only after all lanes complete. Both directions use durable idempotency receipts and reconstruct the native cargo mirror, so restart recovery cannot duplicate or lose a split stack. Committed output-custody operations are also the authoritative per-job collection counter: a crash after custody commits but before the behavior checkpoint cannot collect the same quantity twice, and independent jobs are not coupled to a stale shared-escrow baseline. Output collection accounts for the effective fitted cargo capacity before it commits any withdrawal.

Each paid lane persists a deterministic executor key derived from the NPC job and lane. If the facility commits a paid run but the process dies before the behavior checkpoint is written, the restarted executor recognizes and adopts that exact run rather than treating its own lane as foreign production or charging the inputs again. A lane occupied by a different executor remains suspended and is never overwritten.

Missing inputs publish one deduplicated `industry-material-request` and suspend without partially starting production. Construction templates may author `loadout.industryLanes` and `collectIndustryOutputs`; once the template's Industry facility is fully constructed and loaded out, it creates one idempotent child `industry.production` job. Template lanes must be unique, within the enabled facility lane count, bounded to one million runs per lane, and use the same valid facility blueprint because recipe and escrow are shared.

No client modification is required for NPC-authored Industry execution. Players continue to use the existing multi-lane Industry panel. This phase adds no new Move publication requirement of its own, and no smart contract was published, upgraded, or deployed as part of this implementation.

## Phase 4 — faction backup coordinator

> **Status: Complete for durable same-system coordination.** Cross-system response execution depends on Phase 5.

Phase 4 is implemented by `server/src/space/npc/npcSupportCoordinator.ts` and the Phase 0 persistence extensions in `npcRuntimePersistence.ts`. `NpcSupportCoordinator` now owns durable-NPC distress dispatch. Transient Drifter encounter packs retain the direct-spawn compatibility path because they have no durable pilot identity or resumable work; durable Drifters route their authored reinforcement definitions through the coordinator.

A durable incident contains:

- Incident and deduplication IDs
- Requesting NPC and faction
- Threat target and severity
- Required roles
- System and position
- Expiry and cooldown
- Maximum responder count
- Transponder/faction authorization result

Candidate preference is:

1. Capable nearby faction NPCs.
2. Idle reserves in the same system.
3. Responders able to travel from another system.
4. Policy-controlled reserve spawning as the last fallback.

Responders checkpoint and suspend their previous jobs, accept a support job, then resume. Group-level cooldowns prevent reinforcement storms. Tactical distress traffic remains off-chain.

### 4A. Durable incidents and storm control

`requestNpcSupport` derives authorization from the authoritative durable NPC record. It does not accept caller-asserted faction or transponder membership. The persisted audit result contains only public faction identity and optional public commitment metadata; transponder codes, salts, preimages, wallet seeds, and receipt tokens are never persisted. Requests are deduplicated by requester, faction, target, system, and support group. A separate faction/group cooldown rejects new incidents until its durable expiry, including after a restart.

Incidents are checksummed with the Phase 0 runtime aggregate and have active, resolved, expired, and cancelled states. They store severity, required roles, location, expiry, responder limit, authorization, policy, and assignment history. Incoming aggression for a durable NPC requests an incident before the combat loop propagates the target. Resolving or expiring an incident causes each responder to finish its assignment safely on its next behavior tick.

### 4B. Capability-aware dispatch

Responder capability is derived from the Phase 1 effective fitting rather than hull or item names. Weapons add combat capability, remote repair adds logistics, hostile utility adds tackle, scanners add scout, and a jump drive adds travel capability. Authored behavior roles can provide an additional role. Selection is bounded by the incident responder limit and ordered as follows:

1. Fitting-capable faction NPCs inside the configured local response radius.
2. Same-system capable reserves, with idle responders preferred on ties.
3. Cross-system responders only when the incident permits them and their fitting or a registered route adapter says they can travel.
4. Durable reserve spawning only when an explicit policy enables it, capped by both the responder limit and reserve-spawn limit.

Cross-system support jobs stop at `awaiting-system`; Phase 4 never teleports a responder. Phase 5 can advance that same job after a gate or jump-drive transition.

### 4C. Interruption and recovery

Assigning a responder is one atomic persistence mutation. Its current queued, running, or suspended job becomes `interrupted`, a `support.respond` job is created, and the incident assignment is recorded together. Ordinary job creation treats interrupted work as non-terminal and cannot overwrite it. Completing, cancelling, or failing support atomically closes the support job and restores exactly its recorded predecessor to `queued`, preserving the predecessor checkpoint and reservations.

The support handler directs the existing combat controller at the threat; it does not implement a second combat system. Missing threats use a grace window before resolving the incident, and cross-system responders remain event/timer suspended. Incident records, support jobs, predecessor links, cooldowns, and assignment outcomes survive restart through the Phase 0 checksum/snapshot path.

### 4D. Signals and defense readiness

A resource signal is not itself a combat incident. `FUEL_EMPTY`, `POWER_USAGE_OFFLINE`, or `POWER_LIMIT_EXCEEDED` generates maintenance, logistics, or capacity work and updates the planner's defense-readiness view. It calls `NpcSupportCoordinator` only when an independent tactical threat exists and the node transition materially changes the required responder roles or severity—for example, powered defenses dropping during an active attack. The incident deduplication key remains threat-based, so repeated node transitions cannot summon additional fleets.

When defense assemblies are unavailable, candidate selection may prefer mobile combat/logistics fittings and avoid responders whose launch, repair, or route depends on the failed node. When the node recovers, the coordinator does not dismiss an active threat; it only resnapshots capabilities and lets the threat lifecycle determine resolution.

No client modification is required for Phase 4. Player-visible distress controls, incident displays, or faction dispatch administration would be optional future RPC/UI work; NPC aggression and authored policy use the server path directly.

## Phase 5 — cross-system travel

> **Status: In progress.** Gate, catapult, jump-drive, maintenance, and route-state prerequisites exist; the unified NPC route executor and crash-safe cross-system transition journal remain to be implemented.

Create a route graph with typed edges:

- Static stargate
- Linked smart gate
- One-way smart catapult
- Ship jump drive
- Future jump bridge or conduit

Each edge exposes access, online state, fuel cost, risk, estimated duration, and prerequisites. Smart gates require a valid reciprocal link, online/fueled assemblies, and faction/transponder access. Catapults require only a valid online/fueled source and destination configuration. Jump drives require a compatible online drive, fuel, range, beacon/cyno, and clear fatigue/cooldown state.

The route graph treats the selected source assembly's network node as a dependency. `FUEL_EMPTY` or `POWER_USAGE_OFFLINE` immediately invalidates gate/catapult edges powered by that node. `POWER_USAGE_HIGH` may increase edge cost or reserve the edge for higher-priority traffic, while `POWER_LIMIT_EXCEEDED` prevents a planner from assuming a requested travel assembly can come online. Recovery to a usable band marks the edge eligible for reevaluation but never bypasses reciprocal-link, destination, faction, fuel, or Sui-state validation.

Route jobs persist the signal sequence/revision used for their plan. They resnapshot and revalidate immediately before source dematerialization. A signal received before that boundary returns the job to route planning; a signal received after source dematerialization is handled by the travel journal and may not strand or duplicate the NPC by simply cancelling the operation. Signals therefore influence planning and wakeups, while the transition journal remains the sole travel authority.

Extract session-independent ship transition operations from the player transition runtime. NPC transfer is journaled as:

```text
PREPARING
→ SOURCE_DEMATERIALIZED
→ INVENTORY_MOVED
→ DESTINATION_READY
→ DESTINATION_MATERIALIZED
→ COMPLETE
```

Recovery resumes or compensates every boundary idempotently while preserving NPC identity, incarnation, equipment, cargo, job, and Sui profile references.

## Phase 6 — integrated faction autonomy

> **Status: Planning.** Earlier phases provide most domain primitives, but no single durable faction planner yet coordinates the full loop.

Faction planners issue strategic jobs rather than directly manipulating ships. Example flow:

1. Mine construction resources with compatible player-supplied tools.
2. Deliver them to field storage.
3. Build and fuel a network node.
4. Consume the node's durable resource signals and maintain a canonical faction infrastructure view.
5. Create deduplicated refueling, capacity, or deliberate load-shedding work when bands change.
6. Construct or operate smart gates and catapults only when current node state permits it.
7. Dispatch guards when builders call for backup.
8. Route haulers through currently available infrastructure.
9. Select a jump drive when it is faster or no usable gate route exists.
10. Request the minimum assembly capabilities required by a blocked job, and share bounded access with assigned players, NPCs, tribes, or factions when policy permits.
11. Replan when fuel, power, access, grant expiry/revocation, threat, or assembly state changes.

The faction planner consumes signals once per faction/command-node cursor rather than once per NPC. It converts a transition into a bounded durable job and lets normal NPC candidate selection assign the worker. Suggested urgency and lanes are:

- `FUEL_EMPTY`: `CRITICAL` with `MAINTENANCE | LOGISTICS | ENERGY`.
- `FUEL_LOW`: `HIGH` with `LOGISTICS | ENERGY`.
- `POWER_LIMIT_EXCEEDED` or `POWER_USAGE_OVER_LIMIT`: `CRITICAL` for the blocked activation, with `ENERGY` plus that job's functional lane.
- `POWER_USAGE_HIGH`: `HIGH` planning work with `ENERGY`; it does not automatically offline a consumer.
- `POWER_USAGE_MEDIUM`, `LOW`, or recovered normal fuel: observation/resume events unless they unblock an existing job.

Planner decisions use hysteresis already supplied by the published bands and add per-node job cooldowns where an external action cannot immediately change the band. A planner must never manufacture fuel quantity, available energy, or route availability from a signal alone; every action begins with an authoritative resnapshot.

Faction Sui budgets limit sponsored transactions. Tactical behavior never spends directly; jobs reserve a bounded budget and the signer verifies faction ownership, NPC profile authorization, idempotency, and policy before submission.

## End-to-end completion scenario

The combined system is complete when a persistent faction NPC can:

1. Accept and mount an authorized player-owned mining module and charges.
2. Use the correct equipment against a reserved resource.
3. Call one bounded faction defense response when attacked.
4. Unload into field storage.
5. Gather materials and construct a faction-owned smart assembly.
6. Fund, fuel, and activate it through the faction wallet.
7. Observe a low/empty-fuel or high/over-limit transition exactly once, create one bounded corrective job, and resume dependent work only after canonical state confirms recovery.
8. Invalidate and replan a gate/catapult route when its network node becomes unavailable without cancelling a travel operation after source dematerialization.
9. Travel through a linked smart gate or one-way catapult, or use a compatible jump drive.
10. Restart or crash at every durable boundary without duplicating identities, equipment, cargo, signal-derived jobs, assemblies, travel operations, or Sui transactions.
11. Recover from a truncated signal journal by resnapshotting current status rather than replaying an incomplete history.
12. Respawn with the same persistent NPC and Sui profile identities while advancing its incarnation and applying the configured equipment-loss policy.
13. Request an assembly's minimum required access, receive a bounded direct or group grant, expose only the permitted GUI/actions, and stop or replan safely when that grant is revoked or expires.
