# Networking persistence and configuration changes

[Back to the comparison report](../BRANCH_COMPARISON_whatisthisthingdoing001.md).

The network layer now moves packet inflation and marshal encoding/decoding into worker threads while retaining session state, encryption order, socket writes, and service authority in the main process. Upstream performed inbound inflation and unmarshalling directly in the TCP handler.

- [server/src/network/tcp/packetCodecPool.ts](../../server/src/network/tcp/packetCodecPool.ts) and [packetCodecTask.ts](../../server/src/network/tcp/packetCodecTask.ts) add a dedicated codec pool. Its defaults are two workers, a 10 second task timeout, and 512 pending tasks, configurable through `EVEJS_PACKET_CODEC_THREADS`, `EVEJS_PACKET_CODEC_TIMEOUT_MS`, and `EVEJS_PACKET_CODEC_MAX_PENDING`.
- [server/src/network/tcp/index.ts](../../server/src/network/tcp/index.ts) serializes decoding per connection, pauses reads at 16 queued packets or 8 MiB, resumes below eight packets and 4 MiB, and closes connections exceeding 64 queued packets or 32 MiB. Each decoded packet has a 32 MiB output limit, a nesting limit of 128, and a node limit of 250,000.
- [server/src/network/clientSession.ts](../../server/src/network/clientSession.ts) queues outbound writes in session order, sends marshal work to the codec pool, supports nested payload encoding and timing callbacks, and closes sessions that exceed 256 queued outbound packets. Packet encoding failures are propagated through the queued promise and close the socket.
- [server/src/network/tcp/utils/marshal.ts](../../server/src/network/tcp/utils/marshal.ts) adds bounds checks, node/depth accounting, cycle rejection before encoding, and shared limits across nested streams. General marshal defaults are depth 256 and 1,000,000 nodes; the codec caller applies the tighter limits above.
- [server/src/utils/serviceTaskPool.ts](../../server/src/utils/serviceTaskPool.ts) and [serviceTaskPool.worker.ts](../../server/src/utils/serviceTaskPool.worker.ts) provide reusable bounded workers for pure calculation and planning. The defaults are two workers, 256 pending tasks and a 30 second timeout. Worker errors, timeouts, exits and pool shutdown reject affected tasks. These are in-process worker threads, not a deployment of independent services.
- [server/src/utils/interactiveWorkloadGate.ts](../../server/src/utils/interactiveWorkloadGate.ts) tracks login and session bootstrap activity so background jobs can defer work. It includes a two second login grace period and a 30 second session bootstrap grace period. [server/src/utils/asyncFileQueue.ts](../../server/src/utils/asyncFileQueue.ts) adds ordered asynchronous appends per file, a default cap of 2,048 pending writes, and a flush operation.

Added tests include [server/tests/serviceTaskPool.test.ts](../../server/tests/serviceTaskPool.test.ts), [serviceIsolationPhaseTwo.test.ts](../../server/tests/serviceIsolationPhaseTwo.test.ts), and [interactiveWorkloadGate.test.ts](../../server/tests/interactiveWorkloadGate.test.ts). The existing packet dispatcher and many gateway modules also gain TypeScript annotations; those annotations alone do not establish a new protocol behavior.

## Persistence and shutdown

Upstream already had SQLite row storage, a journaled persistence worker, recovery, and durable shutdown handling. The branch extends that foundation:

- [server/src/gameStore/persistenceTypes.ts](../../server/src/gameStore/persistenceTypes.ts) defines typed operation, write, reconciliation, close, response and worker-data messages. [persistenceWorker.ts](../../server/src/gameStore/persistenceWorker.ts) adds a pending-write limit of 256, overridable through `EVEJS_PERSISTENCE_MAX_PENDING`, and rejects additional submissions with `PERSISTENCE_WORKER_QUEUE_FULL`.
- [server/src/gameStore/index.ts](../../server/src/gameStore/index.ts) registers the new runtime state for gates, NPC pilot identities, Creation presets, construction templates and deployment plans, assembly requests/access policies, remote scans/signature events, and detached dungeon props. [sqliteStore.ts](../../server/src/gameStore/sqliteStore.ts) adds per-entity row groups for gates, NPC pilots/slots/factions, Creation preset owners, and construction/deployment owners and principals. [tableOwnership.ts](../../server/src/gameStore/tableOwnership.ts) classifies the additional tables.
- [playerTransferShared.ts](../../server/src/gameStore/playerTransferShared.ts) includes character-owned Creation presets, smart assembly construction templates, and deployment plans in the player-transfer table list. This preserves those records during the existing export/import workflow; NPC and faction principals remain separately owned.
- `gameStore/index.ts` introduces priority-ordered shutdown hooks before the final flush. Hooks run on shutdown even if the database was initially clean, allowing a last checkpoint. Signal shutdown and `beforeExit` now report failure through a nonzero exit status when hooks or flushing fail.
- [server/src/_secondary/express/evejsWebGatewayRuntime.ts](../../server/src/_secondary/express/evejsWebGatewayRuntime.ts) checks browser-session disconnect persistence during gateway shutdown, attempts cleanup for all sessions, and reports accumulated teardown failures instead of silently swallowing them.

These changes add durable records for the new gameplay systems and make queue saturation and failed shutdown work observable. They do not replace the pre-existing persistence architecture.

## Configuration and repository documentation

The declared configuration grows from 224 to 280 entries: 56 are new and `asteroidBeltStartupReset` changes from `true` to `false`. The committed [evejs.config.local.json](../../evejs.config.local.json) has the same 57 changed keys. The complete [configuration appendix](configuration.md) lists old and new defaults, committed local values, environment variables and descriptions.

The new groups cover adaptive simulation ticks, idle scene unloading, scanning and signature decay, remote scan costs and limits, environmental damage and clone transitions, industry lane count, NPC identity/provisioning switches, and the smart assembly dApp URL. Adaptive ticks are disabled in the committed configuration, with a 100 ms initial interval. The code default for `smartAssemblyBaseDappUrl` is `http://localhost:5174`, while the committed local override is `https://dev.dapps.evefrontier.com`; callers must account for that distinction.

Six new root JSON files supply separate authored policies and content:

| File | Added responsibility |
| --- | --- |
| [npc-behavior.config.json](../../npc-behavior.config.json) | Behavior defaults, roles and rules. |
| [npc-factions.config.json](../../npc-factions.config.json) | Faction relations, world capabilities, wallet funding, transponders and fitting trust policy. |
| [frontier-dungeon-spawns.json](../../frontier-dungeon-spawns.json) | Dungeon site/spawner definitions, behavior presets, factions and hive populations. |
| [frontier-dungeon-loot.json](../../frontier-dungeon-loot.json) | Loot tables and type mappings. |
| [frontier-landscape-spawns.json](../../frontier-landscape-spawns.json) | Landscape behavior presets, NPC families, wreck pools, spawn tables, dungeon overrides and ecosystems. |
| [stargate-maintenance.config.json](../../stargate-maintenance.config.json) | Opt-in ordinary stargate maintenance, material requirements and fuel/reactivation policy. |

The repository moves 12 existing files from `doc/` into [docs/](../../docs/): seven are byte-identical moves and five also change content. It adds 27 other files under [docs/](../../docs/), including build-port notes, feature references, implementation plans, and the SDE type-list registry. `README.md` adds TypeScript and submodule setup, build 3502403 guidance, and world tooling instructions. The complete inventories retain every moved and added document, including plans whose existence does not imply a finished feature.
