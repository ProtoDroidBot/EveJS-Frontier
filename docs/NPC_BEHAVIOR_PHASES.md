# Persistent NPC behavior roadmap

This document preserves the implementation plan for durable autonomous NPCs. The phases are deliberately ordered so that equipment custody, resource production, construction, signal-driven infrastructure recovery, reinforcement dispatch, and inter-system movement cannot duplicate identities, items, resources, or blockchain transactions after a server restart or crash.

Status snapshot: 2026-09-24.

## Implementation status

Status terms in this document mean:

- **Complete**: the planned server/contract foundation is implemented and covered by focused tests. Optional player-facing UI or additional content adapters may still be planned.
- **In progress**: a usable subset or prerequisite exists, but at least one required end-to-end boundary is not implemented or activated yet.
- **Planning**: the design and dependencies are recorded, but the phase's coordinating runtime is not implemented.

| Phase | Status | Implemented now | Remaining work |
| --- | --- | --- | --- |
| 0 — crash-safe persistence | **In progress** | Behavior-tree primitives, durable jobs and reservations, incarnation-bound spawn leases, operation journals, reconciliation/quarantine, checkpoints, verified snapshots, durable assembly-signal cursors, atomic signal-to-job checkpointing, truncated-journal resnapshot recovery, and recovery tests. | Split piloted category-6 NPC ships from unpiloted category-11 faction entities without losing the latter's durable world state. Domain policy that converts network-node states into specific logistics/capacity jobs belongs to Phases 3 and 6. |
| 1 — fitting and equipment custody | **Complete** | Atomic player/faction item custody, player-compatible hull fitting, NPC-specific restrictions, semantic module roles, charge handling, destruction policy, restart recovery, server-authoritative trust/locality RPCs, trusted-only context action, and a player-facing NPC fitting window. | Expand authored NPC fitting profiles and replace/augment the narrow same-faction or explicitly authored trust rule when the broader NPC trust behavior is implemented. |
| 2 — resource work | **Complete** | Durable resource jobs, target reservations, lens-authoritative asteroid/Crude-Rift work, mining/crude/gas/ice tool selection, group-5133 salvageable-wreckage mining, canonical cargo, delivery/crash recovery, threat suspension, Phase 1 tool provisioning, and correct durable-NPC identity propagation into legacy module activation. | Register authoritative Salvager, recovery, and other resource adapters; extend Phase 3's signal-created fuel maintenance job into full acquisition/hauling when the authorized NPC has no compatible fuel in cargo. |
| 3 — assemblies and access | **Complete** | NPC construction sites, placement clearance, material fulfilment, atomic realization, durable network-node journal consumption and fuel jobs, approval-gated load shedding, player/NPC assembly access and client controls, verified cross-owner custody, crash-safe multi-lane Industry execution, lane-aware Sui storage, and upgrade-safe split-package tooling. The contracts are active and synchronized on Localnet chain `01e3bf5c`. | No remaining Phase 3 implementation work. Repeat synchronization and live verification after every Localnet reset or package change; a dedicated submitted feature-transaction smoke remains deployment hardening rather than an implementation dependency. |
| 4 — faction backup | **Complete** | Durable incidents, deduplication/cooldowns, fitting-aware responder selection, interruption/resume, same-system dispatch, cross-system job handoff, and restart recovery. | Optional player incident/dispatch UI remains planned. |
| 5 — cross-system travel | **In progress** | Shared route graph/executor for active or repairable static gates, reciprocal Smart Gates, one-way catapults, and fitted jump drives; network-node and live gate revalidation; cross-system support/resource/construction/industry/maintenance jobs; shared warp fuel/capacitor preflight; physical cargo-to-tank loading; jump fuel/heat/fatigue debit; durable transfer and recovery journal retaining NPC identity and cargo. | Faction fuel acquisition/hauling and initial provisioning, proactive route margin, explicit respawn fuel policy, signal-revision checkpoint/scored routing, and live-world end-to-end travel verification. |
| 6 — integrated faction autonomy | **Planning** | Its persistence, fitting, resource, construction, access, support, signal, and travel prerequisites are defined or partially implemented in Phases 0–5. Opt-in decision-tree shapes cover pilot work, scouting, transit, and support. Basic task-preparation, self-refit, ship-swap, and NPC-to-NPC fitting bindings exist without live registration and require a faction-paid dApp-control receipt before mutation. NPC-owned assembly and Industry mirror writes now select the confirmed faction wallet for gas. | Implement the faction planner, strategic job arbitration, faction site-spawn response, authoritative fitting-service/capability/custody/boarding ports and their live job registration, pilot ship spawning/boarding/swapping, guarded fuel-stranding and self-destruct policy, remaining mining/crude/construction/industry/hauling/refuel/scouting/transit action adapters, the unified on-chain dApp command/receipt interface for autonomous jobs, faction-level signal cursors, budget reservation, infrastructure/resource goals, route replanning, and the end-to-end autonomy scenario. |

The status above describes repository implementation. Optional client UI exists where a phase explicitly says so; Phase 1 includes NPC fitting and Phase 3 includes assembly-access management. Contract source completion is distinct from chain activation. A Localnet reset, package upgrade, or new base-world deployment requires the generated manifest to be synchronized and verified again before its package IDs are treated as live.

## World-contract deployment verification and package-split findings

This is an audit snapshot, not runtime configuration. The authoritative values remain the efctl-managed `world-contracts/deployments/localnet/world-features.v1.json` manifest synchronized by `FrontierWorld.ps1`. Historical `npc-deployment.json` schemas remain migration inputs only.

### Current chain-verified deployment

The 2026-09-22 efctl-managed deployment is active on chain `01e3bf5c` and is synchronized into EveJS and the Smart Assembly dApp. `FrontierWorld.ps1 sync` matched the live base world, Object Registry, Admin ACL, and schema-3 feature manifest before publishing the local configuration. A direct Localnet object read verified the Smart Industry package at version 1 with module `smart_industry`, including `LaneProduction` and `LaneProductionRecord` in its type-origin table, and verified the shared `SmartIndustryRegistry` at the exact manifest ID and type origin.

| Package | Current call package | Normalized module set | Registry/type check |
| --- | --- | --- | --- |
| Base world | `0xf32e66423ded25ac638f5d708d06dcaa4c8e08efd953cf5e2043d89dc77af859` | Base world modules | World, Object Registry, and Admin ACL match the synchronized deployment. |
| NPC | `0x93bdf01c80302ae1dd08cc5b6e99756a6dfbc76580ea9f108e689f74041ec3fc` | `npc` | Shared `npc::NpcRegistry` is synchronized at `0xc29cc8864531a99126363842b8506b23e7fd190cb62bb7d17830c7e23d8c7465`. |
| Assembly access | `0x3a9c4ee5179a2247b6aad38a441d2fe047c579cf81b6241fca1c14501a4edfef` | `assembly_access` | Shared access registry is synchronized at `0x497944820636ddfa3c260c5ef93b3f62aaa2ef95368c3ccedb5e6116b6141461`. |
| Catapult | `0x6574500e43fe541181208551acda668a731ab5e0c6424ace8990d1fe7c92b14f` | `catapult` | Shared catapult registry is synchronized at `0xe9543f21fdf24a462f8304cb6bafdfdaed3fb9d88f3801081fc4cd301fcfa4b6`. |
| Smart Industry | `0xb21bce02ded1c665bce0c935fa2467e87037b482a4a611820752605dbd9e1b43` | `smart_industry` | Live package and shared registry `0x399edf01d6a381131fb14672e29133b0446cd27687fd7ee76b89f0ab744ebc85` were queried directly and match the manifest type origin. |
| Transponder | `0x3f3a0f9c1dede227ee75e0447f2a75a8a95504712fa7bdcca98bb8775da4837e` | `transponder` | Shared transponder registry is synchronized at `0xefa5ba26346f94b97d18f6662a874363a5ece26397230e55cc5b9026d3c90f54`. |

This is a fresh split deployment, so each listed feature's type origin equals its initial feature-package ID. At the time of this chain audit, the authoritative and synchronized historical manifests agreed; current tooling migrates that data to `world-features.v1.json`. Synchronization also brought all 20 configured faction wallets to the common `10,000,000,000` MIST budget; it transferred `200,000,000,000` MIST from the admin and required no faucet request.

The ACL-protected NPC deployment simulator passed against chain `01e3bf5c` with transaction checks enabled. It verified all feature deployment objects, Character/NPC/PlayerProfile type bindings, lifecycle events, deterministic IDs, and that simulated objects remained absent; it was simulation-only, unsigned, and did not submit a transaction. Current Smart Industry tests pass 10/10 in TypeScript and 34/34 in Move, while the feature-upgrade tooling passes 4/4. A dedicated signed-and-submitted transaction smoke for each split feature remains useful operational evidence but is not represented by the read-only simulator.

### Incomplete deployment work and split-package risks

1. **Resolved for Phase 3 packages — supported upgrade workflow.** `scripts/upgrade-feature.sh` supports `smart_industry`, `npc`, and `assembly_access`, performs an exact-root/schema/package-split preflight, reuses the original `UpgradeCap`, preserves the type origin and registry, and changes only the latest callable package ID. It is dry-run by default and requires `--execute` for a chain write. Manifest updates use atomic files and recover the safe intermediate state where extracted IDs were staged before the public manifest. Other feature packages should be added deliberately as their upgrade policy is defined.
2. **Resolved — remove the cross-package access fallback.** `suiNpcWorldConfig.ts` now resolves assembly access independently: an explicit access override or synchronized feature manifest wins, otherwise the legacy monolithic base-world package is used. An NPC-only override can no longer redirect `assembly_access` calls to the NPC-only package.
3. **Resolved — version and rename the combined feature manifest.** Fresh deployments write `world-features.v1.json` with format `eve-frontier-world-features`, nested base-world identity, and independent capability records. Missing/unavailable capabilities no longer block valid records. Deployment addresses remain global. Faction policy uses `factions/default.v1.json` plus one canonical `factions/<factionID-factionStringOnlyID>.v1.json` file per configured faction; every faction manifest entry explicitly references fallback `default`, and a faction file either inherits or replaces the default capability allowlist. Policy schema 2 carries dynamic type membership, expanded allies/enemies with their expected codes, a combined optional leadership list, and separate commanders. The shipped lists contain no preset authority characters. The root `npc-factions.config.json` is the unified source used automatically by a full-workspace fresh deployment. This file boundary is ready to map to later on-chain faction objects. Runtime and dApp readers prefer the new world manifest and retain legacy fallback. Sync converts `npc-deployment.json` schemas 1–3, records incomplete triples under `migration.incompleteCapabilities`, archives a historical synchronized destination, and never silently promotes an incomplete capability.
4. **P1 — validate and hash every split artifact.** Sync currently proves the base deployment/publication binding and validates feature addresses, but it does not query the live call packages for their expected modules. The live verifier proves that package and registry objects exist but likewise needs module checks or a feature-specific dry run. Include the combined feature manifest and per-feature publish/upgrade artifacts in synchronized hashes; do not rely only on the shared base `Pub.localnet.toml` accumulator.
5. **P1 — publish a base/feature compatibility matrix.** The split packages still depend on public bridge functions added to the base world, and access/transponder also depend on `world_npc`. They cannot be treated as installable on an arbitrary older base package. Record the minimum base and NPC ABI for every feature and test upgrade combinations. Base-package guards also do not retroactively change callable bytecode from older package versions, so identity hardening must account for historical entry points.
6. **Resolved — make the deployment reproducible from source control.** The split feature packages, deployment/configuration scripts, tests, and supporting documentation live in the efctl-mounted `world-contracts` checkout. Upgrade tooling rejects an ambiguous Git root so the older standalone checkout cannot silently receive manifest updates. Generated deployment artifacts remain ignored and are reproduced by efctl from that exact checkout.
7. **Partially resolved — complete current-chain efctl validation.** The current deployment is synchronized, its live package/registry bindings were checked, the NPC read-only transaction simulation passes under the protected service/admin configuration, and focused Industry/upgrade tests pass. Dedicated signed-and-submitted access, catapult, Industry, and transponder transaction smoke tests remain deployment-hardening work. Keep the private deployment config protected rather than loosening its ACL.
8. **Resolved and active — on-chain Industry lane model.** `world_smart_industry` stores an atomic, revision-bound vector of one to sixteen sorted lane records under a new dynamic-field key while retaining lane 1 under the legacy production key for older readers. Server and contract clients verify all lanes and fall back only when the lane record is absent. The package and shared registry are active and synchronized on chain `01e3bf5c`; the live package exposes both lane types and all focused Move and TypeScript tests pass.

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

For the current IFF test phase, an NPC transponder code is faction-only: `FACTION` or `FACTION:SHARED_SUFFIX`. Every NPC in the same configured canonical faction uses that exact value regardless of profile or spawn group. Factionless NPCs do not synthesize IFF codes, and external code discovery/interrogation remains planned rather than being exposed through profile or spawn metadata.

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

The durable journal supplies `sequence`, `oldestSequence`, `nextSequence`, and `truncated`. The Phase 3 Network Node coordinator persists a cursor per faction command node, observed assembly, and signal type; the future Phase 6 faction planner will use the same boundary. Processing is idempotent by `{assemblyID, signalType, revision}`. If `truncated` is true, the consumer discards incremental assumptions, reads `getAssemblyOperationalStatus`, fetches exact network-node status, rebuilds its derived view, and only then advances the cursor. In-process `subscribeToSignals` is a latency optimization; restart recovery always uses the durable journal and current-status resnapshot.

Signal authorization follows assembly ownership and faction registration. NPCs observe faction nodes through an online, faction-registered command node. A signal never carries a private transponder code, salt, wallet key, or membership receipt, and a caller-supplied signal payload is never treated as authorization. The existing Sui/local assembly state remains authoritative for online status, confirmed energy reservations, and mutations.

Signals translate into behavior events and durable jobs rather than executing inventory or assembly writes inside a callback. Repeated equivalent status is naturally deduplicated by the signal producer; the NPC layer additionally deduplicates generated work by node, problem class, and signal revision. Recovery reads canonical state before resuming a job so an old warning cannot cause a second fuel delivery, activation, or load-shedding operation.

## Phase 0 — crash-safe behavior and persistence foundation

> **Status: In progress for NPC classification.** The crash-safe foundation is implemented, and Phase 3 and Phase 6 can consume assembly journals through its durable cursor/reconciliation API. The piloted-ship versus unpiloted-faction-entity boundary below remains to be implemented.

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

1. Durable identity: for a piloted ship, NPC character ID, identity slot, faction key, faction wallet, Sui profile objects, incarnation, and respawn policy; for an unpiloted faction entity, a durable world-entity identity and faction association without a pilot record.
2. Durable simulation state: system, position checkpoint, damage, fitting, cargo, ammunition, fuel, job, and reservations.
3. Recoverable operations: spawn, destruction, construction, cargo custody, fitting, travel, and pending Sui transactions.
4. Ephemeral runtime state: target locks, active effects, steering velocity, scans, event inboxes, and blackboard caches.

Current pilot jobs and leases bind to `npcCharacterID` and `incarnation`. `entityID` remains the current physical object identity. A delayed action from an earlier incarnation cannot control a respawned pilot ship. Entity-only work will need an equivalent generation/revision guard tied to its durable world identity, not a fabricated pilot character.

### 0B.1. Piloted ships versus unpiloted faction entities — pending runtime split

An in-game NPC pilot belongs to an SDE **Ship** (`categoryID = 6`) and may have a pilot identity/character, profile, incarnation, and ship fitting. A faction object whose SDE category is **Entity** (`categoryID = 11`) is not a pilot merely because its model or name resembles a ship. It must not acquire an NPC pilot ledger entry, NPC character ID, or pilot Sui Character/PlayerProfile/NpcProfile by default. It must still retain its own persistent world state: stable entity identity, faction, system and position, condition, modules/fittings and cargo where applicable, controller/behavior state, and restart/crash recovery. Classification should use the authoritative physical type's SDE category, not its display or slim category, and should fail safely if that type cannot be resolved.

This is a requirement, **not current behavior**. `nativeNpcService.ts` calls `ensureNpcPilotIdentity` during spawn and materialization without a category guard; existing category-11 NPCs can therefore already have pilot records. The implementation must separate pilot-bound leases, jobs, access principals, and on-chain provisioning from durable entity persistence, then migrate or quarantine pre-existing category-11 pilot bindings without dropping their entity, equipment, or world-state records. Entity-only faction actors should retain faction IFF and whichever non-pilot interactions their capability policy permits. Do not delete an existing pilot record merely because a category-11 type is seen at startup.

Faction start geography is now configured as `startingRegion: { regionID, solarSystemIDs }` in `npc-factions.config.json` and copied into split faction policy files. When a faction has a `regionID`, the respawn-seed selector chooses randomly among all known solar systems in that region. Only if the region has no known systems does it use `solarSystemIDs` as a fallback; the shipped numeric factions seed that fallback from their SDE home-system fields. Factions without reliable geography have neither value. These are starting seeds, not durable active territory: restart recovery still restores the persisted NPC system/character state, and later migration/respawn work must record moved territory separately rather than rewriting the original start region. Some EO-era faction IDs have incomplete Frontier NPC data, so an SDE home-system fallback does not imply spawn-ready profiles.

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

Exactly one active physical ship may represent a persistent NPC pilot identity. Duplicate pilot identity records are quarantined, with the pilot identity ledger's `activeEntityID` preferred as the canonical record. Unpiloted faction entities need equivalent duplicate detection by durable world-entity identity without consulting or creating a pilot ledger entry.

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
9. Rehydrates non-quarantined durable controllers; startup members are materialized only while their rule is active.
10. Lets authored startup populations fill only missing slots without replacing surviving IDs or fittings.

Invalid records are retained as evidence and excluded from materialization. Recovery does not silently discard an ambiguous identity or invent replacement inventory.

Native NPC spawn sources now share one durable lifecycle, including belt, dungeon, command, generated, and authored startup spawns. Entity IDs, fittings/cargo, condition, movement, behavior overrides, and manual orders are checkpointed and restored. A disabled startup rule leaves its durable NPC dormant in storage; re-enabling it can restore that same member. Legacy runtime-only NPCs from before this change cannot be recovered retroactively if they were never written to disk. The persistence mechanism exists for category-11 faction entities, but its current pilot allocation must be removed through the pending classification/migration work above.

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
- Category-6 NPC ships acquire pilot identities and retain their ship state after restart; category-11 faction entities never acquire new pilot entries yet retain the same entity ID, faction, equipment, condition, and controller state after restart. Existing category-11 pilot bindings are handled by an explicit migration or quarantine test.

Crash injection should terminate the process after every durable operation checkpoint. After restart there must be one active NPC per identity, stable Sui profile IDs, conserved inventory, no duplicated transaction, and a resumable or safely compensated job.

## Phase 1 — player equipment custody and NPC fitting

> **Status: Complete.** Server custody, trusted RPC access, context action, and the build-3502403 NPC fitting window are implemented.

Phase 1 is implemented server-side in `server/src/space/npc/npcFittingService.ts`. The atomic `NpcFittingService` moves a real player or faction item into NPC custody while retaining its canonical item identity and provenance. It validates slot, CPU, power grid, charges, NPC capability, and faction hardware policy. Unfitting returns the same item unless it was legitimately destroyed. Partial module and charge stacks keep the selected canonical item ID on the fitted or loaded item; a new ID is assigned to the remainder.

NPC loadout selection is semantic: weapons, ammunition, remote repair, mining tools, salvage, tractors, scanners, cloaks, propulsion, jump drives, and fuel. Equipment now carries a primary `semanticRole` for fitting policy plus a `semanticRoles` capability set for multi-purpose use. This prevents tools such as the Cutting Laser and Needle from being reduced to mining-only equipment: their primary policy role remains `weapon`, while mining jobs can still select their `mining` capability. The Crude Extractor remains mining-only because its held-beam profile explicitly disallows combat damage.

Classification is authored-data-first. Legacy non-skillshot miners and harvesters are recognized from their mining Dogma effects, and legacy turret/launcher equipment is recognized through the shared weapon-family resolver. Creation/modular equipment is recognized from `creationModules`, with its behavior, capability, system, root-placement rule, and hardpoint/compatible-hardpoint declarations retained in the NPC equipment record. Creation repair, propulsion, scanning, and weapon capabilities map to their NPC semantic roles; modular interiors without an executable NPC behavior map to `passive` instead of being rejected as unknown. An equipment profile also records whether activation is ordinary Dogma, skill-shot, or held-beam. These classifications make the full equipment catalog fit-visible and behavior-discoverable without falsely claiming that every Creation ability already has an NPC behavior adapter.

The existing fitted-module combat paths should be reused. Legacy combat modules already enter those paths through the shared weapon-family resolver. Fitted propulsion remains disabled until synthetic navigation and module propulsion share one movement authority. Creation layout metadata is preserved for the future NPC-specific modular fitting validator; current player-compatible hulls still obey ordinary player fitting, while NPC-specific hulls use their authored role-slot restrictions.

Every custody change uses a Phase 0 operation journal so a crash cannot place one item in both player and NPC inventories or in neither inventory.

### 1A. Player-compatible and NPC-specific hulls

Piloted NPC ships use ordinary player fitting rules wherever their category-6 physical hull resolves to a player ship type. A spawn may set `playerFittingHullTypeID` explicitly when its NPC inventory type is only a presentation shell for a player-compatible hull. A category-11 SDE entity hull (such as the Osa Frigate) may still expose its physical type as a fitting host when no player-hull mapping or authored slot profile exists; that fitting capability does **not** make it a piloted ship or authorize creation of a pilot entry. The same live fitting validator decides which modules, slots, and resources are valid. Standard fitting validation enforces slot family, hull type/group restrictions, hardpoints, calibration, CPU, and power. NPC fitting intentionally skips player-character skill prerequisites because capability and faction policy are the NPC authorization boundary.

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

Server jobs, admin tooling, and NPC AI still use the custody service directly. The build-3502403 right-click celestial menu adds ordinary, non-GM `Interact` and, when fitting trust is granted, `Modify Fittings` entries beside the native actions for category-6 NPC ships with a pilot. The Interact keyboard action routes through the HUD primary-action resolver into the same small NPC interaction window. The server's player RPCs require a category-6 physical ship with an NPC character whose pilot ledger entry is actively bound to that entity; they fail closed if the ledger is missing, stale, or unavailable. Category-11 faction entities retain their equipment, behavior, and persistence, but expose neither the player NPC fitting window nor the player NPC Orders panel. For eligible ships, `CanInteractNpc` also requires 5 km locality and a positive authenticated faction relationship, fitting trust, or matching IFF; the window only shows `Modify Fittings` when fitting trust is separately granted. `OpenNpcFitting` performs a second state read before constructing the fitting window. Refresh, fit, unfit, charge-load, and charge-unload each re-evaluate pilot binding, locality, 5 km range, and trust. If the pilot binding or trust is revoked or cannot be revalidated, the open fitting window fails closed on its next refresh or action.

The trusted fitting probe and state identify the hull's `creation` or `legacy` fitting path from its Creation template. A legacy NPC uses a target-bound controller to seed the built-in fitting window's simulation with that NPC's exact fit. Its Apply to NPC action checks the live target and commits module and charge changes through `npcFittingMgr`, where pilot binding, trust, range, and item ownership are checked again. If the native simulation cannot represent the initial fit, the existing NPC RPC window remains available and reports the native failure. Creation management still loads and commits the session's active ship; a separate NPC Creation draft and layout bridge is required before a modular NPC can use that built-in view.

The interaction window now has a preliminary NPC Orders panel. The primary Interact key opens that panel; a player can use an active target or enter a target entity ID, then request Approach, Keep at Range, Orbit, or Lock Target, with Resume Autonomy to clear the manual order. `npcFittingMgr.IssueNpcOrder` accepts only these command types, rechecks the authenticated commander's trust and 5 km proximity to the durable NPC, and validates that the target is live in the same local scene. It constructs a sanitized order with weapons disabled and a server-authored `commandSource` identifying the player; the existing `npcService.issueManualOrder` / behavior loop performs movement and lock acquisition. Navigation orders can follow a friendly ship without making it a combat target. These orders are WIP and not a combat-command UI. Future faction-directed and blockchain-originated orders should enter through the same server-side order executor after their own source-specific authentication, replay protection, priority, and revocation rules; the client RPC does not grant those authorities.

### 1D. Planned NPC pilot fitting and ordering authority

NPC pilots fitting or ordering other NPC pilots, and NPC pilots fitting or ordering unpiloted faction entities, need a separate server-side actor path. The acting pilot must be resolved from its active category-6 ship and ledger lease, with faction authority, local presence, equipment custody, and target relationship checked at execution time. A piloted target can use its pilot identity and faction policy; an unpiloted category-11 target needs entity-specific capability and authorization rules without inventing a pilot identity. The player `npcFittingMgr` RPC must not accept a client-supplied NPC actor or reuse player trust as NPC authority. The eventual executor should distinguish player, pilot, and faction command sources, define order priority and revocation against autonomous behavior, and journal custody and order changes across restarts and pilot ship swaps. Tests should cover pilot-to-pilot and pilot-to-entity actions, enemy and stale leases, missing target capability, cargo ownership, duplicate commands, and recovery after each durable step. These NPC-initiated flows remain planned; Phase 6 has an opt-in decision scaffold, not a live executor.

Client staging note (2026-09-23): the live staged build-3502403 archive, manifest, and stage marker were reconciled with a verified backup. Only the NPC menu and primary-action bytecode members changed; unrelated Creation members retained their exact pre-reconciliation payloads. The normal stage verifier reports all code adapters patched and the stage valid. Restart the client to load the new order UI.

The later NPC legacy target-controller upgrade changed only `eve/client/script/ui/eveCommands.pyc` inside the staged archive. The stage transaction refreshed the manifest and marker, and the verifier reports a valid build. A client restart is needed to load this fitting controller.

The primary-action click callback accepts HUD-supplied event arguments. The dedicated NPC Orders window opens even if its server probe is denied or unavailable, showing the reason and a Retry Interaction button while hiding privileged controls. A regular right-click Interact entry for native NPC IDs opens the same window; fitting and order actions remain gated by their respective live server permissions. This prevents a visible Interact key from failing silently during server/client version mismatches.

The durable trust rule accepts an authenticated same-faction or configured allied-faction player, or a character explicitly listed under `npcFittingTrust.trustedCharacterIDs` (the `trustedFitterCharacterIDs` compatibility field is also accepted). `npcFittingTrust.deniedCharacterIDs`/`deniedFitterCharacterIDs` takes precedence. For Localnet debugging, the shipped `npc-factions.config.json` currently sets `debugFittingTrust.allowNearbyPlayers: true`, temporarily letting any authenticated player within the local 5 km interaction scope manage fittings unless explicitly denied. Set it to `false` before deploying outside the test environment. A shareable IFF code is not durable fitting authorization. `registerNpcFittingTrustResolver` is the extension boundary for planned standings and behavior-tree trust; the client cannot submit or assert trust.

The RPC returns only sanitized hull, policy, fitted-module, charge, and active-ship-cargo rows. Custody provenance is not exposed. Player-supplied modules and charges must be owned by the authenticated character and located in that character's active ship cargo hold. The client cannot select arbitrary source or destination locations, owner IDs, faction identity, authorization lists, or idempotency keys. Existing player fitting and Creation management remain unchanged.

## Phase 2 — general resource work

> **Status: Complete for the common executor and mining-family adapters.** Additional resource adapters and automatic fuel acquisition/hauling remain planned extensions; Phase 3 now creates and executes signal-driven deposit jobs when compatible fuel is already available to an authorized NPC.

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

Resource yield produced by a durable NPC is now a canonical `items` row. The native cargo mirror uses that exact item ID; only legacy transient mining actors retain their lightweight negative/allocated cargo path. Legacy durable mining cargo is migrated into a canonical stack the next time that resource type is appended. Cargo volume is reconstructed from authored item metadata after a restart, so threshold decisions remain stable.

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

> **Status: Complete.** Construction, placement, fulfilment, durable network-node coordination, approval-gated load shedding, player/NPC access controls, client management UI, proof-checked cross-owner custody, multi-lane Industry execution, lane-aware Sui storage, and upgrade-safe package tooling are implemented. The rebuilt Localnet deployment is synchronized on chain `01e3bf5c`, and its live `world_smart_industry` package and shared registry expose the lane-aware model.

The implemented Phase 3 server foundation consists of:

- `server/src/space/npc/npcAssemblyActorContext.ts`
- `server/src/space/npc/npcConstructionJobService.ts`
- `server/src/space/npc/npcConstructionTemplateJobService.ts`
- `server/src/space/npc/npcIndustryJobService.ts`
- `server/src/space/npc/npcNetworkNodeCoordinator.ts`
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

A missing material or fuel plan emits one deduplicated behavior event and suspends the job. A job assigned to another solar system uses the Phase 5 route executor and durable transition rather than teleporting the builder. Construction and activation timers survive through the canonical assembly state. Each external inventory/deployment operation is journaled and recovered on startup.

Field assemblies remain local/off-chain. Smart assemblies are locally owned by the durable NPC character ID, whose confirmed on-chain Character is controlled by the canonical per-faction wallet. The Sui assembly worker now selects that confirmed faction wallet as gas owner for NPC-owned assembly and Industry mirror transactions; owner-cap calls also use it as sender. Admin-only mirror calls retain the authorized server sender but require a second faction-wallet gas signature. Missing confirmation or gas fails closed without an admin-paid fallback. This path requires the updated base-world `access::verify_sponsor` package upgrade before NPC Industry/admin-only mirror calls will succeed: the deployed version may still require the gas owner itself to be in the admin ACL. Split Industry/Catapult packages must also be checked for linkage to the upgraded base-world code before enabling their faction-paid paths. Owner-cap calls that additionally require the admin ACL still need a scoped contract authorization path; faction gas alone must not imply broad admin authorization. Do not add faction wallets to that broad ACL. These mirror transactions are separate from Phase 6 autonomous on-chain jobs, which still need the unified dApp command/receipt interface and must use the faction wallet for both sender and gas. NPC code never receives wallet seeds or private keys. The public NPC profile, faction, wallet, job, and builder metadata are recorded for audit and faction registration.

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

`npcNetworkNodeCoordinator.ts` now consumes this journal with the Phase 0 cursor keyed by faction command node, observed Network Node, and signal type. It handles truncated history through the canonical resnapshot adapter, then reads exact fuel, power, and connected-assembly state before changing a job. It does not overwrite an unrelated suspension reason. Restoration returns only coordinator-gated jobs to their previous queued/running state. `FUEL_LOW`/`FUEL_EMPTY` create one revision-keyed maintenance job for an authorized same-faction NPC; the worker reserves exact cargo stacks, deposits through the idempotent NPC fuel boundary, and suspends safely when acquisition or an assembly grant is missing.

Load shedding is an explicit durable request, never an automatic side effect of observing high usage. Policy excludes essential and ineligible services, orders eligible consumers by the authored maintenance/defense/navigation/logistics/production priorities, and proposes only enough relief to clear the rejected reservation or leave the high-usage band. `get_npc_load_shedding_requests` and `approve_npc_load_shedding` require the authenticated player to hold `configure` on the Network Node. Approval records the selected recommended assembly IDs and a reason in the durable job. The NPC must then independently hold owner/job authority or a current `configure` grant on every cross-owner target before it can request an offline transition.

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

The verified build-3502403 `menusvc` adapter now probes the server before adding **Manage Assembly Access**. Its native window provides self-request and withdrawal, owner/delegate inbox approval and denial, typed player/NPC/tribe/faction sharing, capability and expiry inputs, active-grant revocation/relinquishment, public audit rows, shared-GUI session opening, and configure-authorized Network Node load-shedding approvals with an explicit reason. A shared-GUI open obtains and immediately validates the short-lived, session-bound token before invoking the native interaction; the token is never placed in the browser URL. Every action calls the authenticated server RPC and refreshes authoritative state; the client cannot supply an actor identity or bypass chain confirmation. Rows label owner access versus grant-derived access and show only public grant authority. The window contains no transponder, salt, preimage, membership-receipt, or wallet-key field.

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

No client modification is required for NPC-authored Industry execution. Players continue to use the existing multi-lane Industry panel. The Sui sidecar now writes every configured lane in one `LaneProductionRecord` dynamic field at the same revision as the facility snapshot. Lane IDs must begin at 1, be strictly increasing, and remain within the sixteen-lane bound. The legacy `ProductionRecord` is still written atomically from lane 1 so older readers remain compatible; new readers prefer the lane vector and fall back only when it is absent.

The upgrade path is intentionally separate from the destructive fresh-publish scripts. `scripts/upgrade-feature.sh smart_industry localnet` performs a no-write preflight/build by default; `--execute` is required to use an existing `UpgradeCap`. It preserves the original `industryTypeOrigin` and `industryRegistryId`, updates only `industryPackageId`, validates the extracted and public manifests, and commits the public manifest last with restart-safe recovery. The current environment used a fresh split deployment; its synchronized Industry package and type origin are therefore the same version-1 package ID.

## Phase 4 — faction backup coordinator

> **Status: Complete for durable same-system coordination.** Cross-system response execution depends on Phase 5.

Phase 4 is implemented by `server/src/space/npc/npcSupportCoordinator.ts` and the Phase 0 persistence extensions in `npcRuntimePersistence.ts`. `NpcSupportCoordinator` now owns durable-NPC distress dispatch. Newly spawned Drifter encounter packs use the same durable native identity and resumable-work path; the direct-spawn compatibility path remains only for legacy transient actors.

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

Cross-system support jobs delegate to the Phase 5 route executor; Phase 4 never teleports a responder. The same support job advances after a gate, catapult, or jump-drive transition.

### 4C. Interruption and recovery

Assigning a responder is one atomic persistence mutation. Its current queued, running, or suspended job becomes `interrupted`, a `support.respond` job is created, and the incident assignment is recorded together. Ordinary job creation treats interrupted work as non-terminal and cannot overwrite it. Completing, cancelling, or failing support atomically closes the support job and restores exactly its recorded predecessor to `queued`, preserving the predecessor checkpoint and reservations.

The support handler directs the existing combat controller at the threat; it does not implement a second combat system. Missing threats use a grace window before resolving the incident, and cross-system responders route through Phase 5 or suspend when no route/fuel is available. Incident records, support jobs, predecessor links, cooldowns, and assignment outcomes survive restart through the Phase 0 checksum/snapshot path.

### 4D. Signals and defense readiness

A resource signal is not itself a combat incident. `FUEL_EMPTY`, `POWER_USAGE_OFFLINE`, or `POWER_LIMIT_EXCEEDED` generates maintenance, logistics, or capacity work and updates the planner's defense-readiness view. It calls `NpcSupportCoordinator` only when an independent tactical threat exists and the node transition materially changes the required responder roles or severity—for example, powered defenses dropping during an active attack. The incident deduplication key remains threat-based, so repeated node transitions cannot summon additional fleets.

When defense assemblies are unavailable, candidate selection may prefer mobile combat/logistics fittings and avoid responders whose launch, repair, or route depends on the failed node. When the node recovers, the coordinator does not dismiss an active threat; it only resnapshots capabilities and lets the threat lifecycle determine resolution.

No client modification is required for Phase 4. Player-visible distress controls, incident displays, or faction dispatch administration would be optional future RPC/UI work; NPC aggression and authored policy use the server path directly.

## Phase 5 — cross-system travel

> **Status: In progress (runtime implemented).** Durable cross-system jobs now use a shared route executor for static stargates, reciprocal Smart Gates, one-way catapults, and fitted jump drives. Dormant managed stargates are repairable route steps using the existing material/fuel maintenance job. Cross-system transfer and cargo-to-tank loading have recovery journals. Faction-wide fuel provisioning, proactive hauling below a route reserve, signal-revision checkpointing, route scoring, and live-world end-to-end verification remain open; no new contracts are deployed by this phase.

### Phase 5 prerequisite — ship fuel parity

The build-3502403 fuel model has two intentionally separate consumption profiles, and the server now preserves that separation:

- **Instantaneous consumption** belongs to jump drives. The activation plan calculates the complete mass/distance/containment cost before the transition, atomically debits that fuel, and applies the fuel's thermal inefficiency as jump heat. A failed preflight or transaction consumes nothing.
- **Continuous consumption** belongs to running ship power, Creation active propulsion processes, and in-system warp. Warp adds its rate only after the ship leaves alignment and enters active warp; a canceled or failed alignment therefore consumes no warp fuel.

Regular engines use the client-authored continuous power factor `clamp(2 × fuelImpulse / fuelContainmentBurden, 1, 100)` and its squared engine-utilization penalty. Their active-warp addition is `abs(engineWarpFuelRate) × shipMass × 10^-6 / fuelImpulse`. Creation power uses `clamp(fuelImpulse / max(1, fuelContainmentBurden / containmentReduction), 1, 100)`, while Creation propulsion contributes its authored warp rate directly. Leap and Thrust Overdrive continue using fuel impulse, containment, and volatility for their distinct thrust/fuel tradeoffs. This makes high-impulse, high-containment, and high-volatility fuels behave differently instead of treating all loaded units as interchangeable.

All continuous consumers debit the authoritative FIFO fuel queue. If one fuel batch empties during a tick, the remainder of that same tick uses the next batch's impulse, containment, and other properties. Player warp preflight now requires an online compatible propulsion source and usable fuel for hulls with an authored Frontier tank. The check does not reserve fuel up front; actual active-warp time is what is billed. Tankless legacy ships retain their previous behavior.

Every in-system warp also requires at least 15% of the ship's total capacitor capacity. The server checks that threshold before destination materialization or departure side effects, rechecks it when alignment completes, and debits exactly 15% only when active warp begins. Alignment cancellation and activation failure do not consume the warp capacitor charge. This rule is actor-neutral and therefore applies to player ships and NPC ships alike.

The fuel runtime is actor-neutral, and NPCs are not given synthetic fuel. Native NPC profiles persist the opt-in `npcFuelRequirementsEnabled`; it defaults off so existing fleets keep their compatibility behavior. Phase 5 now loads compatible physical cargo stacks into an eligible NPC hull's persistent tank/queue through a recoverable operation when travel needs fuel. A fitted jump drive uses the shared jump cost/heat calculation and durably debits the tank or legacy cargo exactly once; its activation and fatigue delays use the player timer formula. Enabled NPC warp uses the shared 15% capacitor and continuous-fuel rules. A stranded job checkpoints one deduplicated fuel request and suspends rather than inventing fuel. Remaining logistics work is faction-supplied initial cargo, proactive route reserve and hauling below that reserve, and respawn fuel-loss policy. No Sui contract deployment is required for this runtime prerequisite.

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

Implemented route jobs re-snapshot the selected edge immediately before transfer. A static gate must also be open in the local scene; a managed gate that becomes dormant is replanned into maintenance rather than traversed. Smart routes require online reciprocal links (or a valid one-way catapult destination), and both source and destination network nodes must currently be online, fueled, and within power limits where bound. NPCs use the current player traversal policy for Smart Gates, which is public after a valid link; faction/transponder-specific traversal restrictions remain a policy extension, not an implicit bypass. The transition retains the NPC entity ID and cargo location ID, updates the persistent pilot system, and rematerializes the same controller at the destination. The operation journal recovers after each durable boundary.

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
12. React to a new site belonging to the faction: validate the site's current faction and lifecycle state, deduplicate its spawn event, choose eligible NPC pilots and roles, and dispatch them to defend, exploit, build, or maintain the site according to faction policy.

### Pilot and ship lifecycle — planned

A category-6 NPC pilot is a persistent character distinct from the ship it currently occupies. Phase 6 should let a faction assign that pilot to a newly spawned faction site, spawn the pilot in an authorized category-6 ship when needed, board another eligible ship, or swap ships as a player can. Ship changes must use the authoritative player-compatible boarding, ownership, inventory, fitting, and space-transition rules rather than rewriting the pilot's `entityID` or copying modules/cargo. Persist pilot-to-ship occupancy, abandoned or replacement hulls, jobs, orders, and custody across restart/crash boundaries; prevent one pilot occupying two ships or two pilots boarding the same seat. The pilot keeps its character/profile identity through ship changes, while each ship keeps its own physical entity and item identity.

For GM testing, `/spawnpilot <Ship typeID> [count]` creates an unaffiliated NPC pilot in a new physical category-6 ship; `/spawnosapilot <Ship typeID> [count]` uses the Osa faction key, corporation, and legacy faction ID from the Frontier dungeon configuration. Both commands generate a passive, empty fitting profile and grant the invoking character fitting trust when their character ID is available. Command-spawned pilots stay at their spawn position instead of using the global passive roaming and warp policy. Session command spawns discard a dungeon instance inherited from the invoking ship when that instance no longer resolves, so their balls remain visible beside the ship. The default faction hull membership includes category 6 for every faction. In build 3502403 this covers 583 ship types, including all three Creation template hulls; the existing Entity hull policy remains available for dungeon NPCs. `/spawn <NPC typeID> [count]` creates no pilot, and that decision survives reload. Autonomous faction ship assignment and boarding/swapping existing ship items remain Phase 6 work.

A stranded pilot should first request faction assistance or refueling, with a durable deadline and reassessment of reachable help, recoverable fuel, and available escape/boarding options. Self-destruct is a last-resort, explicitly authorized faction-policy action only after help cannot arrive in time; it must use the ordinary ship-destruction and equipment-loss path, journal the decision and result once, and leave the pilot's identity available for the configured respawn policy. No current low-fuel condition alone authorizes self-destruction. Category-11 faction entities remain durable unpiloted world objects and do not gain a pilot or player-style boarding lifecycle through site response.

Acceptance tests should cover duplicate/replayed site-spawn events, site ownership changes before dispatch, no eligible pilot or hull, boarding/swap custody and occupancy conflicts, restart during a ship transition, assistance arriving before the stranding deadline, and a policy-authorized self-destruct/recovery without duplicate hulls, inventory, or pilot profiles.

### Candidate decision-tree scaffolds — not live behavior

`server/src/space/npc/npcDecisionTreeScaffolds.ts` defines fourteen opt-in tree shapes using the Phase 0 selector/sequence/status primitives. It does not register or tick them in `npcBehaviorLoop.ts`. Compilation requires an explicit binding for every guard and action; a missing binding throws, a guard passes only on an explicit `true`, and every action returns the same Phase 0 behavior result (`success`, `failure`, `running`, or `suspended`, with a checkpoint/wake when needed). The behavior primitives may be injected by another host, and the catalog has no live-runtime import until compilation. These names are extension points, not claims that site dispatch, boarding, self-destruct, scouting, fitting, or specialist work branches are live. Live adapters must obtain authoritative state and use the existing durable job, custody, travel, and destruction services rather than mutating the blackboard as source of truth.

`server/src/space/npc/npcTaskActionAdapters.ts` now supplies the first opt-in bindings for `pilotTaskPreparation`, `pilotTaskRefit`, `pilotTaskShipSwap`, and `pilotNpcFittingSupport`. It validates the category-6 acting pilot against the durable ship record, job incarnation, and active pilot lease; a category-6 fitting target also needs its own valid pilot lease, while a category-11 target remains unpiloted. It persists a task plan in the durable job checkpoint, requires an authoritative plan-freshness check, routes one movement step per wake through a navigation port, applies at most one fitting change per wake with a stable job/plan/step idempotency key, and performs one atomic boarding step through a ship-custody port. Completed fitting/boarding records are checked before pre-commit inventory or hull guards on replay. The opt-in adapter also requires a unified dApp-control command receipt for the job and each state-changing fitting/boarding primitive; sender and gas owner must both be the confirmed faction wallet, and any sponsored/admin-paid receipt is rejected. Service authorization, exact task/tool capability, fitting-item policy, fitting mutation, occupancy/boarding, and NPC-to-NPC authority remain explicit ports that must return authoritative answers; missing ports suspend or deny. This is **not yet a registered job handler** and no dApp command submitter is wired, so it does not itself make an NPC fit, move, board, or submit a transaction in the live world. Wiring those ports must reuse the existing custody/travel/lifecycle services and add restart, lease-change, revocation, concurrent-action, and multi-item fitting tests before activation.

```text
pilotPriority (category-6 pilot only)
  emergency → authorized manual order → confirmed combat threat
  → fuel stranding → assigned faction site → pilotWork
  → unexpected warp-arrival discovery → patrol/idle

pilotWork (category-6 pilot with a ready durable job)
  current ship lacks task capability → pilotTaskPreparation
  otherwise execute a compatible task or explicit preparation/support job
  resource gathering → pilotResourceGathering
  structure deployment → player placement rules + construction tool/access
    → journal site placement → fulfil materials → realize structure
  manufacturing → authorized Industry lane + inputs/access → journal production
  resource hauling → valid cargo custody + route → journal load/travel/delivery
  self-refit → pilotTaskRefit
  ship swap → pilotTaskShipSwap
  fit another NPC → pilotNpcFittingSupport
  refuel friendly ship → compatible locked/ranged Creation Transfuser
    | authorized drop of physical fuel items for recipient pickup
  scout system → pilotScouting
  cross-system travel → pilotSystemTransit
  other registered durable job | suspend unclassified job

pilotTaskPreparation (due task with a capability requirement)
  already capable AND any existing plan settled → complete readiness
  otherwise checkpoint one authorized plan:
    refit the occupied ship | swap into a task-capable ship
  no available plan → suspend for equipment, hull, access, or service

pilotTaskRefit (NPC pilot fitting its own occupied ship)
  authorized fitting service + compatible items/policy
  → travel to refuge, hangar, or station with that service
  → recheck presence, authority, and custody
  → journal one fitting change per wake → checkpoint completed fit plan
  → verify the resulting ship can perform the assigned task

pilotTaskShipSwap (NPC pilot boarding a different task-capable ship)
  replacement ship still authorized, eligible, and unoccupied
  → travel to ship → journal occupancy/boarding transition once
  → verify the new occupied ship can perform the assigned task

pilotNpcFittingSupport (NPC pilot fitting another NPC)
  validate acting pilot, target principal, faction authority, and shared service
  → bring both to service → recheck items, policy, and custody
  → journal one target fitting change per wake → checkpoint completed fit plan
  → verify target capability

pilotResourceGathering (due resource job; small checkpointed steps)
  reserve source → choose one extraction adapter:
    asteroid or group-5133 compatible wreckage + matching mining tool/charge
    | Crude Rift + Crude Extractor/Crude Lens
  → checkpoint canonical yield/cargo → deliver to authorized storage
  → release stored resources for a later faction/player-like use
  missing source/tool → suspend without creating yield or storage

factionSiteResponse (faction planner, not a ship tick)
  verify new site + current faction ownership + open durable response
  → reserve durable response
  → threatened: defenders | infrastructure: builders | resources: workers | no work

pilotShipLifecycle (category-6 pilot only)
  approved ship swap → continue valid occupied ship
  → board eligible existing ship → spawn and board authorized ship → wait

pilotStranding (category-6 pilot only)
  recover/load fuel → request or await timely assistance → safe escape boarding
  → deadline expired AND aid unavailable AND faction policy authorizes:
     revalidate and journal self-destruct
  → otherwise hold and reassess

pilotScouting (category-6 pilot, due scouting job)
  at authorized destination → select the authenticated scouting intent:
    resources + resource sensors → journal resource survey
    | targets + target sensors → journal target survey
    | general + suitable sensors → journal general observations
  → stage bounded faction intel (not public location publication)
  different system → pilotSystemTransit
  missing intent, sensors, destination, or route → suspend until relevant wake

pilotDiscovery (category-6 pilot, queued warp-arrival event)
  safe to observe → checkpoint unexpected discovery → stage faction intel
    → acknowledge event once
  unsafe → defer without losing the event

pilotSystemTransit (category-6 pilot, due transit job)
  validate authorized destination; if already there, complete
  otherwise select/revalidate next edge from the shared route graph:
    jump drive + fitted/fuel/cooldown/range preflight
    | active or maintainable static stargate
    | reciprocal powered Smart Gate with current access
    | powered one-way catapult with valid destination
  traverse with Phase 5's durable transition journal; invalid edge → replan

factionEntity (durable category-11 entity with no pilot)
  protect entity → authorized entity order → entity-specific durable job → idle
```

The pilot and faction-entity roots are mutually exclusive by authoritative SDE category and pilot binding. A site response remains open across retries and `reserveSiteResponse` must be idempotent; a replayed event cannot create a second response. The site planner may assign several roles over successive durable planning passes; the scaffold selects one priority branch per tick, so the eventual adapter must record completed role assignments and re-evaluate the site. `RUNNING`/`SUSPENDED` leaf results stop lower-priority branches; durable wakeups belong in jobs and event journals, not a busy per-tick poll. Before wiring any tree live, implement the Phase 0 category split, define guard sources and action authorization, add telemetry for selected/blocked branches, and test interruption/recovery at every state-changing action.

Task preparation is a reusable capability gate, not a fitting loop every tick. On assignment or a relevant fit/hull/service revision, compare the occupied ship's actual fitted modules, charges, fuel, hull restrictions, and task-specific tools with the task requirement. Choose an authorized refit plan only when compatible equipment is in canonical custody and a real fitting service at a refuge, hangar, or station is accessible; a location's name alone does not grant fitting. Otherwise consider an accessible, suitable replacement hull. Checkpoint the selected plan and suspend if neither option is valid. At arrival and again immediately before the mutation, revalidate location, lease, fitting authority, module restrictions, inventory ownership, and capability. A successful fitting mutation or ship boarding must be idempotently journaled with a durable job/incarnation key; the pilot keeps its character identity while equipment stays with its physical ship. The completed/pending checkpoint guards must come from the same authoritative transaction record and be mutually exclusive. On replay, check the completed record and resulting capability *before* pre-commit item or hull eligibility: consumed items or a newly occupied hull should not block recovery or trigger a second mutation. A failed post-commit capability check suspends/replans rather than starting the specialist job.

Self-fitting and fitting another NPC share the eventual item-custody and capability validation service but have different actor authorization. An NPC acting on itself is the current category-6 pilot and its occupied ship. Fitting another NPC is an explicit support job: authenticate the acting pilot through its live lease, validate the target's relationship and fitting policy, require both at an authorized fitting service, and prevent concurrent fitting or boarding transactions against either ship. The target may be another piloted category-6 ship or a durable unpiloted category-11 faction entity if its entity-specific fitting rules allow it; the latter must not gain a pilot profile. These actions need a server-side NPC actor path, not the player-facing `npcFittingMgr` RPC. Revocation, target despawn/reincarnation, cargo transfer, or lease change must invalidate the plan before commit. The initial guarded action bindings exist, but authoritative service ports, durable transaction state, and recovery tests still block live registration.

The resource tree is a short composition of source-specific extraction and shared custody/storage steps, not a separate monolithic decision tree for each material. The mining readiness guard must use the resource executor's target/module/charge compatibility rules: basic legacy miners may not need a lens, crystal-capable miners need a target-valid crystal, and Cutting Laser/Needle need a loaded list-612 lens. Group-5133 salvageable wreckage that is compatible with the asteroid/mining loop follows that same guarded adapter, with its own authored yield. Crude Rifts use a different outcome and require a Crude Extractor with a loaded list-601 Crude Lens; ordinary mining equipment must not pass that guard. Both sources produce canonical cargo, which is then gathered, hauled/stored, and consumed through the same ownership and inventory rules players use. An extraction step that is still `RUNNING` cannot advance to yield, storage, or use.

The faction planner chains these bounded steps into a goal instead of hiding an entire campaign inside one behavior leaf. Example chains are `gather → store → haul → fulfil construction site → realize structure`, `gather → store → haul → manufacture → collect output`, and `gather fuel → store → haul → transfuse or drop for pickup → recipient loads tank`. Each leaf performs one authoritative step and returns `RUNNING`/`SUSPENDED` with a durable checkpoint until that step is complete; retrying it must be idempotent. The scaffold checks completed reservation, extraction, cargo, delivery, and release checkpoints before repeating each step, because the basic sequence primitive restarts at its first child on every wake. Those guards must read job/incarnation/source-bound durable records, never transient blackboard flags; a crash during storage cannot trigger a second extraction. A structure job places a construction site under player placement and clearance rules and may realize it only after material fulfilment. Manufacturing must recheck lane access and inputs. Hauling and refitting must retain canonical item custody. The refuel branch targets a friendly ship that needs fuel; a Creation Transfuser (type 95754) must pass its existing fitted/online, lock, range, source-fuel, and target-tank preflight. Dropping fuel items is an alternate physical delivery for authorized pickup/loading by the recipient, **not** a direct tank refill. Missing tools, permissions, targets, fuel, or materials suspend/replan the specific job; an unknown job does not bypass these guards through a generic executor.

Deliberate scouting is a durable assignment with an authorized system/site objective and an explicit intent: find resources, find targets, or perform a general survey. Each intent uses a compatible bounded sensor action and records a typed observation before staging faction-scoped intel. An NPC can also discover something unexpectedly when a warp completes; that path starts from a deduplicated warp-arrival event rather than manufacturing a scouting job or scanning every location continuously. It defers observation while unsafe and acknowledges the event only after a durable observation and faction staging checkpoint. Neither path publishes a location publicly, reveals private transponder preimages, or claims a stale observation as current. The discovery record can later feed a faction goal or site-response job after authorization and freshness checks. Transit does not hard-code a preferred method: the Phase 5 route planner chooses among currently usable typed edges (including one-way catapults), and the scaffold dispatches the selected edge back through `npcTravelService` rather than implementing another movement or fuel system. The adapter must revalidate gate/link/node power, access, warp capacitor and fuel, jump drive fitting/fatigue, and destination immediately before the journaled crossing. Failed edges suspend/replan; a signal after source dematerialization is handled by the transition journal, never by cancelling the NPC mid-transfer.

Performance and portability are constraints on every future adapter. Compile each tree once per behavior profile or adapter set, not once per NPC tick. Evaluate resource, assigned scouting, discovery, transit, task preparation, and fitting-support chains only when a durable job's `nextWakeAtMs` is due, a deduplicated warp-arrival event is queued, or a relevant source, site, route, fuel, threat, fitting, hull, service, or network-node revision wakes it; the scaffold has explicit wake guards. Cache bounded fitting-service and suitable-hull candidates by system and invalidate them on inventory, occupancy, access, or service changes rather than scanning all assets per pilot. Keep the faction site-spawn cursor and route/assembly snapshot shared at faction or system scope, with bounded invalidation rather than one full galaxy scan per pilot. Bound sensor results and route-planning work per scheduler slice, checkpoint meaningful transitions instead of each simulation tick, and reuse the existing NPC behavior tick budget and action locks. A suspended tree must yield to the scheduler without polling. All local and future chain-backed leaves use the same injected behavior primitive/context/result contract; a chain receipt simply keeps its leaf `SUSPENDED` until the durable outcome is verified, rather than adding a second behavior engine. Injected primitives keep the catalog reusable in tests or another host without importing the live persistence stack merely to inspect tree definitions.

Durable NPC jobs and consequential task steps must execute through one on-chain dApp control interface, not separate per-feature admin-signing routes. That interface must accept a faction/player-authorized command, bind it to the durable NPC pilot or unpiloted entity principal, validate current world state and capability, reserve a bounded **faction-wallet** gas budget, and journal an idempotent intent, transaction, confirmation, and receipt with replay and revocation checks. The faction wallet is both transaction sender and gas payer for NPC jobs; the server admin must not sponsor them or silently pay a shortfall. A pending or underfunded command leaves its leaf `SUSPENDED`, without applying local custody/boarding mutations. Mining yields, item custody, ship changes, construction, manufacturing, hauling, fuel transfer, scouting intel, and cross-system arrival each need an explicit chain settlement boundary before claiming completion. The server remains authoritative for movement physics and per-tick targeting; those continuous calculations are not individual chain transactions. A chain event alone cannot fabricate physical cargo, fuel, intel, travel, or a completed structure. Current deployment, profile registration, and administrative maintenance are separate from autonomous job execution; this requirement does not assert that existing contracts already expose every task command. No new contract or chain write is part of the present scaffold.

The faction planner consumes signals once per faction/command-node cursor rather than once per NPC. It converts a transition into a bounded durable job and lets normal NPC candidate selection assign the worker. Suggested urgency and lanes are:

- `FUEL_EMPTY`: `CRITICAL` with `MAINTENANCE | LOGISTICS | ENERGY`.
- `FUEL_LOW`: `HIGH` with `LOGISTICS | ENERGY`.
- `POWER_LIMIT_EXCEEDED` or `POWER_USAGE_OVER_LIMIT`: `CRITICAL` for the blocked activation, with `ENERGY` plus that job's functional lane.
- `POWER_USAGE_HIGH`: `HIGH` planning work with `ENERGY`; it does not automatically offline a consumer.
- `POWER_USAGE_MEDIUM`, `LOW`, or recovered normal fuel: observation/resume events unless they unblock an existing job.

Planner decisions use hysteresis already supplied by the published bands and add per-node job cooldowns where an external action cannot immediately change the band. A planner must never manufacture fuel quantity, available energy, or route availability from a signal alone; every action begins with an authoritative resnapshot.

Faction Sui budgets bound job transactions and gas. Tactical behavior does not sign directly; the unified dApp control interface resolves the faction signer, verifies ownership, NPC profile authorization, idempotency, gas availability, and policy before submission, and records the resulting faction-paid receipt. A depleted faction budget suspends the task and creates a funding need; it never switches to admin sponsorship.

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
12. Respawn a category-6 NPC pilot with the same persistent character and Sui profile identities while advancing its incarnation and applying the configured equipment-loss policy; separately restore a category-11 faction entity's world identity and state without creating a pilot profile.
13. Request an assembly's minimum required access, receive a bounded direct or group grant, expose only the permitted GUI/actions, and stop or replan safely when that grant is revoked or expires.
