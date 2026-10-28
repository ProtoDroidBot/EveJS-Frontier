# Complete file change inventory

This inventory records every entry from `git diff --name-status -M BASE HEAD` for the exact commits below. Documentation created for this comparison is excluded because it is not part of either commit.

- Upstream main: `7ca669fa147966c86846d54a0dc82f4826fb7927`.
- Local branch: `bce53b1baa6bc1e62d7076863dd5454425042a8f`.
- Entries: **2,551**.
- Text diff: **1,215,801 additions and 560,074 deletions**.

Status `A` means added; `M` means modified; `Rnnn` is a rename with Git's similarity percentage. Renames count once. There are no standalone deletions. A source counterpart is a same-stem `.ts`/`.mts` file matched to an upstream `.js`/`.mjs`; the label does not claim semantic equivalence. JavaScript counterparts remain tracked despite new ignore rules. Submodules are recorded as gitlinks, not expanded into thousands of vendored file rows.

The numbers are raw text churn, including generated JavaScript and TypeScript additions. They are not independent feature counts. Source paths open the final local file; old rename paths are retained in the note. [Machine-readable inventory](inventory.json) contains exact paths, modes, statistics, classifications and commit IDs.

## Root files and submodules

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [.dockerignore](../../.dockerignore) | 33 | 7 | Modified file |
| M | [.gitignore](../../.gitignore) | 35 | 0 | Modified file |
| A | [.gitmodules](../../.gitmodules) | 12 | 0 | Added file |
| M | [Dockerfile](../../Dockerfile) | 25 | 7 | Modified file |
| A | [FrontierWorld.bat](../../FrontierWorld.bat) | 4 | 0 | Added file |
| A | [FrontierWorld.ps1](../../FrontierWorld.ps1) | 1905 | 0 | Added file |
| M | [PlayFrontier.ps1](../../PlayFrontier.ps1) | 2 | 1 | Modified file |
| M | [PlayFrontier.sh](../../PlayFrontier.sh) | 1 | 0 | Modified file |
| M | [README.md](../../README.md) | 352 | 124 | Modified file |
| M | [SetupFrontierWindows.ps1](../../SetupFrontierWindows.ps1) | 33 | 7 | Modified file |
| M | [StageFrontierClient.ps1](../../StageFrontierClient.ps1) | 65 | 20 | Modified file |
| M | [StartFrontierServer.ps1](../../StartFrontierServer.ps1) | 543 | 22 | Modified file |
| M | [StartFrontierServer.sh](../../StartFrontierServer.sh) | 23 | 3 | Modified file |
| M | [StartServer.bat](../../StartServer.bat) | 7 | 4 | Modified file |
| M | [StopFrontier.ps1](../../StopFrontier.ps1) | 163 | 25 | Modified file |
| A | [builder-scaffold](../../builder-scaffold) | 1 | 0 | Submodule pin; `f5142a7c83a502005059ab9f578103ddbaba3b39` |
| M | [compose.yaml](../../compose.yaml) | 2 | 1 | Modified file |
| A | [efctl.yaml](../../efctl.yaml) | 15 | 0 | Added file |
| M | [evejs.config.local.json](../../evejs.config.local.json) | 361 | 4 | Modified file |
| A | [frontier-dungeon-loot.json](../../frontier-dungeon-loot.json) | 669 | 0 | Added file |
| A | [frontier-dungeon-spawns.json](../../frontier-dungeon-spawns.json) | 537 | 0 | Added file |
| A | [frontier-landscape-spawns.json](../../frontier-landscape-spawns.json) | 283 | 0 | Added file |
| A | [npc-behavior.config.json](../../npc-behavior.config.json) | 167 | 0 | Added file |
| A | [npc-factions.config.json](../../npc-factions.config.json) | 729 | 0 | Added file |
| M | [package-lock.json](../../package-lock.json) | 295 | 4 | Modified file |
| M | [package.json](../../package.json) | 40 | 3 | Modified file |
| A | [smart-assembly-control](../../smart-assembly-control) | 1 | 0 | Submodule pin; `03d94d47e658efcb35a8739d5432282d76e3e80d` |
| A | [stargate-maintenance.config.json](../../stargate-maintenance.config.json) | 4 | 0 | Added file |
| A | [tsconfig.browser.json](../../tsconfig.browser.json) | 19 | 0 | Added file |
| A | [tsconfig.json](../../tsconfig.json) | 27 | 0 | Added file |
| A | [tsconfig.tests.json](../../tsconfig.tests.json) | 13 | 0 | Added file |
| A | [tsconfig.tools.json](../../tsconfig.tools.json) | 20 | 0 | Added file |
| A | [world-contracts](../../world-contracts) | 1 | 0 | Submodule pin; `9889b0487e5d23d16ff27e2480fc13c8e5a48162` |

## docker/entrypoint.sh

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [docker/entrypoint.sh](../../docker/entrypoint.sh) | 3 | 0 | Modified file |

## docker/market-database-tool.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [docker/market-database-tool.js](../../docker/market-database-tool.js) | 242 | 294 | JavaScript with TypeScript counterpart |

## docker/market-database-tool.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [docker/market-database-tool.ts](../../docker/market-database-tool.ts) | 350 | 0 | TypeScript counterpart |

## docs

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [docs/COLLISION_DAMAGE_PLAN.md](../../docs/COLLISION_DAMAGE_PLAN.md) | 139 | 0 | Added file |
| A | [docs/CREATION_SPECIALIZED_MODULES.md](../../docs/CREATION_SPECIALIZED_MODULES.md) | 139 | 0 | Added file |
| R100 | [docs/CommandGuide.txt](../../docs/CommandGuide.txt) | 0 | 0 | Documentation move; from `doc/CommandGuide.txt`; Content identical |
| A | [docs/DUNGEON_PROP_COLLISION_HEALTH_AND_MASS_PLAN.md](../../docs/DUNGEON_PROP_COLLISION_HEALTH_AND_MASS_PLAN.md) | 147 | 0 | Added file |
| A | [docs/DUNGEON_PROP_MOVEMENT.md](../../docs/DUNGEON_PROP_MOVEMENT.md) | 130 | 0 | Added file |
| A | [docs/DUNGEON_PROP_PHYSICS_TURRET.md](../../docs/DUNGEON_PROP_PHYSICS_TURRET.md) | 125 | 0 | Added file |
| A | [docs/FRONTIER_ASSEMBLY_ACCESS.md](../../docs/FRONTIER_ASSEMBLY_ACCESS.md) | 50 | 0 | Added file |
| A | [docs/FRONTIER_ASSEMBLY_SYNC.md](../../docs/FRONTIER_ASSEMBLY_SYNC.md) | 126 | 0 | Added file |
| A | [docs/FRONTIER_BUILD_3488090.md](../../docs/FRONTIER_BUILD_3488090.md) | 179 | 0 | Added file |
| A | [docs/FRONTIER_BUILD_3502403.md](../../docs/FRONTIER_BUILD_3502403.md) | 143 | 0 | Added file |
| A | [docs/FRONTIER_CREATION_PRESETS.md](../../docs/FRONTIER_CREATION_PRESETS.md) | 209 | 0 | Added file |
| A | [docs/FRONTIER_INDUSTRY_INVENTORY.md](../../docs/FRONTIER_INDUSTRY_INVENTORY.md) | 66 | 0 | Added file |
| R100 | [docs/FRONTIER_MILESTONE_1.md](../../docs/FRONTIER_MILESTONE_1.md) | 0 | 0 | Documentation move; from `doc/FRONTIER_MILESTONE_1.md`; Content identical |
| R100 | [docs/FRONTIER_MILESTONE_2.md](../../docs/FRONTIER_MILESTONE_2.md) | 0 | 0 | Documentation move; from `doc/FRONTIER_MILESTONE_2.md`; Content identical |
| R100 | [docs/FRONTIER_MILESTONE_3.md](../../docs/FRONTIER_MILESTONE_3.md) | 0 | 0 | Documentation move; from `doc/FRONTIER_MILESTONE_3.md`; Content identical |
| A | [docs/FRONTIER_SMART_ASSEMBLY_CONSTRUCTION_TEMPLATES.md](../../docs/FRONTIER_SMART_ASSEMBLY_CONSTRUCTION_TEMPLATES.md) | 518 | 0 | Added file |
| A | [docs/FRONTIER_SMART_ASSEMBLY_REQUESTS.md](../../docs/FRONTIER_SMART_ASSEMBLY_REQUESTS.md) | 133 | 0 | Added file |
| A | [docs/FRONTIER_SMART_GATES.md](../../docs/FRONTIER_SMART_GATES.md) | 52 | 0 | Added file |
| A | [docs/FRONTIER_SMART_INDUSTRY_JOB_LANES.md](../../docs/FRONTIER_SMART_INDUSTRY_JOB_LANES.md) | 104 | 0 | Added file |
| R092 | [docs/FRONTIER_WINDOWS_SETUP.md](../../docs/FRONTIER_WINDOWS_SETUP.md) | 19 | 4 | Documentation move; from `doc/FRONTIER_WINDOWS_SETUP.md`; Moved and edited |
| A | [docs/FRONTIER_WORLD_SYNC.md](../../docs/FRONTIER_WORLD_SYNC.md) | 205 | 0 | Added file |
| R081 | [docs/LAUNCHERS.md](../../docs/LAUNCHERS.md) | 15 | 14 | Documentation move; from `doc/LAUNCHERS.md`; Moved and edited |
| R100 | [docs/MARKET_SEEDER.md](../../docs/MARKET_SEEDER.md) | 0 | 0 | Documentation move; from `doc/MARKET_SEEDER.md`; Content identical |
| R100 | [docs/MARKET_SETUP.md](../../docs/MARKET_SETUP.md) | 0 | 0 | Documentation move; from `doc/MARKET_SETUP.md`; Content identical |
| R100 | [docs/NON_DOCKER_SETUP_AUDIT.md](../../docs/NON_DOCKER_SETUP_AUDIT.md) | 0 | 0 | Documentation move; from `doc/NON_DOCKER_SETUP_AUDIT.md`; Content identical |
| A | [docs/NPC_BEHAVIOR_PHASES.md](../../docs/NPC_BEHAVIOR_PHASES.md) | 891 | 0 | Added file |
| A | [docs/NPC_DOGMA_WORKBENCH_PLAN.md](../../docs/NPC_DOGMA_WORKBENCH_PLAN.md) | 575 | 0 | Added file |
| A | [docs/NPC_SUI_IDENTITIES.md](../../docs/NPC_SUI_IDENTITIES.md) | 182 | 0 | Added file |
| A | [docs/PHYSICS_GUN.md](../../docs/PHYSICS_GUN.md) | 15 | 0 | Added file |
| A | [docs/PHYSICS_GUN_PLAN.md](../../docs/PHYSICS_GUN_PLAN.md) | 82 | 0 | Added file |
| A | [docs/REMOTE_SOLAR_SYSTEM_SCANNING_PLAN.md](../../docs/REMOTE_SOLAR_SYSTEM_SCANNING_PLAN.md) | 880 | 0 | Added file |
| A | [docs/SDE_TYPELIST_CATALOG_3502403.md](../../docs/SDE_TYPELIST_CATALOG_3502403.md) | 428 | 0 | Added file |
| A | [docs/SDE_TYPELIST_INTEGRATION_PLAN.md](../../docs/SDE_TYPELIST_INTEGRATION_PLAN.md) | 63 | 0 | Added file |
| A | [docs/SDE_TYPELIST_REGISTRY_3502403.json](../../docs/SDE_TYPELIST_REGISTRY_3502403.json) | 2115 | 0 | Added file |
| R086 | [docs/SETUP.md](../../docs/SETUP.md) | 8 | 2 | Documentation move; from `doc/SETUP.md`; Moved and edited |
| A | [docs/SUI_TRANSPONDER_COMMITMENTS.md](../../docs/SUI_TRANSPONDER_COMMITMENTS.md) | 62 | 0 | Added file |
| R085 | [docs/TOOLS.md](../../docs/TOOLS.md) | 14 | 5 | Documentation move; from `doc/TOOLS.md`; Moved and edited |
| R095 | [docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md) | 5 | 0 | Documentation move; from `doc/TROUBLESHOOTING.md`; Moved and edited |
| A | [docs/frontier-network-node-energy.md](../../docs/frontier-network-node-energy.md) | 72 | 0 | Added file |

## scripts/FrontierWorld

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [scripts/FrontierWorld/fund-npc-factions.ts](../../scripts/FrontierWorld/fund-npc-factions.ts) | 102 | 0 | New TypeScript path; Source or declaration |

## scripts/Tests

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [scripts/Tests/frontier-test-files.js](../../scripts/Tests/frontier-test-files.js) | 16 | 26 | JavaScript with TypeScript counterpart |
| M | [scripts/Tests/frontier-test-files.test.js](../../scripts/Tests/frontier-test-files.test.js) | 45 | 75 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/frontier-test-files.test.ts](../../scripts/Tests/frontier-test-files.test.ts) | 94 | 0 | TypeScript counterpart |
| A | [scripts/Tests/frontier-test-files.ts](../../scripts/Tests/frontier-test-files.ts) | 37 | 0 | TypeScript counterpart |
| M | [scripts/Tests/frontier-windows-client.test.js](../../scripts/Tests/frontier-windows-client.test.js) | 489 | 583 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/frontier-windows-client.test.ts](../../scripts/Tests/frontier-windows-client.test.ts) | 705 | 0 | TypeScript counterpart |
| M | [scripts/Tests/frontier-windows-runtime.test.js](../../scripts/Tests/frontier-windows-runtime.test.js) | 351 | 257 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/frontier-windows-runtime.test.ts](../../scripts/Tests/frontier-windows-runtime.test.ts) | 839 | 0 | TypeScript counterpart |
| A | [scripts/Tests/frontier-world-sync.test.ts](../../scripts/Tests/frontier-world-sync.test.ts) | 996 | 0 | New TypeScript path; Test |
| M | [scripts/Tests/run-frontier-server-tests.js](../../scripts/Tests/run-frontier-server-tests.js) | 78 | 106 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/run-frontier-server-tests.ts](../../scripts/Tests/run-frontier-server-tests.ts) | 126 | 0 | TypeScript counterpart |
| M | [scripts/Tests/run-frontier-static-tests.js](../../scripts/Tests/run-frontier-static-tests.js) | 23 | 27 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/run-frontier-static-tests.ts](../../scripts/Tests/run-frontier-static-tests.ts) | 38 | 0 | TypeScript counterpart |
| M | [scripts/Tests/run-isolated-tests.js](../../scripts/Tests/run-isolated-tests.js) | 43 | 64 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/run-isolated-tests.ts](../../scripts/Tests/run-isolated-tests.ts) | 92 | 0 | TypeScript counterpart |
| A | [scripts/Tests/run-npc-identity-tests.ts](../../scripts/Tests/run-npc-identity-tests.ts) | 33 | 0 | New TypeScript path; Source or declaration |
| M | [scripts/Tests/seed-frontier-test-fixture.js](../../scripts/Tests/seed-frontier-test-fixture.js) | 41 | 97 | JavaScript with TypeScript counterpart |
| A | [scripts/Tests/seed-frontier-test-fixture.ts](../../scripts/Tests/seed-frontier-test-fixture.ts) | 115 | 0 | TypeScript counterpart |
| A | [scripts/Tests/verify-npc-deployment.test.ts](../../scripts/Tests/verify-npc-deployment.test.ts) | 86 | 0 | New TypeScript path; Test |
| A | [scripts/Tests/verify-npc-deployment.ts](../../scripts/Tests/verify-npc-deployment.ts) | 229 | 0 | New TypeScript path; Source or declaration |

## server/index.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/index.js](../../server/index.js) | 247 | 264 | JavaScript with TypeScript counterpart |

## server/index.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/index.ts](../../server/index.ts) | 301 | 0 | TypeScript counterpart |

## server/package-lock.json

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/package-lock.json](../../server/package-lock.json) | 274 | 0 | Modified file |

## server/package.json

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/package.json](../../server/package.json) | 8 | 1 | Modified file |

## server/proxy-only.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/proxy-only.js](../../server/proxy-only.js) | 7 | 15 | JavaScript with TypeScript counterpart |

## server/proxy-only.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/proxy-only.ts](../../server/proxy-only.ts) | 28 | 0 | TypeScript counterpart |

## server/src/RemoteRepShow

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/RemoteRepShow/remoteRepairFleetCommands.js](../../server/src/RemoteRepShow/remoteRepairFleetCommands.js) | 1640 | 2058 | JavaScript with TypeScript counterpart |
| A | [server/src/RemoteRepShow/remoteRepairFleetCommands.ts](../../server/src/RemoteRepShow/remoteRepairFleetCommands.ts) | 2066 | 0 | TypeScript counterpart |
| M | [server/src/RemoteRepShow/remoteRepairShowRuntime.js](../../server/src/RemoteRepShow/remoteRepairShowRuntime.js) | 569 | 817 | JavaScript with TypeScript counterpart |
| A | [server/src/RemoteRepShow/remoteRepairShowRuntime.ts](../../server/src/RemoteRepShow/remoteRepairShowRuntime.ts) | 895 | 0 | TypeScript counterpart |

## server/src/_secondary/chat

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/_secondary/chat/chatRuntime.js](../../server/src/_secondary/chat/chatRuntime.js) | 1717 | 1982 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/chat/chatRuntime.ts](../../server/src/_secondary/chat/chatRuntime.ts) | 1982 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/chat/chatStore.js](../../server/src/_secondary/chat/chatStore.js) | 730 | 858 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/chat/chatStore.ts](../../server/src/_secondary/chat/chatStore.ts) | 858 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/chat/server.js](../../server/src/_secondary/chat/server.js) | 9 | 9 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/chat/server.ts](../../server/src/_secondary/chat/server.ts) | 15 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/chat/staticChannelContracts.js](../../server/src/_secondary/chat/staticChannelContracts.js) | 235 | 267 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/chat/staticChannelContracts.ts](../../server/src/_secondary/chat/staticChannelContracts.ts) | 308 | 0 | TypeScript counterpart |

## server/src/_secondary/express

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/_secondary/express/evejsWebGateway.js](../../server/src/_secondary/express/evejsWebGateway.js) | 1450 | 1715 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/evejsWebGateway.ts](../../server/src/_secondary/express/evejsWebGateway.ts) | 1731 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/evejsWebGatewayRuntime.js](../../server/src/_secondary/express/evejsWebGatewayRuntime.js) | 6264 | 6728 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/evejsWebGatewayRuntime.ts](../../server/src/_secondary/express/evejsWebGatewayRuntime.ts) | 6741 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/assemblyGateGatewayService.js](../../server/src/_secondary/express/gatewayServices/assemblyGateGatewayService.js) | 158 | 191 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/assemblyGateGatewayService.ts](../../server/src/_secondary/express/gatewayServices/assemblyGateGatewayService.ts) | 215 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/assemblyGateProto.js](../../server/src/_secondary/express/gatewayServices/assemblyGateProto.js) | 61 | 176 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/assemblyGateProto.ts](../../server/src/_secondary/express/gatewayServices/assemblyGateProto.ts) | 191 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/assemblyNetworkNodeGatewayService.js](../../server/src/_secondary/express/gatewayServices/assemblyNetworkNodeGatewayService.js) | 285 | 355 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/assemblyNetworkNodeGatewayService.ts](../../server/src/_secondary/express/gatewayServices/assemblyNetworkNodeGatewayService.ts) | 454 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/assemblyNetworkNodeProto.js](../../server/src/_secondary/express/gatewayServices/assemblyNetworkNodeProto.js) | 77 | 235 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/assemblyNetworkNodeProto.ts](../../server/src/_secondary/express/gatewayServices/assemblyNetworkNodeProto.ts) | 276 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/assemblyStorageUnitGatewayService.js](../../server/src/_secondary/express/gatewayServices/assemblyStorageUnitGatewayService.js) | 296 | 402 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/assemblyStorageUnitGatewayService.ts](../../server/src/_secondary/express/gatewayServices/assemblyStorageUnitGatewayService.ts) | 475 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/assemblyStorageUnitProto.js](../../server/src/_secondary/express/gatewayServices/assemblyStorageUnitProto.js) | 91 | 293 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/assemblyStorageUnitProto.ts](../../server/src/_secondary/express/gatewayServices/assemblyStorageUnitProto.ts) | 319 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/campaignGatewayService.js](../../server/src/_secondary/express/gatewayServices/campaignGatewayService.js) | 49 | 75 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/campaignGatewayService.ts](../../server/src/_secondary/express/gatewayServices/campaignGatewayService.ts) | 83 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/compatibilityGatewayService.js](../../server/src/_secondary/express/gatewayServices/compatibilityGatewayService.js) | 164 | 179 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/compatibilityGatewayService.ts](../../server/src/_secondary/express/gatewayServices/compatibilityGatewayService.ts) | 179 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/corpColorsGatewayService.js](../../server/src/_secondary/express/gatewayServices/corpColorsGatewayService.js) | 163 | 199 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/corpColorsGatewayService.ts](../../server/src/_secondary/express/gatewayServices/corpColorsGatewayService.ts) | 218 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/corpGoalsGatewayService.js](../../server/src/_secondary/express/gatewayServices/corpGoalsGatewayService.js) | 323 | 482 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/corpGoalsGatewayService.ts](../../server/src/_secondary/express/gatewayServices/corpGoalsGatewayService.ts) | 509 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/corpGoalsProto.js](../../server/src/_secondary/express/gatewayServices/corpGoalsProto.js) | 133 | 371 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/corpGoalsProto.ts](../../server/src/_secondary/express/gatewayServices/corpGoalsProto.ts) | 438 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/corpSkillPlanGatewayService.js](../../server/src/_secondary/express/gatewayServices/corpSkillPlanGatewayService.js) | 407 | 562 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/corpSkillPlanGatewayService.ts](../../server/src/_secondary/express/gatewayServices/corpSkillPlanGatewayService.ts) | 562 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/corpSkillPlanProto.js](../../server/src/_secondary/express/gatewayServices/corpSkillPlanProto.js) | 393 | 392 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/corpSkillPlanProto.ts](../../server/src/_secondary/express/gatewayServices/corpSkillPlanProto.ts) | 392 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/dailyGoalsGatewayService.js](../../server/src/_secondary/express/gatewayServices/dailyGoalsGatewayService.js) | 336 | 410 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/dailyGoalsGatewayService.ts](../../server/src/_secondary/express/gatewayServices/dailyGoalsGatewayService.ts) | 410 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/evermarksGatewayService.js](../../server/src/_secondary/express/gatewayServices/evermarksGatewayService.js) | 135 | 275 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/evermarksGatewayService.ts](../../server/src/_secondary/express/gatewayServices/evermarksGatewayService.ts) | 306 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/freelanceGatewayService.js](../../server/src/_secondary/express/gatewayServices/freelanceGatewayService.js) | 192 | 292 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/freelanceGatewayService.ts](../../server/src/_secondary/express/gatewayServices/freelanceGatewayService.ts) | 316 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/frontierCoreProto.js](../../server/src/_secondary/express/gatewayServices/frontierCoreProto.js) | 64 | 204 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/frontierCoreProto.ts](../../server/src/_secondary/express/gatewayServices/frontierCoreProto.ts) | 214 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/frontierTokenExchangeGatewayService.js](../../server/src/_secondary/express/gatewayServices/frontierTokenExchangeGatewayService.js) | 50 | 68 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/frontierTokenExchangeGatewayService.ts](../../server/src/_secondary/express/gatewayServices/frontierTokenExchangeGatewayService.ts) | 74 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/frontierWalletGatewayService.js](../../server/src/_secondary/express/gatewayServices/frontierWalletGatewayService.js) | 66 | 88 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/frontierWalletGatewayService.ts](../../server/src/_secondary/express/gatewayServices/frontierWalletGatewayService.ts) | 99 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.js](../../server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.js) | 107 | 138 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.ts](../../server/src/_secondary/express/gatewayServices/fwAdvantageGatewayService.ts) | 138 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/gatewayServiceHelpers.js](../../server/src/_secondary/express/gatewayServices/gatewayServiceHelpers.js) | 178 | 204 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/gatewayServiceHelpers.ts](../../server/src/_secondary/express/gatewayServices/gatewayServiceHelpers.ts) | 232 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/index.js](../../server/src/_secondary/express/gatewayServices/index.js) | 82 | 121 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/index.ts](../../server/src/_secondary/express/gatewayServices/index.ts) | 121 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/insurgencyGatewayService.js](../../server/src/_secondary/express/gatewayServices/insurgencyGatewayService.js) | 103 | 154 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/insurgencyGatewayService.ts](../../server/src/_secondary/express/gatewayServices/insurgencyGatewayService.ts) | 183 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/localChatGatewayService.js](../../server/src/_secondary/express/gatewayServices/localChatGatewayService.js) | 451 | 651 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/localChatGatewayService.ts](../../server/src/_secondary/express/gatewayServices/localChatGatewayService.ts) | 714 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/mapTagsGatewayService.js](../../server/src/_secondary/express/gatewayServices/mapTagsGatewayService.js) | 192 | 218 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/mapTagsGatewayService.ts](../../server/src/_secondary/express/gatewayServices/mapTagsGatewayService.ts) | 219 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/mercenaryDenGatewayService.js](../../server/src/_secondary/express/gatewayServices/mercenaryDenGatewayService.js) | 249 | 359 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/mercenaryDenGatewayService.ts](../../server/src/_secondary/express/gatewayServices/mercenaryDenGatewayService.ts) | 385 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/newEdenStoreGatewayService.js](../../server/src/_secondary/express/gatewayServices/newEdenStoreGatewayService.js) | 303 | 445 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/newEdenStoreGatewayService.ts](../../server/src/_secondary/express/gatewayServices/newEdenStoreGatewayService.ts) | 480 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/plexVaultGatewayService.js](../../server/src/_secondary/express/gatewayServices/plexVaultGatewayService.js) | 150 | 264 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/plexVaultGatewayService.ts](../../server/src/_secondary/express/gatewayServices/plexVaultGatewayService.ts) | 292 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/shipLogoGatewayService.js](../../server/src/_secondary/express/gatewayServices/shipLogoGatewayService.js) | 156 | 247 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/shipLogoGatewayService.ts](../../server/src/_secondary/express/gatewayServices/shipLogoGatewayService.ts) | 278 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/skillPlanGatewayService.js](../../server/src/_secondary/express/gatewayServices/skillPlanGatewayService.js) | 318 | 417 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/skillPlanGatewayService.ts](../../server/src/_secondary/express/gatewayServices/skillPlanGatewayService.ts) | 447 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/skillPlanProto.js](../../server/src/_secondary/express/gatewayServices/skillPlanProto.js) | 288 | 288 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/skillPlanProto.ts](../../server/src/_secondary/express/gatewayServices/skillPlanProto.ts) | 308 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/sovereigntyGatewayService.js](../../server/src/_secondary/express/gatewayServices/sovereigntyGatewayService.js) | 740 | 998 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/sovereigntyGatewayService.ts](../../server/src/_secondary/express/gatewayServices/sovereigntyGatewayService.ts) | 1061 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/structurePaintworkGatewayService.js](../../server/src/_secondary/express/gatewayServices/structurePaintworkGatewayService.js) | 407 | 979 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/structurePaintworkGatewayService.ts](../../server/src/_secondary/express/gatewayServices/structurePaintworkGatewayService.ts) | 1029 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/gatewayServices/webChatGatewayService.js](../../server/src/_secondary/express/gatewayServices/webChatGatewayService.js) | 194 | 233 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/gatewayServices/webChatGatewayService.ts](../../server/src/_secondary/express/gatewayServices/webChatGatewayService.ts) | 335 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/localTlsCertificate.js](../../server/src/_secondary/express/localTlsCertificate.js) | 259 | 338 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/localTlsCertificate.ts](../../server/src/_secondary/express/localTlsCertificate.ts) | 390 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/playerConnectEndpoints.js](../../server/src/_secondary/express/playerConnectEndpoints.js) | 149 | 171 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/playerConnectEndpoints.ts](../../server/src/_secondary/express/playerConnectEndpoints.ts) | 221 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/publicGatewayLocal.js](../../server/src/_secondary/express/publicGatewayLocal.js) | 1982 | 2369 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/publicGatewayLocal.ts](../../server/src/_secondary/express/publicGatewayLocal.ts) | 2398 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/server.js](../../server/src/_secondary/express/server.js) | 962 | 1216 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/server.ts](../../server/src/_secondary/express/server.ts) | 1244 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/express/sessionEventStream.js](../../server/src/_secondary/express/sessionEventStream.js) | 292 | 323 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/express/sessionEventStream.ts](../../server/src/_secondary/express/sessionEventStream.ts) | 323 | 0 | TypeScript counterpart |
| A | [server/src/_secondary/express/smartAssemblyAdminEndpoints.ts](../../server/src/_secondary/express/smartAssemblyAdminEndpoints.ts) | 183 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartAssemblyEnergyEndpoints.ts](../../server/src/_secondary/express/smartAssemblyEnergyEndpoints.ts) | 255 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartFactionTaskEndpoints.ts](../../server/src/_secondary/express/smartFactionTaskEndpoints.ts) | 186 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartGateEndpoints.ts](../../server/src/_secondary/express/smartGateEndpoints.ts) | 212 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartIndustryBlueprintApi.ts](../../server/src/_secondary/express/smartIndustryBlueprintApi.ts) | 157 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartIndustryEndpoints.ts](../../server/src/_secondary/express/smartIndustryEndpoints.ts) | 236 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartIndustryStorageApi.ts](../../server/src/_secondary/express/smartIndustryStorageApi.ts) | 204 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/_secondary/express/smartStorageEndpoints.ts](../../server/src/_secondary/express/smartStorageEndpoints.ts) | 401 | 0 | New TypeScript path; Source or declaration |

## server/src/_secondary/fitting

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/_secondary/fitting/assumedActiveFittingEffects.js](../../server/src/_secondary/fitting/assumedActiveFittingEffects.js) | 200 | 314 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/fitting/assumedActiveFittingEffects.ts](../../server/src/_secondary/fitting/assumedActiveFittingEffects.ts) | 314 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/fitting/fittingBrainBuilder.js](../../server/src/_secondary/fitting/fittingBrainBuilder.js) | 214 | 299 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/fitting/fittingBrainBuilder.ts](../../server/src/_secondary/fitting/fittingBrainBuilder.ts) | 342 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/fitting/fittingRuntime.js](../../server/src/_secondary/fitting/fittingRuntime.js) | 132 | 175 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/fitting/fittingRuntime.ts](../../server/src/_secondary/fitting/fittingRuntime.ts) | 209 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/fitting/fittingSnapshotBuilder.js](../../server/src/_secondary/fitting/fittingSnapshotBuilder.js) | 284 | 419 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/fitting/fittingSnapshotBuilder.ts](../../server/src/_secondary/fitting/fittingSnapshotBuilder.ts) | 419 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/fitting/fittingStore.js](../../server/src/_secondary/fitting/fittingStore.js) | 949 | 1111 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/fitting/fittingStore.ts](../../server/src/_secondary/fitting/fittingStore.ts) | 1131 | 0 | TypeScript counterpart |

## server/src/_secondary/image

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/_secondary/image/imageRequestResolver.js](../../server/src/_secondary/image/imageRequestResolver.js) | 239 | 213 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/image/imageRequestResolver.ts](../../server/src/_secondary/image/imageRequestResolver.ts) | 301 | 0 | TypeScript counterpart |
| M | [server/src/_secondary/image/server.js](../../server/src/_secondary/image/server.js) | 55 | 46 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/image/server.ts](../../server/src/_secondary/image/server.ts) | 68 | 0 | TypeScript counterpart |

## server/src/_secondary/launcher

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/_secondary/launcher/server.js](../../server/src/_secondary/launcher/server.js) | 80 | 93 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/launcher/server.ts](../../server/src/_secondary/launcher/server.ts) | 118 | 0 | TypeScript counterpart |

## server/src/_secondary/redshift

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/_secondary/redshift/server.js](../../server/src/_secondary/redshift/server.js) | 312 | 335 | JavaScript with TypeScript counterpart |
| A | [server/src/_secondary/redshift/server.ts](../../server/src/_secondary/redshift/server.ts) | 388 | 0 | TypeScript counterpart |

## server/src/common

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/common/geo2.js](../../server/src/common/geo2.js) | 265 | 321 | JavaScript with TypeScript counterpart |
| A | [server/src/common/geo2.ts](../../server/src/common/geo2.ts) | 396 | 0 | TypeScript counterpart |
| M | [server/src/common/machoAddress.js](../../server/src/common/machoAddress.js) | 128 | 143 | JavaScript with TypeScript counterpart |
| A | [server/src/common/machoAddress.ts](../../server/src/common/machoAddress.ts) | 181 | 0 | TypeScript counterpart |
| M | [server/src/common/machoErrors.js](../../server/src/common/machoErrors.js) | 113 | 149 | JavaScript with TypeScript counterpart |
| A | [server/src/common/machoErrors.ts](../../server/src/common/machoErrors.ts) | 152 | 0 | TypeScript counterpart |
| M | [server/src/common/marshalStringTable.js](../../server/src/common/marshalStringTable.js) | 212 | 215 | JavaScript with TypeScript counterpart |
| A | [server/src/common/marshalStringTable.ts](../../server/src/common/marshalStringTable.ts) | 247 | 0 | TypeScript counterpart |
| M | [server/src/common/packetTypes.js](../../server/src/common/packetTypes.js) | 48 | 53 | JavaScript with TypeScript counterpart |
| A | [server/src/common/packetTypes.ts](../../server/src/common/packetTypes.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/common/pyPacket.js](../../server/src/common/pyPacket.js) | 167 | 202 | JavaScript with TypeScript counterpart |
| A | [server/src/common/pyPacket.ts](../../server/src/common/pyPacket.ts) | 249 | 0 | TypeScript counterpart |
| M | [server/src/common/pyTypes.js](../../server/src/common/pyTypes.js) | 470 | 518 | JavaScript with TypeScript counterpart |
| A | [server/src/common/pyTypes.ts](../../server/src/common/pyTypes.ts) | 610 | 0 | TypeScript counterpart |

## server/src/config

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/config/frontierDungeonLoot.ts](../../server/src/config/frontierDungeonLoot.ts) | 289 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/config/frontierDungeonSpawns.ts](../../server/src/config/frontierDungeonSpawns.ts) | 1818 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/config/frontierLandscapeSpawns.ts](../../server/src/config/frontierLandscapeSpawns.ts) | 921 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/config/index.js](../../server/src/config/index.js) | 3206 | 2895 | JavaScript with TypeScript counterpart |
| A | [server/src/config/index.ts](../../server/src/config/index.ts) | 3596 | 0 | TypeScript counterpart |
| A | [server/src/config/npcBehaviorConfig.ts](../../server/src/config/npcBehaviorConfig.ts) | 421 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/config/npcFactionConfig.ts](../../server/src/config/npcFactionConfig.ts) | 1364 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/config/productionMissionPolicy.js](../../server/src/config/productionMissionPolicy.js) | 281 | 338 | JavaScript with TypeScript counterpart |
| A | [server/src/config/productionMissionPolicy.ts](../../server/src/config/productionMissionPolicy.ts) | 338 | 0 | TypeScript counterpart |

## server/src/gameStore

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/gameStore/exportPlayers.js](../../server/src/gameStore/exportPlayers.js) | 301 | 351 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/exportPlayers.ts](../../server/src/gameStore/exportPlayers.ts) | 351 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/importPlayers.js](../../server/src/gameStore/importPlayers.js) | 375 | 401 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/importPlayers.ts](../../server/src/gameStore/importPlayers.ts) | 401 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/index.js](../../server/src/gameStore/index.js) | 1276 | 1404 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/index.ts](../../server/src/gameStore/index.ts) | 1447 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/migrateJsonToSqlite.js](../../server/src/gameStore/migrateJsonToSqlite.js) | 102 | 119 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/migrateJsonToSqlite.ts](../../server/src/gameStore/migrateJsonToSqlite.ts) | 119 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/migrateLegacyNewDatabase.js](../../server/src/gameStore/migrateLegacyNewDatabase.js) | 70 | 79 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/migrateLegacyNewDatabase.ts](../../server/src/gameStore/migrateLegacyNewDatabase.ts) | 79 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/migrateRuntimeImages.js](../../server/src/gameStore/migrateRuntimeImages.js) | 83 | 106 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/migrateRuntimeImages.ts](../../server/src/gameStore/migrateRuntimeImages.ts) | 148 | 0 | TypeScript counterpart |
| A | [server/src/gameStore/persistenceTypes.ts](../../server/src/gameStore/persistenceTypes.ts) | 32 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/gameStore/persistenceWorker.js](../../server/src/gameStore/persistenceWorker.js) | 1238 | 1500 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/persistenceWorker.ts](../../server/src/gameStore/persistenceWorker.ts) | 1540 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/persistenceWorker.worker.js](../../server/src/gameStore/persistenceWorker.worker.js) | 139 | 162 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/persistenceWorker.worker.ts](../../server/src/gameStore/persistenceWorker.worker.ts) | 200 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/playerTransferShared.js](../../server/src/gameStore/playerTransferShared.js) | 100 | 109 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/playerTransferShared.ts](../../server/src/gameStore/playerTransferShared.ts) | 112 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/sqliteStore.js](../../server/src/gameStore/sqliteStore.js) | 611 | 736 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/sqliteStore.ts](../../server/src/gameStore/sqliteStore.ts) | 789 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/storeRoot.js](../../server/src/gameStore/storeRoot.js) | 29 | 35 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/storeRoot.ts](../../server/src/gameStore/storeRoot.ts) | 75 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/tableOwnership.js](../../server/src/gameStore/tableOwnership.js) | 326 | 313 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/tableOwnership.ts](../../server/src/gameStore/tableOwnership.ts) | 352 | 0 | TypeScript counterpart |
| M | [server/src/gameStore/tableRepository.js](../../server/src/gameStore/tableRepository.js) | 151 | 157 | JavaScript with TypeScript counterpart |
| A | [server/src/gameStore/tableRepository.ts](../../server/src/gameStore/tableRepository.ts) | 162 | 0 | TypeScript counterpart |

## server/src/network

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/network/callResponseControl.js](../../server/src/network/callResponseControl.js) | 18 | 18 | JavaScript with TypeScript counterpart |
| A | [server/src/network/callResponseControl.ts](../../server/src/network/callResponseControl.ts) | 18 | 0 | TypeScript counterpart |
| M | [server/src/network/clientSession.js](../../server/src/network/clientSession.js) | 991 | 1072 | JavaScript with TypeScript counterpart |
| A | [server/src/network/clientSession.ts](../../server/src/network/clientSession.ts) | 1209 | 0 | TypeScript counterpart |
| M | [server/src/network/nativeTimeDilation.js](../../server/src/network/nativeTimeDilation.js) | 203 | 258 | JavaScript with TypeScript counterpart |
| A | [server/src/network/nativeTimeDilation.ts](../../server/src/network/nativeTimeDilation.ts) | 313 | 0 | TypeScript counterpart |
| M | [server/src/network/packetDispatcher.js](../../server/src/network/packetDispatcher.js) | 842 | 1053 | JavaScript with TypeScript counterpart |
| A | [server/src/network/packetDispatcher.ts](../../server/src/network/packetDispatcher.ts) | 1062 | 0 | TypeScript counterpart |
| M | [server/src/network/spatialTrace.js](../../server/src/network/spatialTrace.js) | 1213 | 1322 | JavaScript with TypeScript counterpart |
| A | [server/src/network/spatialTrace.ts](../../server/src/network/spatialTrace.ts) | 1452 | 0 | TypeScript counterpart |
| M | [server/src/network/syncLedger.js](../../server/src/network/syncLedger.js) | 334 | 375 | JavaScript with TypeScript counterpart |
| A | [server/src/network/syncLedger.ts](../../server/src/network/syncLedger.ts) | 375 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/handshake.js](../../server/src/network/tcp/handshake.js) | 791 | 997 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/handshake.ts](../../server/src/network/tcp/handshake.ts) | 1015 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/handshakeCompatibility.js](../../server/src/network/tcp/handshakeCompatibility.js) | 40 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/handshakeCompatibility.ts](../../server/src/network/tcp/handshakeCompatibility.ts) | 65 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/index.js](../../server/src/network/tcp/index.js) | 486 | 503 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/index.ts](../../server/src/network/tcp/index.ts) | 612 | 0 | TypeScript counterpart |
| A | [server/src/network/tcp/packetCodecPool.ts](../../server/src/network/tcp/packetCodecPool.ts) | 77 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/network/tcp/packetCodecTask.ts](../../server/src/network/tcp/packetCodecTask.ts) | 114 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/network/tcp/packetFraming.js](../../server/src/network/tcp/packetFraming.js) | 20 | 22 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/packetFraming.ts](../../server/src/network/tcp/packetFraming.ts) | 31 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/socketTuning.js](../../server/src/network/tcp/socketTuning.js) | 66 | 75 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/socketTuning.ts](../../server/src/network/tcp/socketTuning.ts) | 91 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/utils/crypto.js](../../server/src/network/tcp/utils/crypto.js) | 23 | 34 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/utils/crypto.ts](../../server/src/network/tcp/utils/crypto.ts) | 44 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/utils/decode/index.js](../../server/src/network/tcp/utils/decode/index.js) | 23 | 23 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/utils/decode/index.ts](../../server/src/network/tcp/utils/decode/index.ts) | 26 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/utils/encode/index.js](../../server/src/network/tcp/utils/encode/index.js) | 68 | 67 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/utils/encode/index.ts](../../server/src/network/tcp/utils/encode/index.ts) | 82 | 0 | TypeScript counterpart |
| M | [server/src/network/tcp/utils/marshal.js](../../server/src/network/tcp/utils/marshal.js) | 1679 | 1790 | JavaScript with TypeScript counterpart |
| A | [server/src/network/tcp/utils/marshal.ts](../../server/src/network/tcp/utils/marshal.ts) | 1900 | 0 | TypeScript counterpart |

## server/src/runtimeContext.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/runtimeContext.js](../../server/src/runtimeContext.js) | 14 | 14 | JavaScript with TypeScript counterpart |

## server/src/runtimeContext.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/runtimeContext.ts](../../server/src/runtimeContext.ts) | 29 | 0 | TypeScript counterpart |

## server/src/secondaryServiceLoader.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/secondaryServiceLoader.js](../../server/src/secondaryServiceLoader.js) | 37 | 45 | JavaScript with TypeScript counterpart |

## server/src/secondaryServiceLoader.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/secondaryServiceLoader.ts](../../server/src/secondaryServiceLoader.ts) | 70 | 0 | TypeScript counterpart |

## server/src/services/_other

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/_other/alphaInjectorMgrService.js](../../server/src/services/_other/alphaInjectorMgrService.js) | 13 | 16 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_other/alphaInjectorMgrService.ts](../../server/src/services/_other/alphaInjectorMgrService.ts) | 21 | 0 | TypeScript counterpart |
| M | [server/src/services/_other/contractMgrService.js](../../server/src/services/_other/contractMgrService.js) | 60 | 78 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_other/contractMgrService.ts](../../server/src/services/_other/contractMgrService.ts) | 86 | 0 | TypeScript counterpart |
| M | [server/src/services/_other/contractProxyService.js](../../server/src/services/_other/contractProxyService.js) | 720 | 890 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_other/contractProxyService.ts](../../server/src/services/_other/contractProxyService.ts) | 932 | 0 | TypeScript counterpart |
| M | [server/src/services/_other/nonDiminishingInjectionMgrService.js](../../server/src/services/_other/nonDiminishingInjectionMgrService.js) | 10 | 13 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_other/nonDiminishingInjectionMgrService.ts](../../server/src/services/_other/nonDiminishingInjectionMgrService.ts) | 18 | 0 | TypeScript counterpart |
| A | [server/src/services/_other/searchIndexPool.ts](../../server/src/services/_other/searchIndexPool.ts) | 39 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/_other/searchIndexTask.ts](../../server/src/services/_other/searchIndexTask.ts) | 126 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/_other/searchService.js](../../server/src/services/_other/searchService.js) | 515 | 560 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_other/searchService.ts](../../server/src/services/_other/searchService.ts) | 590 | 0 | TypeScript counterpart |

## server/src/services/_shared

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/_shared/clientEntityStandings.js](../../server/src/services/_shared/clientEntityStandings.js) | 67 | 90 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/clientEntityStandings.ts](../../server/src/services/_shared/clientEntityStandings.ts) | 90 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/clientNameUtils.js](../../server/src/services/_shared/clientNameUtils.js) | 28 | 31 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/clientNameUtils.ts](../../server/src/services/_shared/clientNameUtils.ts) | 41 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/conduitJumpRuntime.js](../../server/src/services/_shared/conduitJumpRuntime.js) | 407 | 567 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/conduitJumpRuntime.ts](../../server/src/services/_shared/conduitJumpRuntime.ts) | 567 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/emergencyWarpRuntime.js](../../server/src/services/_shared/emergencyWarpRuntime.js) | 210 | 247 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/emergencyWarpRuntime.ts](../../server/src/services/_shared/emergencyWarpRuntime.ts) | 247 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/fixtureIdentities.js](../../server/src/services/_shared/fixtureIdentities.js) | 159 | 180 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/fixtureIdentities.ts](../../server/src/services/_shared/fixtureIdentities.ts) | 182 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/godmaMultiEvent.js](../../server/src/services/_shared/godmaMultiEvent.js) | 81 | 91 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/godmaMultiEvent.ts](../../server/src/services/_shared/godmaMultiEvent.ts) | 130 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/guestLists.js](../../server/src/services/_shared/guestLists.js) | 223 | 276 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/guestLists.ts](../../server/src/services/_shared/guestLists.ts) | 276 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/identityAllocator.js](../../server/src/services/_shared/identityAllocator.js) | 408 | 631 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/identityAllocator.ts](../../server/src/services/_shared/identityAllocator.ts) | 650 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/jumpTimerRuntime.js](../../server/src/services/_shared/jumpTimerRuntime.js) | 243 | 289 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/jumpTimerRuntime.ts](../../server/src/services/_shared/jumpTimerRuntime.ts) | 289 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/newCharacterStartOverride.js](../../server/src/services/_shared/newCharacterStartOverride.js) | 8 | 6 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/newCharacterStartOverride.ts](../../server/src/services/_shared/newCharacterStartOverride.ts) | 10 | 0 | TypeScript counterpart |
| A | [server/src/services/_shared/npcIdentityConstants.ts](../../server/src/services/_shared/npcIdentityConstants.ts) | 13 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/_shared/presenceReconciler.js](../../server/src/services/_shared/presenceReconciler.js) | 135 | 162 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/presenceReconciler.ts](../../server/src/services/_shared/presenceReconciler.ts) | 162 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/referenceData.js](../../server/src/services/_shared/referenceData.js) | 364 | 394 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/referenceData.ts](../../server/src/services/_shared/referenceData.ts) | 421 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/serviceCallShapeCapture.js](../../server/src/services/_shared/serviceCallShapeCapture.js) | 662 | 770 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/serviceCallShapeCapture.ts](../../server/src/services/_shared/serviceCallShapeCapture.ts) | 783 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/serviceHelpers.js](../../server/src/services/_shared/serviceHelpers.js) | 680 | 856 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/serviceHelpers.ts](../../server/src/services/_shared/serviceHelpers.ts) | 872 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/sessionDisconnect.js](../../server/src/services/_shared/sessionDisconnect.js) | 340 | 416 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/sessionDisconnect.ts](../../server/src/services/_shared/sessionDisconnect.ts) | 446 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/sessionIdentity.js](../../server/src/services/_shared/sessionIdentity.js) | 37 | 37 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/sessionIdentity.ts](../../server/src/services/_shared/sessionIdentity.ts) | 37 | 0 | TypeScript counterpart |
| M | [server/src/services/_shared/stationStaticData.js](../../server/src/services/_shared/stationStaticData.js) | 361 | 442 | JavaScript with TypeScript counterpart |
| A | [server/src/services/_shared/stationStaticData.ts](../../server/src/services/_shared/stationStaticData.ts) | 486 | 0 | TypeScript counterpart |
| A | [server/src/services/_shared/worldShutdown.ts](../../server/src/services/_shared/worldShutdown.ts) | 74 | 0 | New TypeScript path; Source or declaration |

## server/src/services/account

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/account/accountRoleProfiles.js](../../server/src/services/account/accountRoleProfiles.js) | 150 | 238 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/accountRoleProfiles.ts](../../server/src/services/account/accountRoleProfiles.ts) | 240 | 0 | TypeScript counterpart |
| M | [server/src/services/account/accountService.js](../../server/src/services/account/accountService.js) | 554 | 763 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/accountService.ts](../../server/src/services/account/accountService.ts) | 772 | 0 | TypeScript counterpart |
| M | [server/src/services/account/billMgrService.js](../../server/src/services/account/billMgrService.js) | 164 | 231 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/billMgrService.ts](../../server/src/services/account/billMgrService.ts) | 240 | 0 | TypeScript counterpart |
| M | [server/src/services/account/billNotifications.js](../../server/src/services/account/billNotifications.js) | 104 | 119 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/billNotifications.ts](../../server/src/services/account/billNotifications.ts) | 119 | 0 | TypeScript counterpart |
| M | [server/src/services/account/billRuntimeState.js](../../server/src/services/account/billRuntimeState.js) | 458 | 560 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/billRuntimeState.ts](../../server/src/services/account/billRuntimeState.ts) | 561 | 0 | TypeScript counterpart |
| M | [server/src/services/account/billingMaintenance.js](../../server/src/services/account/billingMaintenance.js) | 66 | 82 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/billingMaintenance.ts](../../server/src/services/account/billingMaintenance.ts) | 95 | 0 | TypeScript counterpart |
| M | [server/src/services/account/plexVaultLogState.js](../../server/src/services/account/plexVaultLogState.js) | 155 | 211 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/plexVaultLogState.ts](../../server/src/services/account/plexVaultLogState.ts) | 257 | 0 | TypeScript counterpart |
| M | [server/src/services/account/storeManagerService.js](../../server/src/services/account/storeManagerService.js) | 149 | 202 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/storeManagerService.ts](../../server/src/services/account/storeManagerService.ts) | 202 | 0 | TypeScript counterpart |
| M | [server/src/services/account/tutorialSvcService.js](../../server/src/services/account/tutorialSvcService.js) | 149 | 187 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/tutorialSvcService.ts](../../server/src/services/account/tutorialSvcService.ts) | 187 | 0 | TypeScript counterpart |
| M | [server/src/services/account/vaultManagerService.js](../../server/src/services/account/vaultManagerService.js) | 18 | 28 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/vaultManagerService.ts](../../server/src/services/account/vaultManagerService.ts) | 36 | 0 | TypeScript counterpart |
| M | [server/src/services/account/walletState.js](../../server/src/services/account/walletState.js) | 472 | 605 | JavaScript with TypeScript counterpart |
| A | [server/src/services/account/walletState.ts](../../server/src/services/account/walletState.ts) | 608 | 0 | TypeScript counterpart |

## server/src/services/activity

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/activity/abyssalContentManagerService.js](../../server/src/services/activity/abyssalContentManagerService.js) | 196 | 254 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/abyssalContentManagerService.ts](../../server/src/services/activity/abyssalContentManagerService.ts) | 254 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/abyssalMgrService.js](../../server/src/services/activity/abyssalMgrService.js) | 90 | 123 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/abyssalMgrService.ts](../../server/src/services/activity/abyssalMgrService.ts) | 123 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/activityMgrService.js](../../server/src/services/activity/activityMgrService.js) | 150 | 179 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/activityMgrService.ts](../../server/src/services/activity/activityMgrService.ts) | 179 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/communityTrackMgrService.js](../../server/src/services/activity/communityTrackMgrService.js) | 113 | 137 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/communityTrackMgrService.ts](../../server/src/services/activity/communityTrackMgrService.ts) | 137 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/encodedItemsService.js](../../server/src/services/activity/encodedItemsService.js) | 188 | 232 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/encodedItemsService.ts](../../server/src/services/activity/encodedItemsService.ts) | 232 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/pvpFilamentMgrService.js](../../server/src/services/activity/pvpFilamentMgrService.js) | 139 | 183 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/pvpFilamentMgrService.ts](../../server/src/services/activity/pvpFilamentMgrService.ts) | 183 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/randomJumpMgrService.js](../../server/src/services/activity/randomJumpMgrService.js) | 141 | 183 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/randomJumpMgrService.ts](../../server/src/services/activity/randomJumpMgrService.ts) | 183 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/rwManagerService.js](../../server/src/services/activity/rwManagerService.js) | 144 | 194 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/rwManagerService.ts](../../server/src/services/activity/rwManagerService.ts) | 194 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/voidSpaceMgrService.js](../../server/src/services/activity/voidSpaceMgrService.js) | 79 | 106 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/voidSpaceMgrService.ts](../../server/src/services/activity/voidSpaceMgrService.ts) | 106 | 0 | TypeScript counterpart |
| M | [server/src/services/activity/warpVectorMgrService.js](../../server/src/services/activity/warpVectorMgrService.js) | 141 | 177 | JavaScript with TypeScript counterpart |
| A | [server/src/services/activity/warpVectorMgrService.ts](../../server/src/services/activity/warpVectorMgrService.ts) | 177 | 0 | TypeScript counterpart |

## server/src/services/admin

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/admin/slashService.js](../../server/src/services/admin/slashService.js) | 165 | 225 | JavaScript with TypeScript counterpart |
| A | [server/src/services/admin/slashService.ts](../../server/src/services/admin/slashService.ts) | 251 | 0 | TypeScript counterpart |

## server/src/services/agency

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/agency/customAgencyProviderService.js](../../server/src/services/agency/customAgencyProviderService.js) | 278 | 314 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agency/customAgencyProviderService.ts](../../server/src/services/agency/customAgencyProviderService.ts) | 317 | 0 | TypeScript counterpart |

## server/src/services/agent

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/agent/agentAuthority.js](../../server/src/services/agent/agentAuthority.js) | 246 | 302 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/agentAuthority.ts](../../server/src/services/agent/agentAuthority.ts) | 302 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/agentCompatibility.js](../../server/src/services/agent/agentCompatibility.js) | 25 | 37 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/agentCompatibility.ts](../../server/src/services/agent/agentCompatibility.ts) | 46 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/agentMgrService.js](../../server/src/services/agent/agentMgrService.js) | 784 | 1129 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/agentMgrService.ts](../../server/src/services/agent/agentMgrService.ts) | 1131 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/agentMissionRuntime.js](../../server/src/services/agent/agentMissionRuntime.js) | 5215 | 7279 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/agentMissionRuntime.ts](../../server/src/services/agent/agentMissionRuntime.ts) | 7279 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/epicArcStatusService.js](../../server/src/services/agent/epicArcStatusService.js) | 207 | 262 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/epicArcStatusService.ts](../../server/src/services/agent/epicArcStatusService.ts) | 262 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/missionAuthority.js](../../server/src/services/agent/missionAuthority.js) | 738 | 933 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/missionAuthority.ts](../../server/src/services/agent/missionAuthority.ts) | 933 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/missionRuntimeState.js](../../server/src/services/agent/missionRuntimeState.js) | 1227 | 1606 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/missionRuntimeState.ts](../../server/src/services/agent/missionRuntimeState.ts) | 1606 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/missionTrackerMgrService.js](../../server/src/services/agent/missionTrackerMgrService.js) | 74 | 113 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/missionTrackerMgrService.ts](../../server/src/services/agent/missionTrackerMgrService.ts) | 113 | 0 | TypeScript counterpart |
| M | [server/src/services/agent/storylineAgentSelector.js](../../server/src/services/agent/storylineAgentSelector.js) | 208 | 257 | JavaScript with TypeScript counterpart |
| A | [server/src/services/agent/storylineAgentSelector.ts](../../server/src/services/agent/storylineAgentSelector.ts) | 257 | 0 | TypeScript counterpart |

## server/src/services/alert

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/alert/alertService.js](../../server/src/services/alert/alertService.js) | 210 | 245 | JavaScript with TypeScript counterpart |
| A | [server/src/services/alert/alertService.ts](../../server/src/services/alert/alertService.ts) | 245 | 0 | TypeScript counterpart |

## server/src/services/baseService.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/baseService.js](../../server/src/services/baseService.js) | 139 | 136 | JavaScript with TypeScript counterpart |

## server/src/services/baseService.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/services/baseService.ts](../../server/src/services/baseService.ts) | 155 | 0 | TypeScript counterpart |

## server/src/services/bookmark

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/bookmark/bookmarkChatCommands.js](../../server/src/services/bookmark/bookmarkChatCommands.js) | 268 | 294 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkChatCommands.ts](../../server/src/services/bookmark/bookmarkChatCommands.ts) | 294 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkConstants.js](../../server/src/services/bookmark/bookmarkConstants.js) | 35 | 37 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkConstants.ts](../../server/src/services/bookmark/bookmarkConstants.ts) | 71 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkNotifications.js](../../server/src/services/bookmark/bookmarkNotifications.js) | 148 | 225 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkNotifications.ts](../../server/src/services/bookmark/bookmarkNotifications.ts) | 225 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkPayloads.js](../../server/src/services/bookmark/bookmarkPayloads.js) | 135 | 170 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkPayloads.ts](../../server/src/services/bookmark/bookmarkPayloads.ts) | 170 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkRuntimeAccess.js](../../server/src/services/bookmark/bookmarkRuntimeAccess.js) | 295 | 362 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkRuntimeAccess.ts](../../server/src/services/bookmark/bookmarkRuntimeAccess.ts) | 425 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkRuntimeState.js](../../server/src/services/bookmark/bookmarkRuntimeState.js) | 1171 | 1361 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkRuntimeState.ts](../../server/src/services/bookmark/bookmarkRuntimeState.ts) | 1361 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkRuntimeStore.js](../../server/src/services/bookmark/bookmarkRuntimeStore.js) | 269 | 311 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkRuntimeStore.ts](../../server/src/services/bookmark/bookmarkRuntimeStore.ts) | 311 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkService.js](../../server/src/services/bookmark/bookmarkService.js) | 38 | 49 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkService.ts](../../server/src/services/bookmark/bookmarkService.ts) | 60 | 0 | TypeScript counterpart |
| M | [server/src/services/bookmark/bookmarkTargetResolver.js](../../server/src/services/bookmark/bookmarkTargetResolver.js) | 63 | 83 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bookmark/bookmarkTargetResolver.ts](../../server/src/services/bookmark/bookmarkTargetResolver.ts) | 83 | 0 | TypeScript counterpart |

## server/src/services/bounty

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/bounty/bountyNotifications.js](../../server/src/services/bounty/bountyNotifications.js) | 104 | 143 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/bountyNotifications.ts](../../server/src/services/bounty/bountyNotifications.ts) | 143 | 0 | TypeScript counterpart |
| M | [server/src/services/bounty/bountyProxyService.js](../../server/src/services/bounty/bountyProxyService.js) | 520 | 664 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/bountyProxyService.ts](../../server/src/services/bounty/bountyProxyService.ts) | 664 | 0 | TypeScript counterpart |
| M | [server/src/services/bounty/bountyRuntime.js](../../server/src/services/bounty/bountyRuntime.js) | 829 | 999 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/bountyRuntime.ts](../../server/src/services/bounty/bountyRuntime.ts) | 999 | 0 | TypeScript counterpart |
| M | [server/src/services/bounty/killRightMgrService.js](../../server/src/services/bounty/killRightMgrService.js) | 175 | 249 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/killRightMgrService.ts](../../server/src/services/bounty/killRightMgrService.ts) | 249 | 0 | TypeScript counterpart |
| M | [server/src/services/bounty/killRightNotifications.js](../../server/src/services/bounty/killRightNotifications.js) | 123 | 133 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/killRightNotifications.ts](../../server/src/services/bounty/killRightNotifications.ts) | 133 | 0 | TypeScript counterpart |
| M | [server/src/services/bounty/killRightState.js](../../server/src/services/bounty/killRightState.js) | 650 | 750 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/killRightState.ts](../../server/src/services/bounty/killRightState.ts) | 750 | 0 | TypeScript counterpart |
| M | [server/src/services/bounty/playerBountyState.js](../../server/src/services/bounty/playerBountyState.js) | 519 | 659 | JavaScript with TypeScript counterpart |
| A | [server/src/services/bounty/playerBountyState.ts](../../server/src/services/bounty/playerBountyState.ts) | 659 | 0 | TypeScript counterpart |

## server/src/services/browser

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/browser/browserLockdownService.js](../../server/src/services/browser/browserLockdownService.js) | 36 | 42 | JavaScript with TypeScript counterpart |
| A | [server/src/services/browser/browserLockdownService.ts](../../server/src/services/browser/browserLockdownService.ts) | 42 | 0 | TypeScript counterpart |

## server/src/services/cache

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/cache/cacheService.js](../../server/src/services/cache/cacheService.js) | 25 | 31 | JavaScript with TypeScript counterpart |
| A | [server/src/services/cache/cacheService.ts](../../server/src/services/cache/cacheService.ts) | 31 | 0 | TypeScript counterpart |
| M | [server/src/services/cache/objCacheService.js](../../server/src/services/cache/objCacheService.js) | 90 | 120 | JavaScript with TypeScript counterpart |
| A | [server/src/services/cache/objCacheService.ts](../../server/src/services/cache/objCacheService.ts) | 120 | 0 | TypeScript counterpart |
| A | [server/src/services/cache/objectCacheCodecPool.ts](../../server/src/services/cache/objectCacheCodecPool.ts) | 43 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/cache/objectCacheCodecTask.ts](../../server/src/services/cache/objectCacheCodecTask.ts) | 96 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/cache/objectCacheRuntime.js](../../server/src/services/cache/objectCacheRuntime.js) | 616 | 699 | JavaScript with TypeScript counterpart |
| A | [server/src/services/cache/objectCacheRuntime.ts](../../server/src/services/cache/objectCacheRuntime.ts) | 765 | 0 | TypeScript counterpart |

## server/src/services/calendar

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/calendar/calendarAccess.js](../../server/src/services/calendar/calendarAccess.js) | 166 | 230 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarAccess.ts](../../server/src/services/calendar/calendarAccess.ts) | 293 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarChatCommands.js](../../server/src/services/calendar/calendarChatCommands.js) | 159 | 190 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarChatCommands.ts](../../server/src/services/calendar/calendarChatCommands.ts) | 220 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarConstants.js](../../server/src/services/calendar/calendarConstants.js) | 81 | 100 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarConstants.ts](../../server/src/services/calendar/calendarConstants.ts) | 100 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarMgrService.js](../../server/src/services/calendar/calendarMgrService.js) | 92 | 153 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarMgrService.ts](../../server/src/services/calendar/calendarMgrService.ts) | 163 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarNotifications.js](../../server/src/services/calendar/calendarNotifications.js) | 82 | 124 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarNotifications.ts](../../server/src/services/calendar/calendarNotifications.ts) | 145 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarPayloads.js](../../server/src/services/calendar/calendarPayloads.js) | 86 | 115 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarPayloads.ts](../../server/src/services/calendar/calendarPayloads.ts) | 115 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarProxyService.js](../../server/src/services/calendar/calendarProxyService.js) | 13 | 20 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarProxyService.ts](../../server/src/services/calendar/calendarProxyService.ts) | 27 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarRuntimeState.js](../../server/src/services/calendar/calendarRuntimeState.js) | 640 | 835 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarRuntimeState.ts](../../server/src/services/calendar/calendarRuntimeState.ts) | 835 | 0 | TypeScript counterpart |
| M | [server/src/services/calendar/calendarStore.js](../../server/src/services/calendar/calendarStore.js) | 179 | 220 | JavaScript with TypeScript counterpart |
| A | [server/src/services/calendar/calendarStore.ts](../../server/src/services/calendar/calendarStore.ts) | 220 | 0 | TypeScript counterpart |

## server/src/services/campaign

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/campaign/crateService.js](../../server/src/services/campaign/crateService.js) | 531 | 646 | JavaScript with TypeScript counterpart |
| A | [server/src/services/campaign/crateService.ts](../../server/src/services/campaign/crateService.ts) | 646 | 0 | TypeScript counterpart |
| M | [server/src/services/campaign/loginCampaignService.js](../../server/src/services/campaign/loginCampaignService.js) | 285 | 328 | JavaScript with TypeScript counterpart |
| A | [server/src/services/campaign/loginCampaignService.ts](../../server/src/services/campaign/loginCampaignService.ts) | 328 | 0 | TypeScript counterpart |
| M | [server/src/services/campaign/loginRewardFacilitiesService.js](../../server/src/services/campaign/loginRewardFacilitiesService.js) | 40 | 47 | JavaScript with TypeScript counterpart |
| A | [server/src/services/campaign/loginRewardFacilitiesService.ts](../../server/src/services/campaign/loginRewardFacilitiesService.ts) | 47 | 0 | TypeScript counterpart |

## server/src/services/character

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/character/accessGroupBookmarkMgrService.js](../../server/src/services/character/accessGroupBookmarkMgrService.js) | 455 | 582 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/accessGroupBookmarkMgrService.ts](../../server/src/services/character/accessGroupBookmarkMgrService.ts) | 582 | 0 | TypeScript counterpart |
| M | [server/src/services/character/accessGroupStore.js](../../server/src/services/character/accessGroupStore.js) | 305 | 335 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/accessGroupStore.ts](../../server/src/services/character/accessGroupStore.ts) | 335 | 0 | TypeScript counterpart |
| M | [server/src/services/character/achievementTrackerMgrService.js](../../server/src/services/character/achievementTrackerMgrService.js) | 140 | 173 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/achievementTrackerMgrService.ts](../../server/src/services/character/achievementTrackerMgrService.ts) | 190 | 0 | TypeScript counterpart |
| M | [server/src/services/character/certificateMgrService.js](../../server/src/services/character/certificateMgrService.js) | 70 | 95 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/certificateMgrService.ts](../../server/src/services/character/certificateMgrService.ts) | 108 | 0 | TypeScript counterpart |
| M | [server/src/services/character/charMgrGlobalAssets.js](../../server/src/services/character/charMgrGlobalAssets.js) | 414 | 561 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/charMgrGlobalAssets.ts](../../server/src/services/character/charMgrGlobalAssets.ts) | 622 | 0 | TypeScript counterpart |
| M | [server/src/services/character/charMgrGlobalAssetsRowsets.js](../../server/src/services/character/charMgrGlobalAssetsRowsets.js) | 18 | 25 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/charMgrGlobalAssetsRowsets.ts](../../server/src/services/character/charMgrGlobalAssetsRowsets.ts) | 32 | 0 | TypeScript counterpart |
| M | [server/src/services/character/charMgrService.js](../../server/src/services/character/charMgrService.js) | 873 | 1075 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/charMgrService.ts](../../server/src/services/character/charMgrService.ts) | 1110 | 0 | TypeScript counterpart |
| M | [server/src/services/character/charService.js](../../server/src/services/character/charService.js) | 1607 | 1650 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/charService.ts](../../server/src/services/character/charService.ts) | 2137 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterCreationData.js](../../server/src/services/character/characterCreationData.js) | 243 | 318 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterCreationData.ts](../../server/src/services/character/characterCreationData.ts) | 318 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterDeletionRuntime.js](../../server/src/services/character/characterDeletionRuntime.js) | 611 | 783 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterDeletionRuntime.ts](../../server/src/services/character/characterDeletionRuntime.ts) | 791 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterEnergyMgrService.js](../../server/src/services/character/characterEnergyMgrService.js) | 217 | 307 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterEnergyMgrService.ts](../../server/src/services/character/characterEnergyMgrService.ts) | 309 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterEnergyState.js](../../server/src/services/character/characterEnergyState.js) | 103 | 149 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterEnergyState.ts](../../server/src/services/character/characterEnergyState.ts) | 149 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterIdentity.js](../../server/src/services/character/characterIdentity.js) | 8 | 6 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterIdentity.ts](../../server/src/services/character/characterIdentity.ts) | 10 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterNameRuntime.js](../../server/src/services/character/characterNameRuntime.js) | 293 | 307 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterNameRuntime.ts](../../server/src/services/character/characterNameRuntime.ts) | 307 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterNoteState.js](../../server/src/services/character/characterNoteState.js) | 386 | 491 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterNoteState.ts](../../server/src/services/character/characterNoteState.ts) | 491 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterSettingsState.js](../../server/src/services/character/characterSettingsState.js) | 111 | 149 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterSettingsState.ts](../../server/src/services/character/characterSettingsState.ts) | 149 | 0 | TypeScript counterpart |
| M | [server/src/services/character/characterState.js](../../server/src/services/character/characterState.js) | 3351 | 4739 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/characterState.ts](../../server/src/services/character/characterState.ts) | 4877 | 0 | TypeScript counterpart |
| M | [server/src/services/character/dogmaInvalidationVersion.js](../../server/src/services/character/dogmaInvalidationVersion.js) | 36 | 39 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/dogmaInvalidationVersion.ts](../../server/src/services/character/dogmaInvalidationVersion.ts) | 39 | 0 | TypeScript counterpart |
| M | [server/src/services/character/expertSystemMgrService.js](../../server/src/services/character/expertSystemMgrService.js) | 47 | 74 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/expertSystemMgrService.ts](../../server/src/services/character/expertSystemMgrService.ts) | 88 | 0 | TypeScript counterpart |
| M | [server/src/services/character/factionKillStandingRuntime.js](../../server/src/services/character/factionKillStandingRuntime.js) | 116 | 133 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/factionKillStandingRuntime.ts](../../server/src/services/character/factionKillStandingRuntime.ts) | 133 | 0 | TypeScript counterpart |
| M | [server/src/services/character/homeStationService.js](../../server/src/services/character/homeStationService.js) | 299 | 384 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/homeStationService.ts](../../server/src/services/character/homeStationService.ts) | 427 | 0 | TypeScript counterpart |
| M | [server/src/services/character/milestoneMgrService.js](../../server/src/services/character/milestoneMgrService.js) | 203 | 243 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/milestoneMgrService.ts](../../server/src/services/character/milestoneMgrService.ts) | 243 | 0 | TypeScript counterpart |
| M | [server/src/services/character/monolithTaskTrackerMgrService.js](../../server/src/services/character/monolithTaskTrackerMgrService.js) | 6 | 5 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/monolithTaskTrackerMgrService.ts](../../server/src/services/character/monolithTaskTrackerMgrService.ts) | 9 | 0 | TypeScript counterpart |
| M | [server/src/services/character/npcStandingsAuthority.js](../../server/src/services/character/npcStandingsAuthority.js) | 67 | 91 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/npcStandingsAuthority.ts](../../server/src/services/character/npcStandingsAuthority.ts) | 124 | 0 | TypeScript counterpart |
| M | [server/src/services/character/operationsManagerService.js](../../server/src/services/character/operationsManagerService.js) | 333 | 382 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/operationsManagerService.ts](../../server/src/services/character/operationsManagerService.ts) | 401 | 0 | TypeScript counterpart |
| M | [server/src/services/character/ownerGroupManagerService.js](../../server/src/services/character/ownerGroupManagerService.js) | 250 | 307 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/ownerGroupManagerService.ts](../../server/src/services/character/ownerGroupManagerService.ts) | 307 | 0 | TypeScript counterpart |
| M | [server/src/services/character/paperDollPayloads.js](../../server/src/services/character/paperDollPayloads.js) | 271 | 370 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/paperDollPayloads.ts](../../server/src/services/character/paperDollPayloads.ts) | 415 | 0 | TypeScript counterpart |
| M | [server/src/services/character/paperDollServerService.js](../../server/src/services/character/paperDollServerService.js) | 204 | 281 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/paperDollServerService.ts](../../server/src/services/character/paperDollServerService.ts) | 290 | 0 | TypeScript counterpart |
| M | [server/src/services/character/photoUploadService.js](../../server/src/services/character/photoUploadService.js) | 55 | 82 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/photoUploadService.ts](../../server/src/services/character/photoUploadService.ts) | 98 | 0 | TypeScript counterpart |
| M | [server/src/services/character/portraitImageStore.js](../../server/src/services/character/portraitImageStore.js) | 194 | 125 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/portraitImageStore.ts](../../server/src/services/character/portraitImageStore.ts) | 290 | 0 | TypeScript counterpart |
| M | [server/src/services/character/projectDiscoveryService.js](../../server/src/services/character/projectDiscoveryService.js) | 264 | 317 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/projectDiscoveryService.ts](../../server/src/services/character/projectDiscoveryService.ts) | 317 | 0 | TypeScript counterpart |
| M | [server/src/services/character/seasonManagerService.js](../../server/src/services/character/seasonManagerService.js) | 156 | 201 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/seasonManagerService.ts](../../server/src/services/character/seasonManagerService.ts) | 201 | 0 | TypeScript counterpart |
| M | [server/src/services/character/settingsInfoCompatibility.js](../../server/src/services/character/settingsInfoCompatibility.js) | 13 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/settingsInfoCompatibility.ts](../../server/src/services/character/settingsInfoCompatibility.ts) | 26 | 0 | TypeScript counterpart |
| M | [server/src/services/character/standingMgrService.js](../../server/src/services/character/standingMgrService.js) | 150 | 207 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/standingMgrService.ts](../../server/src/services/character/standingMgrService.ts) | 251 | 0 | TypeScript counterpart |
| M | [server/src/services/character/standingRuntime.js](../../server/src/services/character/standingRuntime.js) | 1274 | 1698 | JavaScript with TypeScript counterpart |
| A | [server/src/services/character/standingRuntime.ts](../../server/src/services/character/standingRuntime.ts) | 1698 | 0 | TypeScript counterpart |

## server/src/services/chat

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/chat/capitalNpc/capitalNpcCommandFormatter.js](../../server/src/services/chat/capitalNpc/capitalNpcCommandFormatter.js) | 152 | 174 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/capitalNpc/capitalNpcCommandFormatter.ts](../../server/src/services/chat/capitalNpc/capitalNpcCommandFormatter.ts) | 207 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/capitalNpc/capitalNpcCommandHandlers.js](../../server/src/services/chat/capitalNpc/capitalNpcCommandHandlers.js) | 617 | 790 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/capitalNpc/capitalNpcCommandHandlers.ts](../../server/src/services/chat/capitalNpc/capitalNpcCommandHandlers.ts) | 871 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/capitalNpc/capitalNpcCommandParser.js](../../server/src/services/chat/capitalNpc/capitalNpcCommandParser.js) | 122 | 140 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/capitalNpc/capitalNpcCommandParser.ts](../../server/src/services/chat/capitalNpc/capitalNpcCommandParser.ts) | 168 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/capitalNpc/capitalNpcCommandResolver.js](../../server/src/services/chat/capitalNpc/capitalNpcCommandResolver.js) | 115 | 140 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/capitalNpc/capitalNpcCommandResolver.ts](../../server/src/services/chat/capitalNpc/capitalNpcCommandResolver.ts) | 164 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/capitalNpc/index.js](../../server/src/services/chat/capitalNpc/index.js) | 27 | 29 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/capitalNpc/index.ts](../../server/src/services/chat/capitalNpc/index.ts) | 35 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/channelRules.js](../../server/src/services/chat/channelRules.js) | 114 | 170 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/channelRules.ts](../../server/src/services/chat/channelRules.ts) | 212 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/chatAuthenticationServiceService.js](../../server/src/services/chat/chatAuthenticationServiceService.js) | 85 | 112 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/chatAuthenticationServiceService.ts](../../server/src/services/chat/chatAuthenticationServiceService.ts) | 115 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/chatCommands.js](../../server/src/services/chat/chatCommands.js) | 8090 | 11745 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/chatCommands.ts](../../server/src/services/chat/chatCommands.ts) | 12166 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/chatHub.js](../../server/src/services/chat/chatHub.js) | 223 | 282 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/chatHub.ts](../../server/src/services/chat/chatHub.ts) | 361 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/commandSessionEffects.js](../../server/src/services/chat/commandSessionEffects.js) | 64 | 76 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/commandSessionEffects.ts](../../server/src/services/chat/commandSessionEffects.ts) | 88 | 0 | TypeScript counterpart |
| A | [server/src/services/chat/dungeonPropMoveCommand.ts](../../server/src/services/chat/dungeonPropMoveCommand.ts) | 194 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/chat/frontierLandscapeCommands.js](../../server/src/services/chat/frontierLandscapeCommands.js) | 281 | 334 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/frontierLandscapeCommands.ts](../../server/src/services/chat/frontierLandscapeCommands.ts) | 382 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/frontierRiftCommands.js](../../server/src/services/chat/frontierRiftCommands.js) | 201 | 251 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/frontierRiftCommands.ts](../../server/src/services/chat/frontierRiftCommands.ts) | 288 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/lscService.js](../../server/src/services/chat/lscService.js) | 70 | 93 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/lscService.ts](../../server/src/services/chat/lscService.ts) | 112 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/sessionChatSync.js](../../server/src/services/chat/sessionChatSync.js) | 107 | 143 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/sessionChatSync.ts](../../server/src/services/chat/sessionChatSync.ts) | 170 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/sessionRegistry.js](../../server/src/services/chat/sessionRegistry.js) | 169 | 210 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/sessionRegistry.ts](../../server/src/services/chat/sessionRegistry.ts) | 227 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/shipTypeRegistry.js](../../server/src/services/chat/shipTypeRegistry.js) | 187 | 229 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/shipTypeRegistry.ts](../../server/src/services/chat/shipTypeRegistry.ts) | 229 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/solarSystemRegistry.js](../../server/src/services/chat/solarSystemRegistry.js) | 116 | 154 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/solarSystemRegistry.ts](../../server/src/services/chat/solarSystemRegistry.ts) | 181 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/specialFxRegistry.js](../../server/src/services/chat/specialFxRegistry.js) | 466 | 479 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/specialFxRegistry.ts](../../server/src/services/chat/specialFxRegistry.ts) | 529 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/trigDrifter/index.js](../../server/src/services/chat/trigDrifter/index.js) | 1173 | 1348 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/trigDrifter/index.ts](../../server/src/services/chat/trigDrifter/index.ts) | 1333 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/wormhole/index.js](../../server/src/services/chat/wormhole/index.js) | 15 | 17 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/wormhole/index.ts](../../server/src/services/chat/wormhole/index.ts) | 23 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/wormhole/wormholeCommandHandlers.js](../../server/src/services/chat/wormhole/wormholeCommandHandlers.js) | 331 | 356 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/wormhole/wormholeCommandHandlers.ts](../../server/src/services/chat/wormhole/wormholeCommandHandlers.ts) | 405 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/xmppChatMgrService.js](../../server/src/services/chat/xmppChatMgrService.js) | 229 | 315 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/xmppChatMgrService.ts](../../server/src/services/chat/xmppChatMgrService.ts) | 315 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/xmppConfig.js](../../server/src/services/chat/xmppConfig.js) | 25 | 36 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/xmppConfig.ts](../../server/src/services/chat/xmppConfig.ts) | 58 | 0 | TypeScript counterpart |
| M | [server/src/services/chat/xmppStubServer.js](../../server/src/services/chat/xmppStubServer.js) | 2576 | 3338 | JavaScript with TypeScript counterpart |
| A | [server/src/services/chat/xmppStubServer.ts](../../server/src/services/chat/xmppStubServer.ts) | 3345 | 0 | TypeScript counterpart |

## server/src/services/config

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/config/configService.js](../../server/src/services/config/configService.js) | 456 | 674 | JavaScript with TypeScript counterpart |
| A | [server/src/services/config/configService.ts](../../server/src/services/config/configService.ts) | 698 | 0 | TypeScript counterpart |

## server/src/services/contracts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/contracts/contractRuntimeState.js](../../server/src/services/contracts/contractRuntimeState.js) | 1592 | 2139 | JavaScript with TypeScript counterpart |
| A | [server/src/services/contracts/contractRuntimeState.ts](../../server/src/services/contracts/contractRuntimeState.ts) | 2332 | 0 | TypeScript counterpart |

## server/src/services/corporation

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/corporation/aggressionSettingsState.js](../../server/src/services/corporation/aggressionSettingsState.js) | 147 | 183 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/aggressionSettingsState.ts](../../server/src/services/corporation/aggressionSettingsState.ts) | 183 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/allianceImageStore.js](../../server/src/services/corporation/allianceImageStore.js) | 73 | 65 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/allianceImageStore.ts](../../server/src/services/corporation/allianceImageStore.ts) | 123 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/allianceRegistryRuntime.js](../../server/src/services/corporation/allianceRegistryRuntime.js) | 726 | 991 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/allianceRegistryRuntime.ts](../../server/src/services/corporation/allianceRegistryRuntime.ts) | 995 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/allianceRegistryService.js](../../server/src/services/corporation/allianceRegistryService.js) | 3 | 0 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/allianceRegistryService.ts](../../server/src/services/corporation/allianceRegistryService.ts) | 1 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/allianceViewState.js](../../server/src/services/corporation/allianceViewState.js) | 309 | 418 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/allianceViewState.ts](../../server/src/services/corporation/allianceViewState.ts) | 418 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/contactLabelState.js](../../server/src/services/corporation/contactLabelState.js) | 71 | 81 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/contactLabelState.ts](../../server/src/services/corporation/contactLabelState.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/coreFixtureSeeder.js](../../server/src/services/corporation/coreFixtureSeeder.js) | 155 | 219 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/coreFixtureSeeder.ts](../../server/src/services/corporation/coreFixtureSeeder.ts) | 221 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpApplicationNotifications.js](../../server/src/services/corporation/corpApplicationNotifications.js) | 149 | 221 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpApplicationNotifications.ts](../../server/src/services/corporation/corpApplicationNotifications.ts) | 221 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpAssetState.js](../../server/src/services/corporation/corpAssetState.js) | 340 | 446 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpAssetState.ts](../../server/src/services/corporation/corpAssetState.ts) | 531 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpColorsState.js](../../server/src/services/corporation/corpColorsState.js) | 90 | 122 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpColorsState.ts](../../server/src/services/corporation/corpColorsState.ts) | 143 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpGoalsState.js](../../server/src/services/corporation/corpGoalsState.js) | 679 | 803 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpGoalsState.ts](../../server/src/services/corporation/corpGoalsState.ts) | 802 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpLifecycleNotifications.js](../../server/src/services/corporation/corpLifecycleNotifications.js) | 178 | 207 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpLifecycleNotifications.ts](../../server/src/services/corporation/corpLifecycleNotifications.ts) | 219 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpMemberActionState.js](../../server/src/services/corporation/corpMemberActionState.js) | 233 | 310 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpMemberActionState.ts](../../server/src/services/corporation/corpMemberActionState.ts) | 352 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpMemberQueryState.js](../../server/src/services/corporation/corpMemberQueryState.js) | 255 | 334 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpMemberQueryState.ts](../../server/src/services/corporation/corpMemberQueryState.ts) | 389 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpRecProxyService.js](../../server/src/services/corporation/corpRecProxyService.js) | 239 | 316 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpRecProxyService.ts](../../server/src/services/corporation/corpRecProxyService.ts) | 332 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpRegistryRuntime.js](../../server/src/services/corporation/corpRegistryRuntime.js) | 2229 | 2907 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpRegistryRuntime.ts](../../server/src/services/corporation/corpRegistryRuntime.ts) | 2987 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpRegistryService.js](../../server/src/services/corporation/corpRegistryService.js) | 3 | 0 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpRegistryService.ts](../../server/src/services/corporation/corpRegistryService.ts) | 1 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpService.js](../../server/src/services/corporation/corpService.js) | 450 | 571 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpService.ts](../../server/src/services/corporation/corpService.ts) | 571 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpStationMgrService.js](../../server/src/services/corporation/corpStationMgrService.js) | 231 | 326 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpStationMgrService.ts](../../server/src/services/corporation/corpStationMgrService.ts) | 326 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpWalletState.js](../../server/src/services/corporation/corpWalletState.js) | 380 | 471 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpWalletState.ts](../../server/src/services/corporation/corpWalletState.ts) | 475 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corpmgrService.js](../../server/src/services/corporation/corpmgrService.js) | 459 | 590 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corpmgrService.ts](../../server/src/services/corporation/corpmgrService.ts) | 606 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corporationGoalsState.js](../../server/src/services/corporation/corporationGoalsState.js) | 647 | 760 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corporationGoalsState.ts](../../server/src/services/corporation/corporationGoalsState.ts) | 760 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corporationIdRanges.js](../../server/src/services/corporation/corporationIdRanges.js) | 21 | 21 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corporationIdRanges.ts](../../server/src/services/corporation/corporationIdRanges.ts) | 21 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corporationNotifications.js](../../server/src/services/corporation/corporationNotifications.js) | 860 | 1083 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corporationNotifications.ts](../../server/src/services/corporation/corporationNotifications.ts) | 1151 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corporationRuntimeState.js](../../server/src/services/corporation/corporationRuntimeState.js) | 1235 | 1565 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corporationRuntimeState.ts](../../server/src/services/corporation/corporationRuntimeState.ts) | 1584 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/corporationState.js](../../server/src/services/corporation/corporationState.js) | 1137 | 1447 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/corporationState.ts](../../server/src/services/corporation/corporationState.ts) | 1463 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/fwCharacterEnlistmentMgrService.js](../../server/src/services/corporation/fwCharacterEnlistmentMgrService.js) | 86 | 114 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/fwCharacterEnlistmentMgrService.ts](../../server/src/services/corporation/fwCharacterEnlistmentMgrService.ts) | 128 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/itemLockingService.js](../../server/src/services/corporation/itemLockingService.js) | 25 | 38 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/itemLockingService.ts](../../server/src/services/corporation/itemLockingService.ts) | 43 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/lookupSvcService.js](../../server/src/services/corporation/lookupSvcService.js) | 526 | 627 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/lookupSvcService.ts](../../server/src/services/corporation/lookupSvcService.ts) | 627 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/lpService.js](../../server/src/services/corporation/lpService.js) | 101 | 155 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/lpService.ts](../../server/src/services/corporation/lpService.ts) | 170 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/lpWalletState.js](../../server/src/services/corporation/lpWalletState.js) | 517 | 700 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/lpWalletState.ts](../../server/src/services/corporation/lpWalletState.ts) | 700 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/mutualWarInviteMgrService.js](../../server/src/services/corporation/mutualWarInviteMgrService.js) | 143 | 181 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/mutualWarInviteMgrService.ts](../../server/src/services/corporation/mutualWarInviteMgrService.ts) | 202 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/officeManagerService.js](../../server/src/services/corporation/officeManagerService.js) | 545 | 743 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/officeManagerService.ts](../../server/src/services/corporation/officeManagerService.ts) | 785 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/officeRentalBilling.js](../../server/src/services/corporation/officeRentalBilling.js) | 371 | 497 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/officeRentalBilling.ts](../../server/src/services/corporation/officeRentalBilling.ts) | 536 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/peaceTreatyMgrService.js](../../server/src/services/corporation/peaceTreatyMgrService.js) | 48 | 64 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/peaceTreatyMgrService.ts](../../server/src/services/corporation/peaceTreatyMgrService.ts) | 75 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/voteManagerService.js](../../server/src/services/corporation/voteManagerService.js) | 150 | 230 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/voteManagerService.ts](../../server/src/services/corporation/voteManagerService.ts) | 276 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/voteRuntimeState.js](../../server/src/services/corporation/voteRuntimeState.js) | 699 | 925 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/voteRuntimeState.ts](../../server/src/services/corporation/voteRuntimeState.ts) | 925 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warCostState.js](../../server/src/services/corporation/warCostState.js) | 147 | 232 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warCostState.ts](../../server/src/services/corporation/warCostState.ts) | 263 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warNegotiationRuntimeState.js](../../server/src/services/corporation/warNegotiationRuntimeState.js) | 384 | 471 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warNegotiationRuntimeState.ts](../../server/src/services/corporation/warNegotiationRuntimeState.ts) | 477 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warNotificationCenter.js](../../server/src/services/corporation/warNotificationCenter.js) | 519 | 592 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warNotificationCenter.ts](../../server/src/services/corporation/warNotificationCenter.ts) | 641 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warPermitState.js](../../server/src/services/corporation/warPermitState.js) | 104 | 133 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warPermitState.ts](../../server/src/services/corporation/warPermitState.ts) | 154 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warRegistryService.js](../../server/src/services/corporation/warRegistryService.js) | 254 | 319 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warRegistryService.ts](../../server/src/services/corporation/warRegistryService.ts) | 326 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warRuntimeState.js](../../server/src/services/corporation/warRuntimeState.js) | 1112 | 1371 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warRuntimeState.ts](../../server/src/services/corporation/warRuntimeState.ts) | 1491 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warStatisticMgrService.js](../../server/src/services/corporation/warStatisticMgrService.js) | 151 | 194 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warStatisticMgrService.ts](../../server/src/services/corporation/warStatisticMgrService.ts) | 194 | 0 | TypeScript counterpart |
| M | [server/src/services/corporation/warsInfoMgrService.js](../../server/src/services/corporation/warsInfoMgrService.js) | 166 | 218 | JavaScript with TypeScript counterpart |
| A | [server/src/services/corporation/warsInfoMgrService.ts](../../server/src/services/corporation/warsInfoMgrService.ts) | 225 | 0 | TypeScript counterpart |

## server/src/services/dailyGoals

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/dailyGoals/dailyGoalsCatalog.js](../../server/src/services/dailyGoals/dailyGoalsCatalog.js) | 329 | 367 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dailyGoals/dailyGoalsCatalog.ts](../../server/src/services/dailyGoals/dailyGoalsCatalog.ts) | 369 | 0 | TypeScript counterpart |
| M | [server/src/services/dailyGoals/dailyGoalsProto.js](../../server/src/services/dailyGoals/dailyGoalsProto.js) | 473 | 484 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dailyGoals/dailyGoalsProto.ts](../../server/src/services/dailyGoals/dailyGoalsProto.ts) | 484 | 0 | TypeScript counterpart |
| M | [server/src/services/dailyGoals/dailyGoalsState.js](../../server/src/services/dailyGoals/dailyGoalsState.js) | 723 | 848 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dailyGoals/dailyGoalsState.ts](../../server/src/services/dailyGoals/dailyGoalsState.ts) | 848 | 0 | TypeScript counterpart |

## server/src/services/dogma

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/dogma/activationHeatState.js](../../server/src/services/dogma/activationHeatState.js) | 25 | 27 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/activationHeatState.ts](../../server/src/services/dogma/activationHeatState.ts) | 42 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brain/brainEffectPickle.js](../../server/src/services/dogma/brain/brainEffectPickle.js) | 62 | 78 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brain/brainEffectPickle.ts](../../server/src/services/dogma/brain/brainEffectPickle.ts) | 92 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brain/characterBrainCompatibility.js](../../server/src/services/dogma/brain/characterBrainCompatibility.js) | 11 | 21 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brain/characterBrainCompatibility.ts](../../server/src/services/dogma/brain/characterBrainCompatibility.ts) | 25 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brain/characterBrainRuntime.js](../../server/src/services/dogma/brain/characterBrainRuntime.js) | 239 | 320 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brain/characterBrainRuntime.ts](../../server/src/services/dogma/brain/characterBrainRuntime.ts) | 320 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brain/providers/fittingBrainProvider.js](../../server/src/services/dogma/brain/providers/fittingBrainProvider.js) | 16 | 22 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brain/providers/fittingBrainProvider.ts](../../server/src/services/dogma/brain/providers/fittingBrainProvider.ts) | 35 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brain/providers/implantBrainProvider.js](../../server/src/services/dogma/brain/providers/implantBrainProvider.js) | 27 | 33 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brain/providers/implantBrainProvider.ts](../../server/src/services/dogma/brain/providers/implantBrainProvider.ts) | 33 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brain/providers/industryBrainProvider.js](../../server/src/services/dogma/brain/providers/industryBrainProvider.js) | 304 | 435 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brain/providers/industryBrainProvider.ts](../../server/src/services/dogma/brain/providers/industryBrainProvider.ts) | 435 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/brainEffectPickle.js](../../server/src/services/dogma/brainEffectPickle.js) | 3 | 0 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/brainEffectPickle.ts](../../server/src/services/dogma/brainEffectPickle.ts) | 1 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/dogmaInfoCompatibility.js](../../server/src/services/dogma/dogmaInfoCompatibility.js) | 67 | 105 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/dogmaInfoCompatibility.ts](../../server/src/services/dogma/dogmaInfoCompatibility.ts) | 117 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/dogmaService.js](../../server/src/services/dogma/dogmaService.js) | 8022 | 10258 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/dogmaService.ts](../../server/src/services/dogma/dogmaService.ts) | 10575 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/dynamicItemService.js](../../server/src/services/dogma/dynamicItemService.js) | 419 | 537 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/dynamicItemService.ts](../../server/src/services/dogma/dynamicItemService.ts) | 537 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/implants/activeImplantModifiers.js](../../server/src/services/dogma/implants/activeImplantModifiers.js) | 828 | 1085 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/implants/activeImplantModifiers.ts](../../server/src/services/dogma/implants/activeImplantModifiers.ts) | 1085 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/implants/implantRuntime.js](../../server/src/services/dogma/implants/implantRuntime.js) | 318 | 413 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/implants/implantRuntime.ts](../../server/src/services/dogma/implants/implantRuntime.ts) | 413 | 0 | TypeScript counterpart |
| M | [server/src/services/dogma/industryBrainRuntime.js](../../server/src/services/dogma/industryBrainRuntime.js) | 12 | 20 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dogma/industryBrainRuntime.ts](../../server/src/services/dogma/industryBrainRuntime.ts) | 23 | 0 | TypeScript counterpart |

## server/src/services/drone

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/drone/droneDogma.js](../../server/src/services/drone/droneDogma.js) | 645 | 1014 | JavaScript with TypeScript counterpart |
| A | [server/src/services/drone/droneDogma.ts](../../server/src/services/drone/droneDogma.ts) | 1014 | 0 | TypeScript counterpart |
| M | [server/src/services/drone/droneRuntime.js](../../server/src/services/drone/droneRuntime.js) | 3647 | 4966 | JavaScript with TypeScript counterpart |
| A | [server/src/services/drone/droneRuntime.ts](../../server/src/services/drone/droneRuntime.ts) | 4989 | 0 | TypeScript counterpart |
| M | [server/src/services/drone/entityService.js](../../server/src/services/drone/entityService.js) | 70 | 98 | JavaScript with TypeScript counterpart |
| A | [server/src/services/drone/entityService.ts](../../server/src/services/drone/entityService.ts) | 107 | 0 | TypeScript counterpart |

## server/src/services/dungeon

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/dungeon/deadspaceWarpPolicy.js](../../server/src/services/dungeon/deadspaceWarpPolicy.js) | 200 | 178 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/deadspaceWarpPolicy.ts](../../server/src/services/dungeon/deadspaceWarpPolicy.ts) | 219 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonAuthority.js](../../server/src/services/dungeon/dungeonAuthority.js) | 399 | 322 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonAuthority.ts](../../server/src/services/dungeon/dungeonAuthority.ts) | 626 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonExplorationMgrService.js](../../server/src/services/dungeon/dungeonExplorationMgrService.js) | 100 | 136 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonExplorationMgrService.ts](../../server/src/services/dungeon/dungeonExplorationMgrService.ts) | 136 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonInstanceCacheMgrService.js](../../server/src/services/dungeon/dungeonInstanceCacheMgrService.js) | 547 | 670 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonInstanceCacheMgrService.ts](../../server/src/services/dungeon/dungeonInstanceCacheMgrService.ts) | 670 | 0 | TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonPropMoveSelection.ts](../../server/src/services/dungeon/dungeonPropMoveSelection.ts) | 178 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/dungeon/dungeonRuntime.js](../../server/src/services/dungeon/dungeonRuntime.js) | 1882 | 1862 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonRuntime.ts](../../server/src/services/dungeon/dungeonRuntime.ts) | 2236 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonRuntimeState.js](../../server/src/services/dungeon/dungeonRuntimeState.js) | 949 | 830 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonRuntimeState.ts](../../server/src/services/dungeon/dungeonRuntimeState.ts) | 1178 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonService.js](../../server/src/services/dungeon/dungeonService.js) | 182 | 220 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonService.ts](../../server/src/services/dungeon/dungeonService.ts) | 220 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonShipRestrictionResolver.js](../../server/src/services/dungeon/dungeonShipRestrictionResolver.js) | 112 | 148 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonShipRestrictionResolver.ts](../../server/src/services/dungeon/dungeonShipRestrictionResolver.ts) | 130 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonSiteAdapter.js](../../server/src/services/dungeon/dungeonSiteAdapter.js) | 251 | 297 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonSiteAdapter.ts](../../server/src/services/dungeon/dungeonSiteAdapter.ts) | 297 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonSiteSpawnPolicy.js](../../server/src/services/dungeon/dungeonSiteSpawnPolicy.js) | 738 | 889 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonSiteSpawnPolicy.ts](../../server/src/services/dungeon/dungeonSiteSpawnPolicy.ts) | 925 | 0 | TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonSpawnEligibility.ts](../../server/src/services/dungeon/dungeonSpawnEligibility.ts) | 416 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/dungeon/dungeonTrackingRuntime.js](../../server/src/services/dungeon/dungeonTrackingRuntime.js) | 522 | 662 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonTrackingRuntime.ts](../../server/src/services/dungeon/dungeonTrackingRuntime.ts) | 665 | 0 | TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonUniversePlanningTask.ts](../../server/src/services/dungeon/dungeonUniversePlanningTask.ts) | 36 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/dungeon/dungeonUniverseRuntime.js](../../server/src/services/dungeon/dungeonUniverseRuntime.js) | 5881 | 6238 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonUniverseRuntime.ts](../../server/src/services/dungeon/dungeonUniverseRuntime.ts) | 7349 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonUniverseSiteService.js](../../server/src/services/dungeon/dungeonUniverseSiteService.js) | 7914 | 8341 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonUniverseSiteService.ts](../../server/src/services/dungeon/dungeonUniverseSiteService.ts) | 9933 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/dungeonVisibilityPolicy.js](../../server/src/services/dungeon/dungeonVisibilityPolicy.js) | 202 | 266 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonVisibilityPolicy.ts](../../server/src/services/dungeon/dungeonVisibilityPolicy.ts) | 266 | 0 | TypeScript counterpart |
| A | [server/src/services/dungeon/dungeonWarpSafety.ts](../../server/src/services/dungeon/dungeonWarpSafety.ts) | 74 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/dungeon/keeperService.js](../../server/src/services/dungeon/keeperService.js) | 811 | 1088 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/keeperService.ts](../../server/src/services/dungeon/keeperService.ts) | 1089 | 0 | TypeScript counterpart |
| M | [server/src/services/dungeon/operationSiteRuntime.js](../../server/src/services/dungeon/operationSiteRuntime.js) | 91 | 119 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dungeon/operationSiteRuntime.ts](../../server/src/services/dungeon/operationSiteRuntime.ts) | 119 | 0 | TypeScript counterpart |

## server/src/services/dynamic

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/dynamic/dynamicBountyMgrService.js](../../server/src/services/dynamic/dynamicBountyMgrService.js) | 20 | 25 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dynamic/dynamicBountyMgrService.ts](../../server/src/services/dynamic/dynamicBountyMgrService.ts) | 31 | 0 | TypeScript counterpart |
| M | [server/src/services/dynamic/dynamicResourceCacheMgrService.js](../../server/src/services/dynamic/dynamicResourceCacheMgrService.js) | 43 | 60 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dynamic/dynamicResourceCacheMgrService.ts](../../server/src/services/dynamic/dynamicResourceCacheMgrService.ts) | 60 | 0 | TypeScript counterpart |
| M | [server/src/services/dynamic/dynamicResourceState.js](../../server/src/services/dynamic/dynamicResourceState.js) | 434 | 519 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dynamic/dynamicResourceState.ts](../../server/src/services/dynamic/dynamicResourceState.ts) | 519 | 0 | TypeScript counterpart |
| M | [server/src/services/dynamic/essMgrService.js](../../server/src/services/dynamic/essMgrService.js) | 262 | 361 | JavaScript with TypeScript counterpart |
| A | [server/src/services/dynamic/essMgrService.ts](../../server/src/services/dynamic/essMgrService.ts) | 361 | 0 | TypeScript counterpart |

## server/src/services/evermarks

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/evermarks/evermarksCatalog.js](../../server/src/services/evermarks/evermarksCatalog.js) | 213 | 258 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/evermarksCatalog.ts](../../server/src/services/evermarks/evermarksCatalog.ts) | 258 | 0 | TypeScript counterpart |
| M | [server/src/services/evermarks/evermarksConstants.js](../../server/src/services/evermarks/evermarksConstants.js) | 17 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/evermarksConstants.ts](../../server/src/services/evermarks/evermarksConstants.ts) | 33 | 0 | TypeScript counterpart |
| M | [server/src/services/evermarks/evermarksEntitlements.js](../../server/src/services/evermarks/evermarksEntitlements.js) | 290 | 358 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/evermarksEntitlements.ts](../../server/src/services/evermarks/evermarksEntitlements.ts) | 357 | 0 | TypeScript counterpart |
| M | [server/src/services/evermarks/evermarksGatewayProto.js](../../server/src/services/evermarks/evermarksGatewayProto.js) | 41 | 183 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/evermarksGatewayProto.ts](../../server/src/services/evermarks/evermarksGatewayProto.ts) | 188 | 0 | TypeScript counterpart |
| M | [server/src/services/evermarks/evermarksNotices.js](../../server/src/services/evermarks/evermarksNotices.js) | 79 | 152 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/evermarksNotices.ts](../../server/src/services/evermarks/evermarksNotices.ts) | 172 | 0 | TypeScript counterpart |
| M | [server/src/services/evermarks/evermarksStore.js](../../server/src/services/evermarks/evermarksStore.js) | 168 | 245 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/evermarksStore.ts](../../server/src/services/evermarks/evermarksStore.ts) | 267 | 0 | TypeScript counterpart |
| M | [server/src/services/evermarks/lpStoreMgrService.js](../../server/src/services/evermarks/lpStoreMgrService.js) | 376 | 543 | JavaScript with TypeScript counterpart |
| A | [server/src/services/evermarks/lpStoreMgrService.ts](../../server/src/services/evermarks/lpStoreMgrService.ts) | 582 | 0 | TypeScript counterpart |

## server/src/services/exploration

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/exploration/explorationAuthority.js](../../server/src/services/exploration/explorationAuthority.js) | 68 | 97 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/explorationAuthority.ts](../../server/src/services/exploration/explorationAuthority.ts) | 132 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/hackingMgrService.js](../../server/src/services/exploration/hackingMgrService.js) | 472 | 603 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/hackingMgrService.ts](../../server/src/services/exploration/hackingMgrService.ts) | 603 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/probes/probeRuntimeState.js](../../server/src/services/exploration/probes/probeRuntimeState.js) | 606 | 717 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/probes/probeRuntimeState.ts](../../server/src/services/exploration/probes/probeRuntimeState.ts) | 717 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/probes/probeScanRuntime.js](../../server/src/services/exploration/probes/probeScanRuntime.js) | 707 | 946 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/probes/probeScanRuntime.ts](../../server/src/services/exploration/probes/probeScanRuntime.ts) | 946 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/probes/probeSceneRuntime.js](../../server/src/services/exploration/probes/probeSceneRuntime.js) | 150 | 179 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/probes/probeSceneRuntime.ts](../../server/src/services/exploration/probes/probeSceneRuntime.ts) | 179 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/scanMgrService.js](../../server/src/services/exploration/scanMgrService.js) | 1643 | 2240 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/scanMgrService.ts](../../server/src/services/exploration/scanMgrService.ts) | 2242 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/miningAnomalyProvider.js](../../server/src/services/exploration/signatures/providers/miningAnomalyProvider.js) | 110 | 154 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/miningAnomalyProvider.ts](../../server/src/services/exploration/signatures/providers/miningAnomalyProvider.ts) | 150 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider.js](../../server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider.js) | 105 | 157 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider.ts](../../server/src/services/exploration/signatures/providers/sceneAnomalySiteProvider.ts) | 157 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/sceneProviderRuntime.js](../../server/src/services/exploration/signatures/providers/sceneProviderRuntime.js) | 29 | 38 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/sceneProviderRuntime.ts](../../server/src/services/exploration/signatures/providers/sceneProviderRuntime.ts) | 47 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider.js](../../server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider.js) | 105 | 161 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider.ts](../../server/src/services/exploration/signatures/providers/sceneSignatureSiteProvider.ts) | 161 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/sceneStaticSiteProvider.js](../../server/src/services/exploration/signatures/providers/sceneStaticSiteProvider.js) | 60 | 103 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/sceneStaticSiteProvider.ts](../../server/src/services/exploration/signatures/providers/sceneStaticSiteProvider.ts) | 120 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/structureOverlayProvider.js](../../server/src/services/exploration/signatures/providers/structureOverlayProvider.js) | 36 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/structureOverlayProvider.ts](../../server/src/services/exploration/signatures/providers/structureOverlayProvider.ts) | 60 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/providers/wormholeSignatureProvider.js](../../server/src/services/exploration/signatures/providers/wormholeSignatureProvider.js) | 123 | 164 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/providers/wormholeSignatureProvider.ts](../../server/src/services/exploration/signatures/providers/wormholeSignatureProvider.ts) | 192 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/signaturePlacement.js](../../server/src/services/exploration/signatures/signaturePlacement.js) | 117 | 116 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/signaturePlacement.ts](../../server/src/services/exploration/signatures/signaturePlacement.ts) | 182 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/signatureRuntime.js](../../server/src/services/exploration/signatures/signatureRuntime.js) | 294 | 401 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/signatureRuntime.ts](../../server/src/services/exploration/signatures/signatureRuntime.ts) | 401 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/signatures/targetIdRuntime.js](../../server/src/services/exploration/signatures/targetIdRuntime.js) | 32 | 44 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/signatures/targetIdRuntime.ts](../../server/src/services/exploration/signatures/targetIdRuntime.ts) | 59 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/wormholes/wormholeAuthority.js](../../server/src/services/exploration/wormholes/wormholeAuthority.js) | 200 | 235 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/wormholes/wormholeAuthority.ts](../../server/src/services/exploration/wormholes/wormholeAuthority.ts) | 277 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/wormholes/wormholeEnvironmentRuntime.js](../../server/src/services/exploration/wormholes/wormholeEnvironmentRuntime.js) | 157 | 218 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/wormholes/wormholeEnvironmentRuntime.ts](../../server/src/services/exploration/wormholes/wormholeEnvironmentRuntime.ts) | 258 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/wormholes/wormholeMgrService.js](../../server/src/services/exploration/wormholes/wormholeMgrService.js) | 218 | 323 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/wormholes/wormholeMgrService.ts](../../server/src/services/exploration/wormholes/wormholeMgrService.ts) | 323 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/wormholes/wormholePresentation.js](../../server/src/services/exploration/wormholes/wormholePresentation.js) | 102 | 112 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/wormholes/wormholePresentation.ts](../../server/src/services/exploration/wormholes/wormholePresentation.ts) | 129 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/wormholes/wormholeRuntime.js](../../server/src/services/exploration/wormholes/wormholeRuntime.js) | 1820 | 2121 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/wormholes/wormholeRuntime.ts](../../server/src/services/exploration/wormholes/wormholeRuntime.ts) | 2121 | 0 | TypeScript counterpart |
| M | [server/src/services/exploration/wormholes/wormholeRuntimeState.js](../../server/src/services/exploration/wormholes/wormholeRuntimeState.js) | 308 | 349 | JavaScript with TypeScript counterpart |
| A | [server/src/services/exploration/wormholes/wormholeRuntimeState.ts](../../server/src/services/exploration/wormholes/wormholeRuntimeState.ts) | 349 | 0 | TypeScript counterpart |

## server/src/services/faction

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/faction/facWarMgrService.js](../../server/src/services/faction/facWarMgrService.js) | 120 | 181 | JavaScript with TypeScript counterpart |
| A | [server/src/services/faction/facWarMgrService.ts](../../server/src/services/faction/facWarMgrService.ts) | 210 | 0 | TypeScript counterpart |
| M | [server/src/services/faction/factionImageStore.js](../../server/src/services/faction/factionImageStore.js) | 58 | 46 | JavaScript with TypeScript counterpart |
| A | [server/src/services/faction/factionImageStore.ts](../../server/src/services/faction/factionImageStore.ts) | 87 | 0 | TypeScript counterpart |
| M | [server/src/services/faction/factionState.js](../../server/src/services/faction/factionState.js) | 142 | 173 | JavaScript with TypeScript counterpart |
| A | [server/src/services/faction/factionState.ts](../../server/src/services/faction/factionState.ts) | 173 | 0 | TypeScript counterpart |
| M | [server/src/services/faction/fwVictoryPointMgrService.js](../../server/src/services/faction/fwVictoryPointMgrService.js) | 104 | 148 | JavaScript with TypeScript counterpart |
| A | [server/src/services/faction/fwVictoryPointMgrService.ts](../../server/src/services/faction/fwVictoryPointMgrService.ts) | 150 | 0 | TypeScript counterpart |

## server/src/services/fighter

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/fighter/fighterAbilities.js](../../server/src/services/fighter/fighterAbilities.js) | 208 | 290 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/fighterAbilities.ts](../../server/src/services/fighter/fighterAbilities.ts) | 341 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/fighterDogma.js](../../server/src/services/fighter/fighterDogma.js) | 551 | 799 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/fighterDogma.ts](../../server/src/services/fighter/fighterDogma.ts) | 799 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/fighterInventory.js](../../server/src/services/fighter/fighterInventory.js) | 262 | 335 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/fighterInventory.ts](../../server/src/services/fighter/fighterInventory.ts) | 347 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/fighterMgrService.js](../../server/src/services/fighter/fighterMgrService.js) | 296 | 457 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/fighterMgrService.ts](../../server/src/services/fighter/fighterMgrService.ts) | 457 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/fighterRuntime.js](../../server/src/services/fighter/fighterRuntime.js) | 3203 | 4548 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/fighterRuntime.ts](../../server/src/services/fighter/fighterRuntime.ts) | 4557 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/npc/npcFighterSessionAdapter.js](../../server/src/services/fighter/npc/npcFighterSessionAdapter.js) | 6 | 5 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/npc/npcFighterSessionAdapter.ts](../../server/src/services/fighter/npc/npcFighterSessionAdapter.ts) | 10 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/npc/npcSupercarrierDirector.js](../../server/src/services/fighter/npc/npcSupercarrierDirector.js) | 369 | 516 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/npc/npcSupercarrierDirector.ts](../../server/src/services/fighter/npc/npcSupercarrierDirector.ts) | 516 | 0 | TypeScript counterpart |
| M | [server/src/services/fighter/npc/npcSupercarrierTubeState.js](../../server/src/services/fighter/npc/npcSupercarrierTubeState.js) | 38 | 42 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fighter/npc/npcSupercarrierTubeState.ts](../../server/src/services/fighter/npc/npcSupercarrierTubeState.ts) | 51 | 0 | TypeScript counterpart |

## server/src/services/fitting

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/fitting/allianceFittingMgrService.js](../../server/src/services/fitting/allianceFittingMgrService.js) | 83 | 144 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/allianceFittingMgrService.ts](../../server/src/services/fitting/allianceFittingMgrService.ts) | 144 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/charFittingMgrService.js](../../server/src/services/fitting/charFittingMgrService.js) | 83 | 142 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/charFittingMgrService.ts](../../server/src/services/fitting/charFittingMgrService.ts) | 142 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/chargeCompatibilityPolicy.js](../../server/src/services/fitting/chargeCompatibilityPolicy.js) | 92 | 115 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/chargeCompatibilityPolicy.ts](../../server/src/services/fitting/chargeCompatibilityPolicy.ts) | 146 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/corpFittingMgrService.js](../../server/src/services/fitting/corpFittingMgrService.js) | 97 | 163 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/corpFittingMgrService.ts](../../server/src/services/fitting/corpFittingMgrService.ts) | 163 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/fittingIntegrity.js](../../server/src/services/fitting/fittingIntegrity.js) | 54 | 80 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/fittingIntegrity.ts](../../server/src/services/fitting/fittingIntegrity.ts) | 92 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/fittingMgrServiceHelpers.js](../../server/src/services/fitting/fittingMgrServiceHelpers.js) | 93 | 124 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/fittingMgrServiceHelpers.ts](../../server/src/services/fitting/fittingMgrServiceHelpers.ts) | 124 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/fittingState.js](../../server/src/services/fitting/fittingState.js) | 14 | 18 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/fittingState.ts](../../server/src/services/fitting/fittingState.ts) | 25 | 0 | TypeScript counterpart |
| M | [server/src/services/fitting/liveFittingState.js](../../server/src/services/fitting/liveFittingState.js) | 2466 | 3448 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fitting/liveFittingState.ts](../../server/src/services/fitting/liveFittingState.ts) | 3480 | 0 | TypeScript counterpart |

## server/src/services/fleets

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/fleets/fleetConstants.js](../../server/src/services/fleets/fleetConstants.js) | 76 | 73 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetConstants.ts](../../server/src/services/fleets/fleetConstants.ts) | 75 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetHelpers.js](../../server/src/services/fleets/fleetHelpers.js) | 67 | 81 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetHelpers.ts](../../server/src/services/fleets/fleetHelpers.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetMgrService.js](../../server/src/services/fleets/fleetMgrService.js) | 24 | 57 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetMgrService.ts](../../server/src/services/fleets/fleetMgrService.ts) | 63 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetObjectHandlerService.js](../../server/src/services/fleets/fleetObjectHandlerService.js) | 205 | 409 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetObjectHandlerService.ts](../../server/src/services/fleets/fleetObjectHandlerService.ts) | 423 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetPayloads.js](../../server/src/services/fleets/fleetPayloads.js) | 280 | 352 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetPayloads.ts](../../server/src/services/fleets/fleetPayloads.ts) | 411 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetProxyService.js](../../server/src/services/fleets/fleetProxyService.js) | 37 | 64 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetProxyService.ts](../../server/src/services/fleets/fleetProxyService.ts) | 70 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetRuntime.js](../../server/src/services/fleets/fleetRuntime.js) | 2312 | 2777 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetRuntime.ts](../../server/src/services/fleets/fleetRuntime.ts) | 2821 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetSetupRuntime.js](../../server/src/services/fleets/fleetSetupRuntime.js) | 250 | 285 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetSetupRuntime.ts](../../server/src/services/fleets/fleetSetupRuntime.ts) | 323 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetWarpCommandAssociation.js](../../server/src/services/fleets/fleetWarpCommandAssociation.js) | 197 | 250 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetWarpCommandAssociation.ts](../../server/src/services/fleets/fleetWarpCommandAssociation.ts) | 250 | 0 | TypeScript counterpart |
| M | [server/src/services/fleets/fleetWarpFormation.js](../../server/src/services/fleets/fleetWarpFormation.js) | 249 | 292 | JavaScript with TypeScript counterpart |
| A | [server/src/services/fleets/fleetWarpFormation.ts](../../server/src/services/fleets/fleetWarpFormation.ts) | 292 | 0 | TypeScript counterpart |

## server/src/services/frontier

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/services/frontier/assemblyAccessRuntime.ts](../../server/src/services/frontier/assemblyAccessRuntime.ts) | 1106 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/assemblyChatCommands.js](../../server/src/services/frontier/assemblyChatCommands.js) | 435 | 518 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/assemblyChatCommands.ts](../../server/src/services/frontier/assemblyChatCommands.ts) | 588 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/assemblyCrossOwnerInventoryRuntime.ts](../../server/src/services/frontier/assemblyCrossOwnerInventoryRuntime.ts) | 238 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/berthingRuntime.js](../../server/src/services/frontier/berthingRuntime.js) | 514 | 624 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/berthingRuntime.ts](../../server/src/services/frontier/berthingRuntime.ts) | 795 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/berthingSvcService.js](../../server/src/services/frontier/berthingSvcService.js) | 63 | 76 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/berthingSvcService.ts](../../server/src/services/frontier/berthingSvcService.ts) | 94 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/cairnService.js](../../server/src/services/frontier/cairnService.js) | 141 | 185 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/cairnService.ts](../../server/src/services/frontier/cairnService.ts) | 230 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/celestialStargateRuntime.ts](../../server/src/services/frontier/celestialStargateRuntime.ts) | 670 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/creationAbilityHandlers.js](../../server/src/services/frontier/creationAbilityHandlers.js) | 29 | 41 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationAbilityHandlers.ts](../../server/src/services/frontier/creationAbilityHandlers.ts) | 61 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/creationAbilityRuntime.js](../../server/src/services/frontier/creationAbilityRuntime.js) | 173 | 136 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationAbilityRuntime.ts](../../server/src/services/frontier/creationAbilityRuntime.ts) | 295 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/creationActiveModuleAbilityHandlers.ts](../../server/src/services/frontier/creationActiveModuleAbilityHandlers.ts) | 479 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/creationActiveModuleRuntime.ts](../../server/src/services/frontier/creationActiveModuleRuntime.ts) | 1273 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/creationChargeAbilityHandlers.js](../../server/src/services/frontier/creationChargeAbilityHandlers.js) | 18 | 28 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationChargeAbilityHandlers.ts](../../server/src/services/frontier/creationChargeAbilityHandlers.ts) | 34 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/creationChargeRuntime.js](../../server/src/services/frontier/creationChargeRuntime.js) | 711 | 530 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationChargeRuntime.ts](../../server/src/services/frontier/creationChargeRuntime.ts) | 1090 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/creationCompatibility.js](../../server/src/services/frontier/creationCompatibility.js) | 116 | 157 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationCompatibility.ts](../../server/src/services/frontier/creationCompatibility.ts) | 193 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/creationControlAuthority.ts](../../server/src/services/frontier/creationControlAuthority.ts) | 319 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/creationIndustryAbilityHandlers.ts](../../server/src/services/frontier/creationIndustryAbilityHandlers.ts) | 337 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/creationLayoutValidation.ts](../../server/src/services/frontier/creationLayoutValidation.ts) | 756 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/creationPresetRuntime.ts](../../server/src/services/frontier/creationPresetRuntime.ts) | 915 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/creationPresetStore.ts](../../server/src/services/frontier/creationPresetStore.ts) | 253 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/creationRuntime.js](../../server/src/services/frontier/creationRuntime.js) | 1567 | 1084 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationRuntime.ts](../../server/src/services/frontier/creationRuntime.ts) | 2199 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/creationService.js](../../server/src/services/frontier/creationService.js) | 438 | 261 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationService.ts](../../server/src/services/frontier/creationService.ts) | 644 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/creationStaticData.js](../../server/src/services/frontier/creationStaticData.js) | 40 | 60 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/creationStaticData.ts](../../server/src/services/frontier/creationStaticData.ts) | 88 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/deploymentMgrService.js](../../server/src/services/frontier/deploymentMgrService.js) | 51 | 62 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/deploymentMgrService.ts](../../server/src/services/frontier/deploymentMgrService.ts) | 78 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/deploymentRuntime.js](../../server/src/services/frontier/deploymentRuntime.js) | 4124 | 2695 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/deploymentRuntime.ts](../../server/src/services/frontier/deploymentRuntime.ts) | 5035 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/environmentalEffectsService.ts](../../server/src/services/frontier/environmentalEffectsService.ts) | 1203 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/experienceService.js](../../server/src/services/frontier/experienceService.js) | 156 | 115 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/experienceService.ts](../../server/src/services/frontier/experienceService.ts) | 241 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/fieldStorageInventoryRuntime.ts](../../server/src/services/frontier/fieldStorageInventoryRuntime.ts) | 91 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/fuelTankRuntime.js](../../server/src/services/frontier/fuelTankRuntime.js) | 988 | 273 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/fuelTankRuntime.ts](../../server/src/services/frontier/fuelTankRuntime.ts) | 1391 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/iffAbilityHandlers.js](../../server/src/services/frontier/iffAbilityHandlers.js) | 589 | 473 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/iffAbilityHandlers.ts](../../server/src/services/frontier/iffAbilityHandlers.ts) | 827 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/iffMapService.js](../../server/src/services/frontier/iffMapService.js) | 99 | 126 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/iffMapService.ts](../../server/src/services/frontier/iffMapService.ts) | 165 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/iffRuntime.js](../../server/src/services/frontier/iffRuntime.js) | 615 | 411 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/iffRuntime.ts](../../server/src/services/frontier/iffRuntime.ts) | 848 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/industryBlueprints.ts](../../server/src/services/frontier/industryBlueprints.ts) | 138 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/industryInventoryAccess.ts](../../server/src/services/frontier/industryInventoryAccess.ts) | 226 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/industryNotifications.ts](../../server/src/services/frontier/industryNotifications.ts) | 307 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/industryProduction.ts](../../server/src/services/frontier/industryProduction.ts) | 515 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/industryProductionWorker.ts](../../server/src/services/frontier/industryProductionWorker.ts) | 77 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/industryRuntime.ts](../../server/src/services/frontier/industryRuntime.ts) | 830 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/industryService.js](../../server/src/services/frontier/industryService.js) | 303 | 96 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/industryService.ts](../../server/src/services/frontier/industryService.ts) | 340 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/industryStaticData.json](../../server/src/services/frontier/industryStaticData.json) | 314 | 0 | Added file |
| A | [server/src/services/frontier/inventoryListenerRuntime.ts](../../server/src/services/frontier/inventoryListenerRuntime.ts) | 169 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/jumpDriveMgrService.ts](../../server/src/services/frontier/jumpDriveMgrService.ts) | 383 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/jumpDriveRuntime.ts](../../server/src/services/frontier/jumpDriveRuntime.ts) | 496 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/kisnService.js](../../server/src/services/frontier/kisnService.js) | 12 | 15 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/kisnService.ts](../../server/src/services/frontier/kisnService.ts) | 23 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/launchBayPayloadRuntime.ts](../../server/src/services/frontier/launchBayPayloadRuntime.ts) | 622 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/locationSelectionMgrService.ts](../../server/src/services/frontier/locationSelectionMgrService.ts) | 796 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/networkNodeEnergyConfig.ts](../../server/src/services/frontier/networkNodeEnergyConfig.ts) | 86 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/networkNodeEnergyHoldRuntime.ts](../../server/src/services/frontier/networkNodeEnergyHoldRuntime.ts) | 158 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/networkNodeEnergyRuntime.ts](../../server/src/services/frontier/networkNodeEnergyRuntime.ts) | 464 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/networkNodeFuelRuntime.js](../../server/src/services/frontier/networkNodeFuelRuntime.js) | 941 | 527 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/networkNodeFuelRuntime.ts](../../server/src/services/frontier/networkNodeFuelRuntime.ts) | 1179 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/passiveScanningRuntime.ts](../../server/src/services/frontier/passiveScanningRuntime.ts) | 277 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/refugeFittingRuntime.ts](../../server/src/services/frontier/refugeFittingRuntime.ts) | 301 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/remoteSystemScanRuntime.ts](../../server/src/services/frontier/remoteSystemScanRuntime.ts) | 1153 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/scanningAbilityHandlers.js](../../server/src/services/frontier/scanningAbilityHandlers.js) | 228 | 198 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/scanningAbilityHandlers.ts](../../server/src/services/frontier/scanningAbilityHandlers.ts) | 333 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/scanningRuntime.js](../../server/src/services/frontier/scanningRuntime.js) | 897 | 239 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/scanningRuntime.ts](../../server/src/services/frontier/scanningRuntime.ts) | 1347 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/scanningService.js](../../server/src/services/frontier/scanningService.js) | 129 | 127 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/scanningService.ts](../../server/src/services/frontier/scanningService.ts) | 213 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/shellEquipmentRuntime.ts](../../server/src/services/frontier/shellEquipmentRuntime.ts) | 342 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/shellManagerService.js](../../server/src/services/frontier/shellManagerService.js) | 283 | 284 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/shellManagerService.ts](../../server/src/services/frontier/shellManagerService.ts) | 425 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/skillShotRuntime.ts](../../server/src/services/frontier/skillShotRuntime.ts) | 1253 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/skillShotService.ts](../../server/src/services/frontier/skillShotService.ts) | 102 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/skillShotUtilityRuntime.ts](../../server/src/services/frontier/skillShotUtilityRuntime.ts) | 122 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/smartAssemblyConstructionTemplateRuntime.ts](../../server/src/services/frontier/smartAssemblyConstructionTemplateRuntime.ts) | 1036 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/smartAssemblyConstructionTemplateStore.ts](../../server/src/services/frontier/smartAssemblyConstructionTemplateStore.ts) | 274 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/smartAssemblyRequestRuntime.ts](../../server/src/services/frontier/smartAssemblyRequestRuntime.ts) | 1242 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/smartAssemblyService.js](../../server/src/services/frontier/smartAssemblyService.js) | 690 | 231 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/smartAssemblyService.ts](../../server/src/services/frontier/smartAssemblyService.ts) | 1032 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/smartStorageUnitRuntime.js](../../server/src/services/frontier/smartStorageUnitRuntime.js) | 958 | 713 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/smartStorageUnitRuntime.ts](../../server/src/services/frontier/smartStorageUnitRuntime.ts) | 1289 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/smartTurretInventoryRuntime.ts](../../server/src/services/frontier/smartTurretInventoryRuntime.ts) | 96 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/smartTurretRuntime.ts](../../server/src/services/frontier/smartTurretRuntime.ts) | 1033 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/stargateService.js](../../server/src/services/frontier/stargateService.js) | 244 | 10 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/stargateService.ts](../../server/src/services/frontier/stargateService.ts) | 272 | 0 | TypeScript counterpart |
| M | [server/src/services/frontier/statusEffectMgrService.js](../../server/src/services/frontier/statusEffectMgrService.js) | 61 | 37 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/statusEffectMgrService.ts](../../server/src/services/frontier/statusEffectMgrService.ts) | 95 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/suiAssemblyAccess.ts](../../server/src/services/frontier/suiAssemblyAccess.ts) | 781 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyActionQueue.ts](../../server/src/services/frontier/suiAssemblyActionQueue.ts) | 488 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyAdmin.ts](../../server/src/services/frontier/suiAssemblyAdmin.ts) | 198 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyChain.ts](../../server/src/services/frontier/suiAssemblyChain.ts) | 722 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyContents.ts](../../server/src/services/frontier/suiAssemblyContents.ts) | 627 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyRequestLink.ts](../../server/src/services/frontier/suiAssemblyRequestLink.ts) | 383 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblySnapshot.ts](../../server/src/services/frontier/suiAssemblySnapshot.ts) | 355 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyState.ts](../../server/src/services/frontier/suiAssemblyState.ts) | 73 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblySupervisor.ts](../../server/src/services/frontier/suiAssemblySupervisor.ts) | 201 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblySupervisor.worker.ts](../../server/src/services/frontier/suiAssemblySupervisor.worker.ts) | 205 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblySync.ts](../../server/src/services/frontier/suiAssemblySync.ts) | 1150 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiAssemblyTransactions.ts](../../server/src/services/frontier/suiAssemblyTransactions.ts) | 344 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiCharacterProvisioning.ts](../../server/src/services/frontier/suiCharacterProvisioning.ts) | 1656 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiGateSync.ts](../../server/src/services/frontier/suiGateSync.ts) | 53 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiGrpcClient.ts](../../server/src/services/frontier/suiGrpcClient.ts) | 44 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiIndustryChain.ts](../../server/src/services/frontier/suiIndustryChain.ts) | 417 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiIndustryDeployment.ts](../../server/src/services/frontier/suiIndustryDeployment.ts) | 105 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiIndustrySnapshot.ts](../../server/src/services/frontier/suiIndustrySnapshot.ts) | 192 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiIndustryStorageSync.ts](../../server/src/services/frontier/suiIndustryStorageSync.ts) | 84 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiIndustrySync.ts](../../server/src/services/frontier/suiIndustrySync.ts) | 97 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiNpcCharacterProvisioning.ts](../../server/src/services/frontier/suiNpcCharacterProvisioning.ts) | 233 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiNpcFactionFunding.ts](../../server/src/services/frontier/suiNpcFactionFunding.ts) | 311 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiNpcIdentitySync.ts](../../server/src/services/frontier/suiNpcIdentitySync.ts) | 315 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiNpcProfile.ts](../../server/src/services/frontier/suiNpcProfile.ts) | 364 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiNpcWorldConfig.ts](../../server/src/services/frontier/suiNpcWorldConfig.ts) | 856 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiStorageSync.ts](../../server/src/services/frontier/suiStorageSync.ts) | 53 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiTransponderCommitment.ts](../../server/src/services/frontier/suiTransponderCommitment.ts) | 407 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/suiTurretPriority.ts](../../server/src/services/frontier/suiTurretPriority.ts) | 354 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/frontier/systemInfoService.js](../../server/src/services/frontier/systemInfoService.js) | 128 | 167 | JavaScript with TypeScript counterpart |
| A | [server/src/services/frontier/systemInfoService.ts](../../server/src/services/frontier/systemInfoService.ts) | 213 | 0 | TypeScript counterpart |
| A | [server/src/services/frontier/systemScanIndex.ts](../../server/src/services/frontier/systemScanIndex.ts) | 531 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/systemSignatureEventRuntime.ts](../../server/src/services/frontier/systemSignatureEventRuntime.ts) | 292 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/frontier/temperatureRuntime.ts](../../server/src/services/frontier/temperatureRuntime.ts) | 577 | 0 | New TypeScript path; Source or declaration |

## server/src/services/incursion

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/incursion/incursionPayloads.js](../../server/src/services/incursion/incursionPayloads.js) | 122 | 149 | JavaScript with TypeScript counterpart |
| A | [server/src/services/incursion/incursionPayloads.ts](../../server/src/services/incursion/incursionPayloads.ts) | 149 | 0 | TypeScript counterpart |
| M | [server/src/services/incursion/incursionRuntime.js](../../server/src/services/incursion/incursionRuntime.js) | 23 | 25 | JavaScript with TypeScript counterpart |
| A | [server/src/services/incursion/incursionRuntime.ts](../../server/src/services/incursion/incursionRuntime.ts) | 25 | 0 | TypeScript counterpart |

## server/src/services/industry

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/industry/blueprintManagerService.js](../../server/src/services/industry/blueprintManagerService.js) | 33 | 48 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/blueprintManagerService.ts](../../server/src/services/industry/blueprintManagerService.ts) | 54 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/facilityManagerService.js](../../server/src/services/industry/facilityManagerService.js) | 61 | 100 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/facilityManagerService.ts](../../server/src/services/industry/facilityManagerService.ts) | 100 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryAccess.js](../../server/src/services/industry/industryAccess.js) | 109 | 128 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryAccess.ts](../../server/src/services/industry/industryAccess.ts) | 160 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryChatCommands.js](../../server/src/services/industry/industryChatCommands.js) | 558 | 665 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryChatCommands.ts](../../server/src/services/industry/industryChatCommands.ts) | 740 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryConstants.js](../../server/src/services/industry/industryConstants.js) | 202 | 225 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryConstants.ts](../../server/src/services/industry/industryConstants.ts) | 320 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryFacilityModifiers.js](../../server/src/services/industry/industryFacilityModifiers.js) | 508 | 595 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryFacilityModifiers.ts](../../server/src/services/industry/industryFacilityModifiers.ts) | 595 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryFacilityState.js](../../server/src/services/industry/industryFacilityState.js) | 143 | 166 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryFacilityState.ts](../../server/src/services/industry/industryFacilityState.ts) | 166 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryManagerService.js](../../server/src/services/industry/industryManagerService.js) | 65 | 97 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryManagerService.ts](../../server/src/services/industry/industryManagerService.ts) | 109 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryMonitorService.js](../../server/src/services/industry/industryMonitorService.js) | 21 | 29 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryMonitorService.ts](../../server/src/services/industry/industryMonitorService.ts) | 34 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryNotifications.js](../../server/src/services/industry/industryNotifications.js) | 38 | 43 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryNotifications.ts](../../server/src/services/industry/industryNotifications.ts) | 58 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryParityHelpers.js](../../server/src/services/industry/industryParityHelpers.js) | 280 | 406 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryParityHelpers.ts](../../server/src/services/industry/industryParityHelpers.ts) | 406 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryPayloads.js](../../server/src/services/industry/industryPayloads.js) | 279 | 332 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryPayloads.ts](../../server/src/services/industry/industryPayloads.ts) | 332 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryPricing.js](../../server/src/services/industry/industryPricing.js) | 125 | 162 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryPricing.ts](../../server/src/services/industry/industryPricing.ts) | 191 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryRestrictions.js](../../server/src/services/industry/industryRestrictions.js) | 272 | 361 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryRestrictions.ts](../../server/src/services/industry/industryRestrictions.ts) | 360 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryRuntimeState.js](../../server/src/services/industry/industryRuntimeState.js) | 2304 | 3096 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryRuntimeState.ts](../../server/src/services/industry/industryRuntimeState.ts) | 3103 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industryStaticData.js](../../server/src/services/industry/industryStaticData.js) | 406 | 486 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industryStaticData.ts](../../server/src/services/industry/industryStaticData.ts) | 487 | 0 | TypeScript counterpart |
| M | [server/src/services/industry/industrySystemCostIndex.js](../../server/src/services/industry/industrySystemCostIndex.js) | 39 | 41 | JavaScript with TypeScript counterpart |
| A | [server/src/services/industry/industrySystemCostIndex.ts](../../server/src/services/industry/industrySystemCostIndex.ts) | 41 | 0 | TypeScript counterpart |

## server/src/services/insurance

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/insurance/insuranceNotifications.js](../../server/src/services/insurance/insuranceNotifications.js) | 70 | 105 | JavaScript with TypeScript counterpart |
| A | [server/src/services/insurance/insuranceNotifications.ts](../../server/src/services/insurance/insuranceNotifications.ts) | 105 | 0 | TypeScript counterpart |
| M | [server/src/services/insurance/insurancePriceAuthority.js](../../server/src/services/insurance/insurancePriceAuthority.js) | 140 | 180 | JavaScript with TypeScript counterpart |
| A | [server/src/services/insurance/insurancePriceAuthority.ts](../../server/src/services/insurance/insurancePriceAuthority.ts) | 180 | 0 | TypeScript counterpart |
| M | [server/src/services/insurance/insuranceRuntime.js](../../server/src/services/insurance/insuranceRuntime.js) | 923 | 1134 | JavaScript with TypeScript counterpart |
| A | [server/src/services/insurance/insuranceRuntime.ts](../../server/src/services/insurance/insuranceRuntime.ts) | 1134 | 0 | TypeScript counterpart |
| M | [server/src/services/insurance/insuranceService.js](../../server/src/services/insurance/insuranceService.js) | 85 | 111 | JavaScript with TypeScript counterpart |
| A | [server/src/services/insurance/insuranceService.ts](../../server/src/services/insurance/insuranceService.ts) | 113 | 0 | TypeScript counterpart |

## server/src/services/inventory

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/inventory/cargoLootAuthority.js](../../server/src/services/inventory/cargoLootAuthority.js) | 24 | 36 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/cargoLootAuthority.ts](../../server/src/services/inventory/cargoLootAuthority.ts) | 43 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/fuelBayInventory.js](../../server/src/services/inventory/fuelBayInventory.js) | 152 | 190 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/fuelBayInventory.ts](../../server/src/services/inventory/fuelBayInventory.ts) | 190 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/invBrokerService.js](../../server/src/services/inventory/invBrokerService.js) | 6268 | 9173 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/invBrokerService.ts](../../server/src/services/inventory/invBrokerService.ts) | 9321 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/inventoryAssetHoldingMgrService.js](../../server/src/services/inventory/inventoryAssetHoldingMgrService.js) | 56 | 74 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/inventoryAssetHoldingMgrService.ts](../../server/src/services/inventory/inventoryAssetHoldingMgrService.ts) | 105 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/inventoryVisibilityRules.js](../../server/src/services/inventory/inventoryVisibilityRules.js) | 83 | 119 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/inventoryVisibilityRules.ts](../../server/src/services/inventory/inventoryVisibilityRules.ts) | 141 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/itemStore.js](../../server/src/services/inventory/itemStore.js) | 5132 | 5049 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/itemStore.ts](../../server/src/services/inventory/itemStore.ts) | 6419 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/itemTypeRegistry.js](../../server/src/services/inventory/itemTypeRegistry.js) | 322 | 372 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/itemTypeRegistry.ts](../../server/src/services/inventory/itemTypeRegistry.ts) | 386 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/spaceDebrisState.js](../../server/src/services/inventory/spaceDebrisState.js) | 495 | 627 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/spaceDebrisState.ts](../../server/src/services/inventory/spaceDebrisState.ts) | 627 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/specialShipHoldRegistry.js](../../server/src/services/inventory/specialShipHoldRegistry.js) | 276 | 322 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/specialShipHoldRegistry.ts](../../server/src/services/inventory/specialShipHoldRegistry.ts) | 363 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/typeListAuthority.js](../../server/src/services/inventory/typeListAuthority.js) | 240 | 140 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/typeListAuthority.ts](../../server/src/services/inventory/typeListAuthority.ts) | 284 | 0 | TypeScript counterpart |
| M | [server/src/services/inventory/wreckRadius.js](../../server/src/services/inventory/wreckRadius.js) | 298 | 384 | JavaScript with TypeScript counterpart |
| A | [server/src/services/inventory/wreckRadius.ts](../../server/src/services/inventory/wreckRadius.ts) | 437 | 0 | TypeScript counterpart |

## server/src/services/killmail

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/killmail/deathOutcomeResolver.js](../../server/src/services/killmail/deathOutcomeResolver.js) | 167 | 224 | JavaScript with TypeScript counterpart |
| A | [server/src/services/killmail/deathOutcomeResolver.ts](../../server/src/services/killmail/deathOutcomeResolver.ts) | 269 | 0 | TypeScript counterpart |
| M | [server/src/services/killmail/killmailItemPayload.js](../../server/src/services/killmail/killmailItemPayload.js) | 52 | 65 | JavaScript with TypeScript counterpart |
| A | [server/src/services/killmail/killmailItemPayload.ts](../../server/src/services/killmail/killmailItemPayload.ts) | 79 | 0 | TypeScript counterpart |
| M | [server/src/services/killmail/killmailState.js](../../server/src/services/killmail/killmailState.js) | 776 | 910 | JavaScript with TypeScript counterpart |
| A | [server/src/services/killmail/killmailState.ts](../../server/src/services/killmail/killmailState.ts) | 910 | 0 | TypeScript counterpart |

## server/src/services/logging

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/logging/clientStatLoggerService.js](../../server/src/services/logging/clientStatLoggerService.js) | 44 | 50 | JavaScript with TypeScript counterpart |
| A | [server/src/services/logging/clientStatLoggerService.ts](../../server/src/services/logging/clientStatLoggerService.ts) | 50 | 0 | TypeScript counterpart |
| M | [server/src/services/logging/eventLogService.js](../../server/src/services/logging/eventLogService.js) | 119 | 142 | JavaScript with TypeScript counterpart |
| A | [server/src/services/logging/eventLogService.ts](../../server/src/services/logging/eventLogService.ts) | 142 | 0 | TypeScript counterpart |

## server/src/services/login

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/login/accountStore.js](../../server/src/services/login/accountStore.js) | 55 | 64 | JavaScript with TypeScript counterpart |
| A | [server/src/services/login/accountStore.ts](../../server/src/services/login/accountStore.ts) | 64 | 0 | TypeScript counterpart |
| M | [server/src/services/login/authenticationService.js](../../server/src/services/login/authenticationService.js) | 248 | 324 | JavaScript with TypeScript counterpart |
| A | [server/src/services/login/authenticationService.ts](../../server/src/services/login/authenticationService.ts) | 331 | 0 | TypeScript counterpart |
| M | [server/src/services/login/multiLoginBlockerService.js](../../server/src/services/login/multiLoginBlockerService.js) | 176 | 219 | JavaScript with TypeScript counterpart |
| A | [server/src/services/login/multiLoginBlockerService.ts](../../server/src/services/login/multiLoginBlockerService.ts) | 224 | 0 | TypeScript counterpart |

## server/src/services/loyalty

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/loyalty/lpStoreOfferCatalog.js](../../server/src/services/loyalty/lpStoreOfferCatalog.js) | 95 | 162 | JavaScript with TypeScript counterpart |
| A | [server/src/services/loyalty/lpStoreOfferCatalog.ts](../../server/src/services/loyalty/lpStoreOfferCatalog.ts) | 194 | 0 | TypeScript counterpart |

## server/src/services/machoNet

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/machoNet/externalQueueMgrService.js](../../server/src/services/machoNet/externalQueueMgrService.js) | 59 | 66 | JavaScript with TypeScript counterpart |
| A | [server/src/services/machoNet/externalQueueMgrService.ts](../../server/src/services/machoNet/externalQueueMgrService.ts) | 66 | 0 | TypeScript counterpart |
| M | [server/src/services/machoNet/globalConfig.js](../../server/src/services/machoNet/globalConfig.js) | 237 | 266 | JavaScript with TypeScript counterpart |
| A | [server/src/services/machoNet/globalConfig.ts](../../server/src/services/machoNet/globalConfig.ts) | 279 | 0 | TypeScript counterpart |
| M | [server/src/services/machoNet/machoNetService.js](../../server/src/services/machoNet/machoNetService.js) | 443 | 515 | JavaScript with TypeScript counterpart |
| A | [server/src/services/machoNet/machoNetService.ts](../../server/src/services/machoNet/machoNetService.ts) | 519 | 0 | TypeScript counterpart |
| M | [server/src/services/machoNet/sessionMgrService.js](../../server/src/services/machoNet/sessionMgrService.js) | 78 | 86 | JavaScript with TypeScript counterpart |
| A | [server/src/services/machoNet/sessionMgrService.ts](../../server/src/services/machoNet/sessionMgrService.ts) | 88 | 0 | TypeScript counterpart |
| M | [server/src/services/machoNet/tcpRawProxyService.js](../../server/src/services/machoNet/tcpRawProxyService.js) | 78 | 94 | JavaScript with TypeScript counterpart |
| A | [server/src/services/machoNet/tcpRawProxyService.ts](../../server/src/services/machoNet/tcpRawProxyService.ts) | 94 | 0 | TypeScript counterpart |

## server/src/services/mail

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/mail/mailMgrService.js](../../server/src/services/mail/mailMgrService.js) | 389 | 568 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mail/mailMgrService.ts](../../server/src/services/mail/mailMgrService.ts) | 568 | 0 | TypeScript counterpart |
| M | [server/src/services/mail/mailNotifications.js](../../server/src/services/mail/mailNotifications.js) | 74 | 121 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mail/mailNotifications.ts](../../server/src/services/mail/mailNotifications.ts) | 154 | 0 | TypeScript counterpart |
| M | [server/src/services/mail/mailState.js](../../server/src/services/mail/mailState.js) | 1825 | 2306 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mail/mailState.ts](../../server/src/services/mail/mailState.ts) | 2306 | 0 | TypeScript counterpart |
| M | [server/src/services/mail/mailingListsMgrService.js](../../server/src/services/mail/mailingListsMgrService.js) | 155 | 283 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mail/mailingListsMgrService.ts](../../server/src/services/mail/mailingListsMgrService.ts) | 283 | 0 | TypeScript counterpart |

## server/src/services/map

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/map/devIndexManagerService.js](../../server/src/services/map/devIndexManagerService.js) | 29 | 47 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/devIndexManagerService.ts](../../server/src/services/map/devIndexManagerService.ts) | 53 | 0 | TypeScript counterpart |
| M | [server/src/services/map/fwWarzoneSolarsystemService.js](../../server/src/services/map/fwWarzoneSolarsystemService.js) | 102 | 129 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/fwWarzoneSolarsystemService.ts](../../server/src/services/map/fwWarzoneSolarsystemService.ts) | 129 | 0 | TypeScript counterpart |
| M | [server/src/services/map/insurgencySolarsystemService.js](../../server/src/services/map/insurgencySolarsystemService.js) | 127 | 140 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/insurgencySolarsystemService.ts](../../server/src/services/map/insurgencySolarsystemService.ts) | 140 | 0 | TypeScript counterpart |
| M | [server/src/services/map/mapService.js](../../server/src/services/map/mapService.js) | 727 | 810 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/mapService.ts](../../server/src/services/map/mapService.ts) | 926 | 0 | TypeScript counterpart |
| M | [server/src/services/map/mapTagsAuthority.js](../../server/src/services/map/mapTagsAuthority.js) | 263 | 324 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/mapTagsAuthority.ts](../../server/src/services/map/mapTagsAuthority.ts) | 379 | 0 | TypeScript counterpart |
| M | [server/src/services/map/mapTelemetryState.js](../../server/src/services/map/mapTelemetryState.js) | 267 | 324 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/mapTelemetryState.ts](../../server/src/services/map/mapTelemetryState.ts) | 324 | 0 | TypeScript counterpart |
| M | [server/src/services/map/solarSystemInterferenceState.js](../../server/src/services/map/solarSystemInterferenceState.js) | 193 | 273 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/solarSystemInterferenceState.ts](../../server/src/services/map/solarSystemInterferenceState.ts) | 273 | 0 | TypeScript counterpart |
| M | [server/src/services/map/solarsystemInterferenceMgrService.js](../../server/src/services/map/solarsystemInterferenceMgrService.js) | 57 | 89 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/solarsystemInterferenceMgrService.ts](../../server/src/services/map/solarsystemInterferenceMgrService.ts) | 89 | 0 | TypeScript counterpart |
| M | [server/src/services/map/sovMgrService.js](../../server/src/services/map/sovMgrService.js) | 57 | 89 | JavaScript with TypeScript counterpart |
| A | [server/src/services/map/sovMgrService.ts](../../server/src/services/map/sovMgrService.ts) | 95 | 0 | TypeScript counterpart |

## server/src/services/market

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/market/marketDaemonClient.js](../../server/src/services/market/marketDaemonClient.js) | 290 | 365 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketDaemonClient.ts](../../server/src/services/market/marketDaemonClient.ts) | 381 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketEscrowState.js](../../server/src/services/market/marketEscrowState.js) | 63 | 74 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketEscrowState.ts](../../server/src/services/market/marketEscrowState.ts) | 74 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketProxyService.js](../../server/src/services/market/marketProxyService.js) | 3174 | 4270 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketProxyService.ts](../../server/src/services/market/marketProxyService.ts) | 4270 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketRules.js](../../server/src/services/market/marketRules.js) | 276 | 330 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketRules.ts](../../server/src/services/market/marketRules.ts) | 330 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketRuntimeState.js](../../server/src/services/market/marketRuntimeState.js) | 44 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketRuntimeState.ts](../../server/src/services/market/marketRuntimeState.ts) | 51 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketService.js](../../server/src/services/market/marketService.js) | 101 | 118 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketService.ts](../../server/src/services/market/marketService.ts) | 131 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketState.js](../../server/src/services/market/marketState.js) | 155 | 183 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketState.ts](../../server/src/services/market/marketState.ts) | 212 | 0 | TypeScript counterpart |
| M | [server/src/services/market/marketTopology.js](../../server/src/services/market/marketTopology.js) | 153 | 249 | JavaScript with TypeScript counterpart |
| A | [server/src/services/market/marketTopology.ts](../../server/src/services/market/marketTopology.ts) | 289 | 0 | TypeScript counterpart |

## server/src/services/mining

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/mining/characterMiningLedgerService.js](../../server/src/services/mining/characterMiningLedgerService.js) | 30 | 46 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/characterMiningLedgerService.ts](../../server/src/services/mining/characterMiningLedgerService.ts) | 54 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/corpMiningLedgerService.js](../../server/src/services/mining/corpMiningLedgerService.js) | 61 | 96 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/corpMiningLedgerService.ts](../../server/src/services/mining/corpMiningLedgerService.ts) | 112 | 0 | TypeScript counterpart |
| A | [server/src/services/mining/frontierSalvageResources.ts](../../server/src/services/mining/frontierSalvageResources.ts) | 105 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/mining/iceSystemAuthority.js](../../server/src/services/mining/iceSystemAuthority.js) | 721 | 784 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/iceSystemAuthority.ts](../../server/src/services/mining/iceSystemAuthority.ts) | 784 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/inSpaceCompressionMgrService.js](../../server/src/services/mining/inSpaceCompressionMgrService.js) | 40 | 61 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/inSpaceCompressionMgrService.ts](../../server/src/services/mining/inSpaceCompressionMgrService.ts) | 70 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningCommandService.js](../../server/src/services/mining/miningCommandService.js) | 1021 | 1383 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningCommandService.ts](../../server/src/services/mining/miningCommandService.ts) | 1383 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningConstants.js](../../server/src/services/mining/miningConstants.js) | 39 | 43 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningConstants.ts](../../server/src/services/mining/miningConstants.ts) | 53 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningDogma.js](../../server/src/services/mining/miningDogma.js) | 164 | 285 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningDogma.ts](../../server/src/services/mining/miningDogma.ts) | 291 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningIndustry.js](../../server/src/services/mining/miningIndustry.js) | 703 | 929 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningIndustry.ts](../../server/src/services/mining/miningIndustry.ts) | 948 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningInventory.js](../../server/src/services/mining/miningInventory.js) | 112 | 143 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningInventory.ts](../../server/src/services/mining/miningInventory.ts) | 176 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningLedgerState.js](../../server/src/services/mining/miningLedgerState.js) | 440 | 615 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningLedgerState.ts](../../server/src/services/mining/miningLedgerState.ts) | 615 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningMath.js](../../server/src/services/mining/miningMath.js) | 96 | 177 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningMath.ts](../../server/src/services/mining/miningMath.ts) | 197 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningNpcOperations.js](../../server/src/services/mining/miningNpcOperations.js) | 2638 | 3092 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningNpcOperations.ts](../../server/src/services/mining/miningNpcOperations.ts) | 3419 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningNpcStandings.js](../../server/src/services/mining/miningNpcStandings.js) | 89 | 134 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningNpcStandings.ts](../../server/src/services/mining/miningNpcStandings.ts) | 162 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningResourceSiteService.js](../../server/src/services/mining/miningResourceSiteService.js) | 1192 | 1599 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningResourceSiteService.ts](../../server/src/services/mining/miningResourceSiteService.ts) | 1661 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningRuntime.js](../../server/src/services/mining/miningRuntime.js) | 1230 | 1274 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningRuntime.ts](../../server/src/services/mining/miningRuntime.ts) | 1698 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningRuntimeState.js](../../server/src/services/mining/miningRuntimeState.js) | 1621 | 1698 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningRuntimeState.ts](../../server/src/services/mining/miningRuntimeState.ts) | 2072 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningScanMgrService.js](../../server/src/services/mining/miningScanMgrService.js) | 12 | 14 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningScanMgrService.ts](../../server/src/services/mining/miningScanMgrService.ts) | 20 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningStartupSummary.js](../../server/src/services/mining/miningStartupSummary.js) | 201 | 247 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningStartupSummary.ts](../../server/src/services/mining/miningStartupSummary.ts) | 278 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningStaticData.js](../../server/src/services/mining/miningStaticData.js) | 13 | 22 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningStaticData.ts](../../server/src/services/mining/miningStaticData.ts) | 27 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/miningVisuals.js](../../server/src/services/mining/miningVisuals.js) | 255 | 198 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/miningVisuals.ts](../../server/src/services/mining/miningVisuals.ts) | 329 | 0 | TypeScript counterpart |
| M | [server/src/services/mining/structureCompressionMgrService.js](../../server/src/services/mining/structureCompressionMgrService.js) | 77 | 106 | JavaScript with TypeScript counterpart |
| A | [server/src/services/mining/structureCompressionMgrService.ts](../../server/src/services/mining/structureCompressionMgrService.ts) | 101 | 0 | TypeScript counterpart |

## server/src/services/moduleGrouping

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/moduleGrouping/moduleGroupingBootstrap.js](../../server/src/services/moduleGrouping/moduleGroupingBootstrap.js) | 19 | 28 | JavaScript with TypeScript counterpart |
| A | [server/src/services/moduleGrouping/moduleGroupingBootstrap.ts](../../server/src/services/moduleGrouping/moduleGroupingBootstrap.ts) | 34 | 0 | TypeScript counterpart |
| M | [server/src/services/moduleGrouping/moduleGroupingRules.js](../../server/src/services/moduleGrouping/moduleGroupingRules.js) | 138 | 183 | JavaScript with TypeScript counterpart |
| A | [server/src/services/moduleGrouping/moduleGroupingRules.ts](../../server/src/services/moduleGrouping/moduleGroupingRules.ts) | 204 | 0 | TypeScript counterpart |
| M | [server/src/services/moduleGrouping/moduleGroupingRuntime.js](../../server/src/services/moduleGrouping/moduleGroupingRuntime.js) | 331 | 456 | JavaScript with TypeScript counterpart |
| A | [server/src/services/moduleGrouping/moduleGroupingRuntime.ts](../../server/src/services/moduleGrouping/moduleGroupingRuntime.ts) | 509 | 0 | TypeScript counterpart |
| M | [server/src/services/moduleGrouping/moduleGroupingState.js](../../server/src/services/moduleGrouping/moduleGroupingState.js) | 362 | 461 | JavaScript with TypeScript counterpart |
| A | [server/src/services/moduleGrouping/moduleGroupingState.ts](../../server/src/services/moduleGrouping/moduleGroupingState.ts) | 461 | 0 | TypeScript counterpart |

## server/src/services/newEdenStore

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/newEdenStore/FastCheckoutService.js](../../server/src/services/newEdenStore/FastCheckoutService.js) | 126 | 169 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/FastCheckoutService.ts](../../server/src/services/newEdenStore/FastCheckoutService.ts) | 190 | 0 | TypeScript counterpart |
| M | [server/src/services/newEdenStore/contextualOfferMgrService.js](../../server/src/services/newEdenStore/contextualOfferMgrService.js) | 79 | 103 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/contextualOfferMgrService.ts](../../server/src/services/newEdenStore/contextualOfferMgrService.ts) | 103 | 0 | TypeScript counterpart |
| M | [server/src/services/newEdenStore/kiringMgrService.js](../../server/src/services/newEdenStore/kiringMgrService.js) | 164 | 214 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/kiringMgrService.ts](../../server/src/services/newEdenStore/kiringMgrService.ts) | 214 | 0 | TypeScript counterpart |
| M | [server/src/services/newEdenStore/storeFulfillment.js](../../server/src/services/newEdenStore/storeFulfillment.js) | 542 | 759 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/storeFulfillment.ts](../../server/src/services/newEdenStore/storeFulfillment.ts) | 819 | 0 | TypeScript counterpart |
| M | [server/src/services/newEdenStore/storeGatewayProto.js](../../server/src/services/newEdenStore/storeGatewayProto.js) | 92 | 323 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/storeGatewayProto.ts](../../server/src/services/newEdenStore/storeGatewayProto.ts) | 375 | 0 | TypeScript counterpart |
| M | [server/src/services/newEdenStore/storeMarshal.js](../../server/src/services/newEdenStore/storeMarshal.js) | 85 | 105 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/storeMarshal.ts](../../server/src/services/newEdenStore/storeMarshal.ts) | 116 | 0 | TypeScript counterpart |
| M | [server/src/services/newEdenStore/storeState.js](../../server/src/services/newEdenStore/storeState.js) | 699 | 849 | JavaScript with TypeScript counterpart |
| A | [server/src/services/newEdenStore/storeState.ts](../../server/src/services/newEdenStore/storeState.ts) | 849 | 0 | TypeScript counterpart |

## server/src/services/nodegraph

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/nodegraph/nodeGraphService.js](../../server/src/services/nodegraph/nodeGraphService.js) | 104 | 131 | JavaScript with TypeScript counterpart |
| A | [server/src/services/nodegraph/nodeGraphService.ts](../../server/src/services/nodegraph/nodeGraphService.ts) | 131 | 0 | TypeScript counterpart |

## server/src/services/notifications

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/notifications/notificationConstants.js](../../server/src/services/notifications/notificationConstants.js) | 147 | 146 | JavaScript with TypeScript counterpart |
| A | [server/src/services/notifications/notificationConstants.ts](../../server/src/services/notifications/notificationConstants.ts) | 146 | 0 | TypeScript counterpart |
| M | [server/src/services/notifications/notificationMgrService.js](../../server/src/services/notifications/notificationMgrService.js) | 100 | 160 | JavaScript with TypeScript counterpart |
| A | [server/src/services/notifications/notificationMgrService.ts](../../server/src/services/notifications/notificationMgrService.ts) | 183 | 0 | TypeScript counterpart |
| M | [server/src/services/notifications/notificationState.js](../../server/src/services/notifications/notificationState.js) | 692 | 862 | JavaScript with TypeScript counterpart |
| A | [server/src/services/notifications/notificationState.ts](../../server/src/services/notifications/notificationState.ts) | 864 | 0 | TypeScript counterpart |

## server/src/services/npc

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/services/npc/npcCreationDraft.ts](../../server/src/services/npc/npcCreationDraft.ts) | 244 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/npc/npcFittingMgrService.ts](../../server/src/services/npc/npcFittingMgrService.ts) | 682 | 0 | New TypeScript path; Source or declaration |

## server/src/services/npe

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/npe/airNpeService.js](../../server/src/services/npe/airNpeService.js) | 34 | 43 | JavaScript with TypeScript counterpart |
| A | [server/src/services/npe/airNpeService.ts](../../server/src/services/npe/airNpeService.ts) | 52 | 0 | TypeScript counterpart |
| M | [server/src/services/npe/nesIntroService.js](../../server/src/services/npe/nesIntroService.js) | 30 | 38 | JavaScript with TypeScript counterpart |
| A | [server/src/services/npe/nesIntroService.ts](../../server/src/services/npe/nesIntroService.ts) | 47 | 0 | TypeScript counterpart |
| M | [server/src/services/npe/tutorialEntrySpawnRuntime.js](../../server/src/services/npe/tutorialEntrySpawnRuntime.js) | 52 | 66 | JavaScript with TypeScript counterpart |
| A | [server/src/services/npe/tutorialEntrySpawnRuntime.ts](../../server/src/services/npe/tutorialEntrySpawnRuntime.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/services/npe/tutorialHandoffRuntime.js](../../server/src/services/npe/tutorialHandoffRuntime.js) | 55 | 75 | JavaScript with TypeScript counterpart |
| A | [server/src/services/npe/tutorialHandoffRuntime.ts](../../server/src/services/npe/tutorialHandoffRuntime.ts) | 87 | 0 | TypeScript counterpart |
| M | [server/src/services/npe/tutorialRuntime.js](../../server/src/services/npe/tutorialRuntime.js) | 312 | 411 | JavaScript with TypeScript counterpart |
| A | [server/src/services/npe/tutorialRuntime.ts](../../server/src/services/npe/tutorialRuntime.ts) | 474 | 0 | TypeScript counterpart |
| M | [server/src/services/npe/tutorialState.js](../../server/src/services/npe/tutorialState.js) | 10 | 10 | JavaScript with TypeScript counterpart |
| A | [server/src/services/npe/tutorialState.ts](../../server/src/services/npe/tutorialState.ts) | 17 | 0 | TypeScript counterpart |

## server/src/services/online

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/online/characterCommandRuntime.js](../../server/src/services/online/characterCommandRuntime.js) | 569 | 696 | JavaScript with TypeScript counterpart |
| A | [server/src/services/online/characterCommandRuntime.ts](../../server/src/services/online/characterCommandRuntime.ts) | 765 | 0 | TypeScript counterpart |
| M | [server/src/services/online/characterControlRuntime.js](../../server/src/services/online/characterControlRuntime.js) | 369 | 474 | JavaScript with TypeScript counterpart |
| A | [server/src/services/online/characterControlRuntime.ts](../../server/src/services/online/characterControlRuntime.ts) | 538 | 0 | TypeScript counterpart |
| M | [server/src/services/online/characterEventRuntime.js](../../server/src/services/online/characterEventRuntime.js) | 392 | 465 | JavaScript with TypeScript counterpart |
| A | [server/src/services/online/characterEventRuntime.ts](../../server/src/services/online/characterEventRuntime.ts) | 524 | 0 | TypeScript counterpart |
| M | [server/src/services/online/onlineStatusRuntime.js](../../server/src/services/online/onlineStatusRuntime.js) | 109 | 143 | JavaScript with TypeScript counterpart |
| A | [server/src/services/online/onlineStatusRuntime.ts](../../server/src/services/online/onlineStatusRuntime.ts) | 152 | 0 | TypeScript counterpart |
| M | [server/src/services/online/onlineStatusService.js](../../server/src/services/online/onlineStatusService.js) | 38 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/services/online/onlineStatusService.ts](../../server/src/services/online/onlineStatusService.ts) | 53 | 0 | TypeScript counterpart |

## server/src/services/overview

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/overview/overviewMotdBootstrap.js](../../server/src/services/overview/overviewMotdBootstrap.js) | 83 | 130 | JavaScript with TypeScript counterpart |
| A | [server/src/services/overview/overviewMotdBootstrap.ts](../../server/src/services/overview/overviewMotdBootstrap.ts) | 145 | 0 | TypeScript counterpart |
| M | [server/src/services/overview/overviewPresetMgrService.js](../../server/src/services/overview/overviewPresetMgrService.js) | 430 | 537 | JavaScript with TypeScript counterpart |
| A | [server/src/services/overview/overviewPresetMgrService.ts](../../server/src/services/overview/overviewPresetMgrService.ts) | 539 | 0 | TypeScript counterpart |

## server/src/services/ping

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/ping/pingService.js](../../server/src/services/ping/pingService.js) | 10 | 11 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ping/pingService.ts](../../server/src/services/ping/pingService.ts) | 22 | 0 | TypeScript counterpart |

## server/src/services/planet

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/planet/planetCostCalculator.js](../../server/src/services/planet/planetCostCalculator.js) | 208 | 267 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/planetCostCalculator.ts](../../server/src/services/planet/planetCostCalculator.ts) | 315 | 0 | TypeScript counterpart |
| M | [server/src/services/planet/planetMgrService.js](../../server/src/services/planet/planetMgrService.js) | 953 | 1253 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/planetMgrService.ts](../../server/src/services/planet/planetMgrService.ts) | 1400 | 0 | TypeScript counterpart |
| M | [server/src/services/planet/planetOrbitalRegistryBrokerService.js](../../server/src/services/planet/planetOrbitalRegistryBrokerService.js) | 67 | 92 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/planetOrbitalRegistryBrokerService.ts](../../server/src/services/planet/planetOrbitalRegistryBrokerService.ts) | 106 | 0 | TypeScript counterpart |
| M | [server/src/services/planet/planetOrbitalState.js](../../server/src/services/planet/planetOrbitalState.js) | 774 | 903 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/planetOrbitalState.ts](../../server/src/services/planet/planetOrbitalState.ts) | 903 | 0 | TypeScript counterpart |
| M | [server/src/services/planet/planetRuntimeStore.js](../../server/src/services/planet/planetRuntimeStore.js) | 3454 | 4121 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/planetRuntimeStore.ts](../../server/src/services/planet/planetRuntimeStore.ts) | 4343 | 0 | TypeScript counterpart |
| A | [server/src/services/planet/planetSimulationPool.ts](../../server/src/services/planet/planetSimulationPool.ts) | 55 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/services/planet/planetSimulationTask.ts](../../server/src/services/planet/planetSimulationTask.ts) | 15 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/planet/planetStaticData.js](../../server/src/services/planet/planetStaticData.js) | 411 | 472 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/planetStaticData.ts](../../server/src/services/planet/planetStaticData.ts) | 561 | 0 | TypeScript counterpart |
| M | [server/src/services/planet/posMgrService.js](../../server/src/services/planet/posMgrService.js) | 208 | 264 | JavaScript with TypeScript counterpart |
| A | [server/src/services/planet/posMgrService.ts](../../server/src/services/planet/posMgrService.ts) | 267 | 0 | TypeScript counterpart |

## server/src/services/populationCap

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/populationCap/populationCapService.js](../../server/src/services/populationCap/populationCapService.js) | 108 | 145 | JavaScript with TypeScript counterpart |
| A | [server/src/services/populationCap/populationCapService.ts](../../server/src/services/populationCap/populationCapService.ts) | 178 | 0 | TypeScript counterpart |

## server/src/services/raffles

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/raffles/raffleConstants.js](../../server/src/services/raffles/raffleConstants.js) | 60 | 62 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleConstants.ts](../../server/src/services/raffles/raffleConstants.ts) | 98 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleHelpers.js](../../server/src/services/raffles/raffleHelpers.js) | 348 | 466 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleHelpers.ts](../../server/src/services/raffles/raffleHelpers.ts) | 526 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleInventory.js](../../server/src/services/raffles/raffleInventory.js) | 384 | 528 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleInventory.ts](../../server/src/services/raffles/raffleInventory.ts) | 528 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleMarshal.js](../../server/src/services/raffles/raffleMarshal.js) | 70 | 81 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleMarshal.ts](../../server/src/services/raffles/raffleMarshal.ts) | 96 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleMgrService.js](../../server/src/services/raffles/raffleMgrService.js) | 14 | 17 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleMgrService.ts](../../server/src/services/raffles/raffleMgrService.ts) | 25 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleNotifications.js](../../server/src/services/raffles/raffleNotifications.js) | 37 | 43 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleNotifications.ts](../../server/src/services/raffles/raffleNotifications.ts) | 56 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleProxyService.js](../../server/src/services/raffles/raffleProxyService.js) | 92 | 118 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleProxyService.ts](../../server/src/services/raffles/raffleProxyService.ts) | 126 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleRepository.js](../../server/src/services/raffles/raffleRepository.js) | 163 | 203 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleRepository.ts](../../server/src/services/raffles/raffleRepository.ts) | 203 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleRuntime.js](../../server/src/services/raffles/raffleRuntime.js) | 660 | 915 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleRuntime.ts](../../server/src/services/raffles/raffleRuntime.ts) | 943 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleRuntimeSingleton.js](../../server/src/services/raffles/raffleRuntimeSingleton.js) | 8 | 10 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleRuntimeSingleton.ts](../../server/src/services/raffles/raffleRuntimeSingleton.ts) | 19 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleRuntimeState.js](../../server/src/services/raffles/raffleRuntimeState.js) | 54 | 66 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleRuntimeState.ts](../../server/src/services/raffles/raffleRuntimeState.ts) | 66 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleSeed.js](../../server/src/services/raffles/raffleSeed.js) | 231 | 319 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleSeed.ts](../../server/src/services/raffles/raffleSeed.ts) | 370 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleSeedManager.js](../../server/src/services/raffles/raffleSeedManager.js) | 60 | 88 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleSeedManager.ts](../../server/src/services/raffles/raffleSeedManager.ts) | 101 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleSettlement.js](../../server/src/services/raffles/raffleSettlement.js) | 153 | 236 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleSettlement.ts](../../server/src/services/raffles/raffleSettlement.ts) | 271 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleState.js](../../server/src/services/raffles/raffleState.js) | 105 | 143 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleState.ts](../../server/src/services/raffles/raffleState.ts) | 161 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleSubscriptions.js](../../server/src/services/raffles/raffleSubscriptions.js) | 78 | 103 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleSubscriptions.ts](../../server/src/services/raffles/raffleSubscriptions.ts) | 116 | 0 | TypeScript counterpart |
| M | [server/src/services/raffles/raffleValidation.js](../../server/src/services/raffles/raffleValidation.js) | 87 | 122 | JavaScript with TypeScript counterpart |
| A | [server/src/services/raffles/raffleValidation.ts](../../server/src/services/raffles/raffleValidation.ts) | 132 | 0 | TypeScript counterpart |

## server/src/services/reprocessing

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/reprocessing/index.js](../../server/src/services/reprocessing/index.js) | 7 | 4 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/index.ts](../../server/src/services/reprocessing/index.ts) | 6 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingChatCommands.js](../../server/src/services/reprocessing/reprocessingChatCommands.js) | 295 | 359 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingChatCommands.ts](../../server/src/services/reprocessing/reprocessingChatCommands.ts) | 402 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingConstants.js](../../server/src/services/reprocessing/reprocessingConstants.js) | 35 | 41 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingConstants.ts](../../server/src/services/reprocessing/reprocessingConstants.ts) | 75 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingFacilityState.js](../../server/src/services/reprocessing/reprocessingFacilityState.js) | 147 | 186 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingFacilityState.ts](../../server/src/services/reprocessing/reprocessingFacilityState.ts) | 186 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingGatewayProto.js](../../server/src/services/reprocessing/reprocessingGatewayProto.js) | 21 | 76 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingGatewayProto.ts](../../server/src/services/reprocessing/reprocessingGatewayProto.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingNotices.js](../../server/src/services/reprocessing/reprocessingNotices.js) | 55 | 78 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingNotices.ts](../../server/src/services/reprocessing/reprocessingNotices.ts) | 92 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingRuntime.js](../../server/src/services/reprocessing/reprocessingRuntime.js) | 905 | 1277 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingRuntime.ts](../../server/src/services/reprocessing/reprocessingRuntime.ts) | 1277 | 0 | TypeScript counterpart |
| M | [server/src/services/reprocessing/reprocessingStaticData.js](../../server/src/services/reprocessing/reprocessingStaticData.js) | 400 | 500 | JavaScript with TypeScript counterpart |
| A | [server/src/services/reprocessing/reprocessingStaticData.ts](../../server/src/services/reprocessing/reprocessingStaticData.ts) | 500 | 0 | TypeScript counterpart |

## server/src/services/rewards

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/rewards/rewardMgrService.js](../../server/src/services/rewards/rewardMgrService.js) | 53 | 66 | JavaScript with TypeScript counterpart |
| A | [server/src/services/rewards/rewardMgrService.ts](../../server/src/services/rewards/rewardMgrService.ts) | 66 | 0 | TypeScript counterpart |

## server/src/services/security

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/security/contrabandInspectionRuntime.js](../../server/src/services/security/contrabandInspectionRuntime.js) | 383 | 465 | JavaScript with TypeScript counterpart |
| A | [server/src/services/security/contrabandInspectionRuntime.ts](../../server/src/services/security/contrabandInspectionRuntime.ts) | 465 | 0 | TypeScript counterpart |
| M | [server/src/services/security/crimewatchCompatibility.js](../../server/src/services/security/crimewatchCompatibility.js) | 11 | 18 | JavaScript with TypeScript counterpart |
| A | [server/src/services/security/crimewatchCompatibility.ts](../../server/src/services/security/crimewatchCompatibility.ts) | 24 | 0 | TypeScript counterpart |
| M | [server/src/services/security/crimewatchService.js](../../server/src/services/security/crimewatchService.js) | 84 | 121 | JavaScript with TypeScript counterpart |
| A | [server/src/services/security/crimewatchService.ts](../../server/src/services/security/crimewatchService.ts) | 124 | 0 | TypeScript counterpart |
| M | [server/src/services/security/crimewatchState.js](../../server/src/services/security/crimewatchState.js) | 2010 | 2688 | JavaScript with TypeScript counterpart |
| A | [server/src/services/security/crimewatchState.ts](../../server/src/services/security/crimewatchState.ts) | 2688 | 0 | TypeScript counterpart |
| M | [server/src/services/security/jumpTimersService.js](../../server/src/services/security/jumpTimersService.js) | 22 | 25 | JavaScript with TypeScript counterpart |
| A | [server/src/services/security/jumpTimersService.ts](../../server/src/services/security/jumpTimersService.ts) | 25 | 0 | TypeScript counterpart |
| M | [server/src/services/security/securityMgrService.js](../../server/src/services/security/securityMgrService.js) | 10 | 10 | JavaScript with TypeScript counterpart |
| A | [server/src/services/security/securityMgrService.ts](../../server/src/services/security/securityMgrService.ts) | 16 | 0 | TypeScript counterpart |

## server/src/services/serviceManager.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/serviceManager.js](../../server/src/services/serviceManager.js) | 148 | 163 | JavaScript with TypeScript counterpart |

## server/src/services/serviceManager.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/services/serviceManager.ts](../../server/src/services/serviceManager.ts) | 176 | 0 | TypeScript counterpart |

## server/src/services/settings

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/settings/sharedSettingsMgrService.js](../../server/src/services/settings/sharedSettingsMgrService.js) | 244 | 302 | JavaScript with TypeScript counterpart |
| A | [server/src/services/settings/sharedSettingsMgrService.ts](../../server/src/services/settings/sharedSettingsMgrService.ts) | 304 | 0 | TypeScript counterpart |

## server/src/services/ship

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/ship/beyonceService.js](../../server/src/services/ship/beyonceService.js) | 2649 | 3522 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/beyonceService.ts](../../server/src/services/ship/beyonceService.ts) | 3600 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/cargoContainerRuntime.js](../../server/src/services/ship/cargoContainerRuntime.js) | 456 | 577 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/cargoContainerRuntime.ts](../../server/src/services/ship/cargoContainerRuntime.ts) | 577 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/deployableCynoRuntime.js](../../server/src/services/ship/deployableCynoRuntime.js) | 624 | 786 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/deployableCynoRuntime.ts](../../server/src/services/ship/deployableCynoRuntime.ts) | 786 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/destinyCompatibility.js](../../server/src/services/ship/destinyCompatibility.js) | 15 | 18 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/destinyCompatibility.ts](../../server/src/services/ship/destinyCompatibility.ts) | 27 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/devCommandShipRuntime.js](../../server/src/services/ship/devCommandShipRuntime.js) | 917 | 1211 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/devCommandShipRuntime.ts](../../server/src/services/ship/devCommandShipRuntime.ts) | 1311 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/ejectRuntime.js](../../server/src/services/ship/ejectRuntime.js) | 632 | 851 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/ejectRuntime.ts](../../server/src/services/ship/ejectRuntime.ts) | 851 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/ejectService.js](../../server/src/services/ship/ejectService.js) | 22 | 31 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/ejectService.ts](../../server/src/services/ship/ejectService.ts) | 31 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/interdictionProbeRuntime.js](../../server/src/services/ship/interdictionProbeRuntime.js) | 566 | 689 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/interdictionProbeRuntime.ts](../../server/src/services/ship/interdictionProbeRuntime.ts) | 689 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/jettisonRuntime.js](../../server/src/services/ship/jettisonRuntime.js) | 577 | 575 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/jettisonRuntime.ts](../../server/src/services/ship/jettisonRuntime.ts) | 722 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileAnalysisBeaconRuntime.js](../../server/src/services/ship/mobileAnalysisBeaconRuntime.js) | 1307 | 1277 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileAnalysisBeaconRuntime.ts](../../server/src/services/ship/mobileAnalysisBeaconRuntime.ts) | 1652 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileCynoInhibitorRuntime.js](../../server/src/services/ship/mobileCynoInhibitorRuntime.js) | 826 | 1039 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileCynoInhibitorRuntime.ts](../../server/src/services/ship/mobileCynoInhibitorRuntime.ts) | 1039 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileDepotRuntime.js](../../server/src/services/ship/mobileDepotRuntime.js) | 1225 | 1541 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileDepotRuntime.ts](../../server/src/services/ship/mobileDepotRuntime.ts) | 1541 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileMicroJumpUnitRuntime.js](../../server/src/services/ship/mobileMicroJumpUnitRuntime.js) | 993 | 1240 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileMicroJumpUnitRuntime.ts](../../server/src/services/ship/mobileMicroJumpUnitRuntime.ts) | 1240 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileObservatoryRuntime.js](../../server/src/services/ship/mobileObservatoryRuntime.js) | 816 | 1039 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileObservatoryRuntime.ts](../../server/src/services/ship/mobileObservatoryRuntime.ts) | 1039 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobilePhaseAnchorRuntime.js](../../server/src/services/ship/mobilePhaseAnchorRuntime.js) | 419 | 536 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobilePhaseAnchorRuntime.ts](../../server/src/services/ship/mobilePhaseAnchorRuntime.ts) | 536 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileScanInhibitorRuntime.js](../../server/src/services/ship/mobileScanInhibitorRuntime.js) | 804 | 1013 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileScanInhibitorRuntime.ts](../../server/src/services/ship/mobileScanInhibitorRuntime.ts) | 1013 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileSiphonUnitRuntime.js](../../server/src/services/ship/mobileSiphonUnitRuntime.js) | 566 | 709 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileSiphonUnitRuntime.ts](../../server/src/services/ship/mobileSiphonUnitRuntime.ts) | 709 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileTractorUnitRuntime.js](../../server/src/services/ship/mobileTractorUnitRuntime.js) | 1369 | 1755 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileTractorUnitRuntime.ts](../../server/src/services/ship/mobileTractorUnitRuntime.ts) | 1755 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/mobileWarpDisruptorRuntime.js](../../server/src/services/ship/mobileWarpDisruptorRuntime.js) | 799 | 1009 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/mobileWarpDisruptorRuntime.ts](../../server/src/services/ship/mobileWarpDisruptorRuntime.ts) | 1009 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/orbitalLaunchRuntime.js](../../server/src/services/ship/orbitalLaunchRuntime.js) | 365 | 524 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/orbitalLaunchRuntime.ts](../../server/src/services/ship/orbitalLaunchRuntime.ts) | 524 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/rookieShipRuntime.js](../../server/src/services/ship/rookieShipRuntime.js) | 407 | 562 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/rookieShipRuntime.ts](../../server/src/services/ship/rookieShipRuntime.ts) | 562 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/safeLogoffRuntime.js](../../server/src/services/ship/safeLogoffRuntime.js) | 468 | 620 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/safeLogoffRuntime.ts](../../server/src/services/ship/safeLogoffRuntime.ts) | 696 | 0 | TypeScript counterpart |
| A | [server/src/services/ship/selfDestructRuntime.ts](../../server/src/services/ship/selfDestructRuntime.ts) | 161 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/services/ship/shipAppearanceGmCommands.js](../../server/src/services/ship/shipAppearanceGmCommands.js) | 342 | 430 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipAppearanceGmCommands.ts](../../server/src/services/ship/shipAppearanceGmCommands.ts) | 513 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipCosmeticsMgrService.js](../../server/src/services/ship/shipCosmeticsMgrService.js) | 374 | 535 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipCosmeticsMgrService.ts](../../server/src/services/ship/shipCosmeticsMgrService.ts) | 557 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipCosmeticsState.js](../../server/src/services/ship/shipCosmeticsState.js) | 474 | 592 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipCosmeticsState.ts](../../server/src/services/ship/shipCosmeticsState.ts) | 603 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipDirtState.js](../../server/src/services/ship/shipDirtState.js) | 179 | 213 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipDirtState.ts](../../server/src/services/ship/shipDirtState.ts) | 213 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipKillCounterService.js](../../server/src/services/ship/shipKillCounterService.js) | 41 | 49 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipKillCounterService.ts](../../server/src/services/ship/shipKillCounterService.ts) | 49 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipKillCounterState.js](../../server/src/services/ship/shipKillCounterState.js) | 179 | 223 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipKillCounterState.ts](../../server/src/services/ship/shipKillCounterState.ts) | 223 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipLogoFittingState.js](../../server/src/services/ship/shipLogoFittingState.js) | 310 | 384 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipLogoFittingState.ts](../../server/src/services/ship/shipLogoFittingState.ts) | 384 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipLogoGatewayProto.js](../../server/src/services/ship/shipLogoGatewayProto.js) | 23 | 71 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipLogoGatewayProto.ts](../../server/src/services/ship/shipLogoGatewayProto.ts) | 76 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipNameUtils.js](../../server/src/services/ship/shipNameUtils.js) | 9 | 10 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipNameUtils.ts](../../server/src/services/ship/shipNameUtils.ts) | 16 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipService.js](../../server/src/services/ship/shipService.js) | 1502 | 2029 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipService.ts](../../server/src/services/ship/shipService.ts) | 2072 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipServiceAccess.js](../../server/src/services/ship/shipServiceAccess.js) | 151 | 205 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipServiceAccess.ts](../../server/src/services/ship/shipServiceAccess.ts) | 205 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipSkinMgrService.js](../../server/src/services/ship/shipSkinMgrService.js) | 29 | 33 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipSkinMgrService.ts](../../server/src/services/ship/shipSkinMgrService.ts) | 50 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipStanceMgrService.js](../../server/src/services/ship/shipStanceMgrService.js) | 40 | 53 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipStanceMgrService.ts](../../server/src/services/ship/shipStanceMgrService.ts) | 53 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/shipStanceRuntime.js](../../server/src/services/ship/shipStanceRuntime.js) | 371 | 468 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/shipStanceRuntime.ts](../../server/src/services/ship/shipStanceRuntime.ts) | 468 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/spaceShipSwapRuntime.js](../../server/src/services/ship/spaceShipSwapRuntime.js) | 205 | 265 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/spaceShipSwapRuntime.ts](../../server/src/services/ship/spaceShipSwapRuntime.ts) | 265 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/starterShipFittingState.js](../../server/src/services/ship/starterShipFittingState.js) | 290 | 401 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/starterShipFittingState.ts](../../server/src/services/ship/starterShipFittingState.ts) | 401 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/superWeaponMgrService.js](../../server/src/services/ship/superWeaponMgrService.js) | 78 | 94 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/superWeaponMgrService.ts](../../server/src/services/ship/superWeaponMgrService.ts) | 94 | 0 | TypeScript counterpart |
| M | [server/src/services/ship/warpDisruptFieldGeneratorRuntime.js](../../server/src/services/ship/warpDisruptFieldGeneratorRuntime.js) | 275 | 349 | JavaScript with TypeScript counterpart |
| A | [server/src/services/ship/warpDisruptFieldGeneratorRuntime.ts](../../server/src/services/ship/warpDisruptFieldGeneratorRuntime.ts) | 349 | 0 | TypeScript counterpart |

## server/src/services/shipcaster

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/shipcaster/shipCasterLandingPadMgrService.js](../../server/src/services/shipcaster/shipCasterLandingPadMgrService.js) | 24 | 30 | JavaScript with TypeScript counterpart |
| A | [server/src/services/shipcaster/shipCasterLandingPadMgrService.ts](../../server/src/services/shipcaster/shipCasterLandingPadMgrService.ts) | 30 | 0 | TypeScript counterpart |
| M | [server/src/services/shipcaster/shipCasterLauncherMgrService.js](../../server/src/services/shipcaster/shipCasterLauncherMgrService.js) | 17 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/services/shipcaster/shipCasterLauncherMgrService.ts](../../server/src/services/shipcaster/shipCasterLauncherMgrService.ts) | 19 | 0 | TypeScript counterpart |
| M | [server/src/services/shipcaster/shipcasterRuntime.js](../../server/src/services/shipcaster/shipcasterRuntime.js) | 194 | 248 | JavaScript with TypeScript counterpart |
| A | [server/src/services/shipcaster/shipcasterRuntime.ts](../../server/src/services/shipcaster/shipcasterRuntime.ts) | 248 | 0 | TypeScript counterpart |
| M | [server/src/services/shipcaster/shipcasterTravelMgrService.js](../../server/src/services/shipcaster/shipcasterTravelMgrService.js) | 33 | 39 | JavaScript with TypeScript counterpart |
| A | [server/src/services/shipcaster/shipcasterTravelMgrService.ts](../../server/src/services/shipcaster/shipcasterTravelMgrService.ts) | 39 | 0 | TypeScript counterpart |
| M | [server/src/services/shipcaster/starterShipcasterTravelMgrService.js](../../server/src/services/shipcaster/starterShipcasterTravelMgrService.js) | 36 | 43 | JavaScript with TypeScript counterpart |
| A | [server/src/services/shipcaster/starterShipcasterTravelMgrService.ts](../../server/src/services/shipcaster/starterShipcasterTravelMgrService.ts) | 43 | 0 | TypeScript counterpart |

## server/src/services/skills

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/skills/boosters/boosterRuntime.js](../../server/src/services/skills/boosters/boosterRuntime.js) | 417 | 555 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/boosters/boosterRuntime.ts](../../server/src/services/skills/boosters/boosterRuntime.ts) | 555 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/boosters/boosterSkillRuntime.js](../../server/src/services/skills/boosters/boosterSkillRuntime.js) | 178 | 230 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/boosters/boosterSkillRuntime.ts](../../server/src/services/skills/boosters/boosterSkillRuntime.ts) | 230 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/certificates/certificateRuntime.js](../../server/src/services/skills/certificates/certificateRuntime.js) | 403 | 506 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/certificates/certificateRuntime.ts](../../server/src/services/skills/certificates/certificateRuntime.ts) | 506 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/certificates/skillChangeTracker.js](../../server/src/services/skills/certificates/skillChangeTracker.js) | 97 | 134 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/certificates/skillChangeTracker.ts](../../server/src/services/skills/certificates/skillChangeTracker.ts) | 155 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemCatalog.js](../../server/src/services/skills/expertSystems/expertSystemCatalog.js) | 245 | 290 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemCatalog.ts](../../server/src/services/skills/expertSystems/expertSystemCatalog.ts) | 290 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemExpiryScheduler.js](../../server/src/services/skills/expertSystems/expertSystemExpiryScheduler.js) | 126 | 150 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemExpiryScheduler.ts](../../server/src/services/skills/expertSystems/expertSystemExpiryScheduler.ts) | 150 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemNotifications.js](../../server/src/services/skills/expertSystems/expertSystemNotifications.js) | 79 | 108 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemNotifications.ts](../../server/src/services/skills/expertSystems/expertSystemNotifications.ts) | 108 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemProjection.js](../../server/src/services/skills/expertSystems/expertSystemProjection.js) | 138 | 173 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemProjection.ts](../../server/src/services/skills/expertSystems/expertSystemProjection.ts) | 213 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemRuntime.js](../../server/src/services/skills/expertSystems/expertSystemRuntime.js) | 275 | 382 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemRuntime.ts](../../server/src/services/skills/expertSystems/expertSystemRuntime.ts) | 421 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemSerializer.js](../../server/src/services/skills/expertSystems/expertSystemSerializer.js) | 23 | 31 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemSerializer.ts](../../server/src/services/skills/expertSystems/expertSystemSerializer.ts) | 42 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/expertSystems/expertSystemState.js](../../server/src/services/skills/expertSystems/expertSystemState.js) | 171 | 214 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/expertSystems/expertSystemState.ts](../../server/src/services/skills/expertSystems/expertSystemState.ts) | 214 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/plans/corpSkillPlanState.js](../../server/src/services/skills/plans/corpSkillPlanState.js) | 307 | 369 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/plans/corpSkillPlanState.ts](../../server/src/services/skills/plans/corpSkillPlanState.ts) | 369 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/plans/skillPlanState.js](../../server/src/services/skills/plans/skillPlanState.js) | 526 | 607 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/plans/skillPlanState.ts](../../server/src/services/skills/plans/skillPlanState.ts) | 607 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/publicGatewayService.js](../../server/src/services/skills/publicGatewayService.js) | 28 | 35 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/publicGatewayService.ts](../../server/src/services/skills/publicGatewayService.ts) | 46 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillAdminRuntime.js](../../server/src/services/skills/skillAdminRuntime.js) | 176 | 233 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillAdminRuntime.ts](../../server/src/services/skills/skillAdminRuntime.ts) | 262 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillHandlerService.js](../../server/src/services/skills/skillHandlerService.js) | 7 | 6 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillHandlerService.ts](../../server/src/services/skills/skillHandlerService.ts) | 12 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillMgr2Service.js](../../server/src/services/skills/skillMgr2Service.js) | 18 | 18 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillMgr2Service.ts](../../server/src/services/skills/skillMgr2Service.ts) | 22 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillMgrService.js](../../server/src/services/skills/skillMgrService.js) | 446 | 649 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillMgrService.ts](../../server/src/services/skills/skillMgrService.ts) | 649 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillState.js](../../server/src/services/skills/skillState.js) | 801 | 1083 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillState.ts](../../server/src/services/skills/skillState.ts) | 1091 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillTransport.js](../../server/src/services/skills/skillTransport.js) | 59 | 90 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillTransport.ts](../../server/src/services/skills/skillTransport.ts) | 106 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/skillbooks/skillbookRuntime.js](../../server/src/services/skills/skillbooks/skillbookRuntime.js) | 354 | 480 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/skillbooks/skillbookRuntime.ts](../../server/src/services/skills/skillbooks/skillbookRuntime.ts) | 553 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/trading/skillTradingAuthority.js](../../server/src/services/skills/trading/skillTradingAuthority.js) | 233 | 332 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/trading/skillTradingAuthority.ts](../../server/src/services/skills/trading/skillTradingAuthority.ts) | 412 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/trading/skillTradingNotifications.js](../../server/src/services/skills/trading/skillTradingNotifications.js) | 34 | 42 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/trading/skillTradingNotifications.ts](../../server/src/services/skills/trading/skillTradingNotifications.ts) | 56 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/trading/skillTradingRuntime.js](../../server/src/services/skills/trading/skillTradingRuntime.js) | 708 | 1043 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/trading/skillTradingRuntime.ts](../../server/src/services/skills/trading/skillTradingRuntime.ts) | 1043 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/trading/skillTradingState.js](../../server/src/services/skills/trading/skillTradingState.js) | 120 | 148 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/trading/skillTradingState.ts](../../server/src/services/skills/trading/skillTradingState.ts) | 148 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/training/skillCloneRestrictions.js](../../server/src/services/skills/training/skillCloneRestrictions.js) | 194 | 251 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/training/skillCloneRestrictions.ts](../../server/src/services/skills/training/skillCloneRestrictions.ts) | 251 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/training/skillQueueNotifications.js](../../server/src/services/skills/training/skillQueueNotifications.js) | 338 | 451 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/training/skillQueueNotifications.ts](../../server/src/services/skills/training/skillQueueNotifications.ts) | 478 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/training/skillQueueRuntime.js](../../server/src/services/skills/training/skillQueueRuntime.js) | 1204 | 1580 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/training/skillQueueRuntime.ts](../../server/src/services/skills/training/skillQueueRuntime.ts) | 1608 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/training/skillQueueState.js](../../server/src/services/skills/training/skillQueueState.js) | 115 | 137 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/training/skillQueueState.ts](../../server/src/services/skills/training/skillQueueState.ts) | 137 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/training/skillTrainingMath.js](../../server/src/services/skills/training/skillTrainingMath.js) | 181 | 251 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/training/skillTrainingMath.ts](../../server/src/services/skills/training/skillTrainingMath.ts) | 251 | 0 | TypeScript counterpart |
| M | [server/src/services/skills/training/skillTrainingSpeed.js](../../server/src/services/skills/training/skillTrainingSpeed.js) | 47 | 49 | JavaScript with TypeScript counterpart |
| A | [server/src/services/skills/training/skillTrainingSpeed.ts](../../server/src/services/skills/training/skillTrainingSpeed.ts) | 49 | 0 | TypeScript counterpart |

## server/src/services/sovereignty

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/sovereignty/colonyResourcesMgrService.js](../../server/src/services/sovereignty/colonyResourcesMgrService.js) | 97 | 130 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/colonyResourcesMgrService.ts](../../server/src/services/sovereignty/colonyResourcesMgrService.ts) | 132 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/mercenaryDenState.js](../../server/src/services/sovereignty/mercenaryDenState.js) | 494 | 717 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/mercenaryDenState.ts](../../server/src/services/sovereignty/mercenaryDenState.ts) | 717 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovAnchorLayout.js](../../server/src/services/sovereignty/sovAnchorLayout.js) | 137 | 173 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovAnchorLayout.ts](../../server/src/services/sovereignty/sovAnchorLayout.ts) | 203 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovAutoCommands.js](../../server/src/services/sovereignty/sovAutoCommands.js) | 230 | 296 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovAutoCommands.ts](../../server/src/services/sovereignty/sovAutoCommands.ts) | 322 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovAutoNavigation.js](../../server/src/services/sovereignty/sovAutoNavigation.js) | 331 | 421 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovAutoNavigation.ts](../../server/src/services/sovereignty/sovAutoNavigation.ts) | 421 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovAutoState.js](../../server/src/services/sovereignty/sovAutoState.js) | 1189 | 1654 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovAutoState.ts](../../server/src/services/sovereignty/sovAutoState.ts) | 1654 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovChatCommands.js](../../server/src/services/sovereignty/sovChatCommands.js) | 511 | 663 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovChatCommands.ts](../../server/src/services/sovereignty/sovChatCommands.ts) | 663 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovConstants.js](../../server/src/services/sovereignty/sovConstants.js) | 45 | 46 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovConstants.ts](../../server/src/services/sovereignty/sovConstants.ts) | 46 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovFlexStructures.js](../../server/src/services/sovereignty/sovFlexStructures.js) | 462 | 621 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovFlexStructures.ts](../../server/src/services/sovereignty/sovFlexStructures.ts) | 621 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovGatewayProto.js](../../server/src/services/sovereignty/sovGatewayProto.js) | 113 | 271 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovGatewayProto.ts](../../server/src/services/sovereignty/sovGatewayProto.ts) | 288 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovGmState.js](../../server/src/services/sovereignty/sovGmState.js) | 757 | 986 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovGmState.ts](../../server/src/services/sovereignty/sovGmState.ts) | 1102 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovLog.js](../../server/src/services/sovereignty/sovLog.js) | 53 | 62 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovLog.ts](../../server/src/services/sovereignty/sovLog.ts) | 83 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovModernState.js](../../server/src/services/sovereignty/sovModernState.js) | 1478 | 1921 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovModernState.ts](../../server/src/services/sovereignty/sovModernState.ts) | 2084 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovNotifications.js](../../server/src/services/sovereignty/sovNotifications.js) | 186 | 296 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovNotifications.ts](../../server/src/services/sovereignty/sovNotifications.ts) | 296 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovPayloads.js](../../server/src/services/sovereignty/sovPayloads.js) | 123 | 172 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovPayloads.ts](../../server/src/services/sovereignty/sovPayloads.ts) | 223 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovPlayerDeployment.js](../../server/src/services/sovereignty/sovPlayerDeployment.js) | 828 | 1109 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovPlayerDeployment.ts](../../server/src/services/sovereignty/sovPlayerDeployment.ts) | 1130 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovSpaceInterop.js](../../server/src/services/sovereignty/sovSpaceInterop.js) | 239 | 304 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovSpaceInterop.ts](../../server/src/services/sovereignty/sovSpaceInterop.ts) | 351 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovState.js](../../server/src/services/sovereignty/sovState.js) | 1286 | 1800 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovState.ts](../../server/src/services/sovereignty/sovState.ts) | 1804 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovStaticAuthority.js](../../server/src/services/sovereignty/sovStaticAuthority.js) | 109 | 135 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovStaticAuthority.ts](../../server/src/services/sovereignty/sovStaticAuthority.ts) | 135 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovStaticData.js](../../server/src/services/sovereignty/sovStaticData.js) | 299 | 357 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovStaticData.ts](../../server/src/services/sovereignty/sovStaticData.ts) | 357 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovStore.js](../../server/src/services/sovereignty/sovStore.js) | 127 | 151 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovStore.ts](../../server/src/services/sovereignty/sovStore.ts) | 151 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovSuppressionState.js](../../server/src/services/sovereignty/sovSuppressionState.js) | 203 | 269 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovSuppressionState.ts](../../server/src/services/sovereignty/sovSuppressionState.ts) | 269 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovSystemRules.js](../../server/src/services/sovereignty/sovSystemRules.js) | 48 | 61 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovSystemRules.ts](../../server/src/services/sovereignty/sovSystemRules.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/services/sovereignty/sovUpgradeSupport.js](../../server/src/services/sovereignty/sovUpgradeSupport.js) | 65 | 87 | JavaScript with TypeScript counterpart |
| A | [server/src/services/sovereignty/sovUpgradeSupport.ts](../../server/src/services/sovereignty/sovUpgradeSupport.ts) | 116 | 0 | TypeScript counterpart |

## server/src/services/station

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/station/jumpCloneRules.js](../../server/src/services/station/jumpCloneRules.js) | 88 | 109 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/jumpCloneRules.ts](../../server/src/services/station/jumpCloneRules.ts) | 109 | 0 | TypeScript counterpart |
| M | [server/src/services/station/jumpCloneRuntime.js](../../server/src/services/station/jumpCloneRuntime.js) | 1217 | 1535 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/jumpCloneRuntime.ts](../../server/src/services/station/jumpCloneRuntime.ts) | 1535 | 0 | TypeScript counterpart |
| M | [server/src/services/station/jumpCloneService.js](../../server/src/services/station/jumpCloneService.js) | 93 | 126 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/jumpCloneService.ts](../../server/src/services/station/jumpCloneService.ts) | 126 | 0 | TypeScript counterpart |
| M | [server/src/services/station/repackagingService.js](../../server/src/services/station/repackagingService.js) | 11 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/repackagingService.ts](../../server/src/services/station/repackagingService.ts) | 24 | 0 | TypeScript counterpart |
| M | [server/src/services/station/repackagingSupport.js](../../server/src/services/station/repackagingSupport.js) | 141 | 224 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/repackagingSupport.ts](../../server/src/services/station/repackagingSupport.ts) | 228 | 0 | TypeScript counterpart |
| M | [server/src/services/station/repairRuntime.js](../../server/src/services/station/repairRuntime.js) | 791 | 1077 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/repairRuntime.ts](../../server/src/services/station/repairRuntime.ts) | 1077 | 0 | TypeScript counterpart |
| M | [server/src/services/station/repairService.js](../../server/src/services/station/repairService.js) | 154 | 224 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/repairService.ts](../../server/src/services/station/repairService.ts) | 244 | 0 | TypeScript counterpart |
| M | [server/src/services/station/reprocessingService.js](../../server/src/services/station/reprocessingService.js) | 518 | 708 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/reprocessingService.ts](../../server/src/services/station/reprocessingService.ts) | 759 | 0 | TypeScript counterpart |
| M | [server/src/services/station/stationLocatorGeometry.js](../../server/src/services/station/stationLocatorGeometry.js) | 341 | 443 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/stationLocatorGeometry.ts](../../server/src/services/station/stationLocatorGeometry.ts) | 451 | 0 | TypeScript counterpart |
| M | [server/src/services/station/stationService.js](../../server/src/services/station/stationService.js) | 187 | 239 | JavaScript with TypeScript counterpart |
| A | [server/src/services/station/stationService.ts](../../server/src/services/station/stationService.ts) | 239 | 0 | TypeScript counterpart |

## server/src/services/structure

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/structure/autoMoonMiningService.js](../../server/src/services/structure/autoMoonMiningService.js) | 327 | 474 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/autoMoonMiningService.ts](../../server/src/services/structure/autoMoonMiningService.ts) | 480 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/moonExtractionsService.js](../../server/src/services/structure/moonExtractionsService.js) | 826 | 1109 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/moonExtractionsService.ts](../../server/src/services/structure/moonExtractionsService.ts) | 1112 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureAssetSafetyService.js](../../server/src/services/structure/structureAssetSafetyService.js) | 234 | 316 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureAssetSafetyService.ts](../../server/src/services/structure/structureAssetSafetyService.ts) | 316 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureAssetSafetyState.js](../../server/src/services/structure/structureAssetSafetyState.js) | 1765 | 2397 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureAssetSafetyState.ts](../../server/src/services/structure/structureAssetSafetyState.ts) | 2397 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureAutoCommands.js](../../server/src/services/structure/structureAutoCommands.js) | 464 | 553 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureAutoCommands.ts](../../server/src/services/structure/structureAutoCommands.ts) | 641 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureAutoMoonFuelRuntime.js](../../server/src/services/structure/structureAutoMoonFuelRuntime.js) | 515 | 670 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureAutoMoonFuelRuntime.ts](../../server/src/services/structure/structureAutoMoonFuelRuntime.ts) | 670 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureAutoState.js](../../server/src/services/structure/structureAutoState.js) | 397 | 558 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureAutoState.ts](../../server/src/services/structure/structureAutoState.ts) | 621 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureCargoDeliveryService.js](../../server/src/services/structure/structureCargoDeliveryService.js) | 331 | 433 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureCargoDeliveryService.ts](../../server/src/services/structure/structureCargoDeliveryService.ts) | 433 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureChatCommands.js](../../server/src/services/structure/structureChatCommands.js) | 799 | 941 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureChatCommands.ts](../../server/src/services/structure/structureChatCommands.ts) | 941 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureConstants.js](../../server/src/services/structure/structureConstants.js) | 514 | 552 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureConstants.ts](../../server/src/services/structure/structureConstants.ts) | 552 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureControlService.js](../../server/src/services/structure/structureControlService.js) | 135 | 189 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureControlService.ts](../../server/src/services/structure/structureControlService.ts) | 189 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureControlState.js](../../server/src/services/structure/structureControlState.js) | 403 | 518 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureControlState.ts](../../server/src/services/structure/structureControlState.ts) | 522 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureCynoBeaconMgrService.js](../../server/src/services/structure/structureCynoBeaconMgrService.js) | 520 | 741 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureCynoBeaconMgrService.ts](../../server/src/services/structure/structureCynoBeaconMgrService.ts) | 741 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDeathTestRuntime.js](../../server/src/services/structure/structureDeathTestRuntime.js) | 533 | 667 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDeathTestRuntime.ts](../../server/src/services/structure/structureDeathTestRuntime.ts) | 667 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDeliveriesService.js](../../server/src/services/structure/structureDeliveriesService.js) | 160 | 222 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDeliveriesService.ts](../../server/src/services/structure/structureDeliveriesService.ts) | 222 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDeploymentPlacement.js](../../server/src/services/structure/structureDeploymentPlacement.js) | 417 | 501 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDeploymentPlacement.ts](../../server/src/services/structure/structureDeploymentPlacement.ts) | 501 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDeploymentService.js](../../server/src/services/structure/structureDeploymentService.js) | 52 | 64 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDeploymentService.ts](../../server/src/services/structure/structureDeploymentService.ts) | 64 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDestructionLootState.js](../../server/src/services/structure/structureDestructionLootState.js) | 254 | 314 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDestructionLootState.ts](../../server/src/services/structure/structureDestructionLootState.ts) | 314 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDirectoryService.js](../../server/src/services/structure/structureDirectoryService.js) | 455 | 646 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDirectoryService.ts](../../server/src/services/structure/structureDirectoryService.ts) | 649 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDockedRecoveryState.js](../../server/src/services/structure/structureDockedRecoveryState.js) | 139 | 175 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDockedRecoveryState.ts](../../server/src/services/structure/structureDockedRecoveryState.ts) | 175 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureDockingService.js](../../server/src/services/structure/structureDockingService.js) | 155 | 205 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureDockingService.ts](../../server/src/services/structure/structureDockingService.ts) | 216 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureFlexFuelRuntime.js](../../server/src/services/structure/structureFlexFuelRuntime.js) | 731 | 921 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureFlexFuelRuntime.ts](../../server/src/services/structure/structureFlexFuelRuntime.ts) | 921 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureFullPowerDogma.js](../../server/src/services/structure/structureFullPowerDogma.js) | 128 | 202 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureFullPowerDogma.ts](../../server/src/services/structure/structureFullPowerDogma.ts) | 234 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureGuestsService.js](../../server/src/services/structure/structureGuestsService.js) | 28 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureGuestsService.ts](../../server/src/services/structure/structureGuestsService.ts) | 51 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureHangarViewManagerService.js](../../server/src/services/structure/structureHangarViewManagerService.js) | 25 | 39 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureHangarViewManagerService.ts](../../server/src/services/structure/structureHangarViewManagerService.ts) | 51 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureHangarViewState.js](../../server/src/services/structure/structureHangarViewState.js) | 111 | 154 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureHangarViewState.ts](../../server/src/services/structure/structureHangarViewState.ts) | 176 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureIndustryJobs.js](../../server/src/services/structure/structureIndustryJobs.js) | 117 | 164 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureIndustryJobs.ts](../../server/src/services/structure/structureIndustryJobs.ts) | 164 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureJumpBridgeMgrService.js](../../server/src/services/structure/structureJumpBridgeMgrService.js) | 578 | 775 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureJumpBridgeMgrService.ts](../../server/src/services/structure/structureJumpBridgeMgrService.ts) | 775 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureLocation.js](../../server/src/services/structure/structureLocation.js) | 36 | 49 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureLocation.ts](../../server/src/services/structure/structureLocation.ts) | 67 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureLocatorGeometry.js](../../server/src/services/structure/structureLocatorGeometry.js) | 341 | 441 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureLocatorGeometry.ts](../../server/src/services/structure/structureLocatorGeometry.ts) | 441 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureLog.js](../../server/src/services/structure/structureLog.js) | 53 | 62 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureLog.ts](../../server/src/services/structure/structureLog.ts) | 83 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structurePaintworkState.js](../../server/src/services/structure/structurePaintworkState.js) | 737 | 981 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structurePaintworkState.ts](../../server/src/services/structure/structurePaintworkState.ts) | 980 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structurePayloads.js](../../server/src/services/structure/structurePayloads.js) | 256 | 352 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structurePayloads.ts](../../server/src/services/structure/structurePayloads.ts) | 362 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureProfilesService.js](../../server/src/services/structure/structureProfilesService.js) | 206 | 297 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureProfilesService.ts](../../server/src/services/structure/structureProfilesService.ts) | 297 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureProfilesState.js](../../server/src/services/structure/structureProfilesState.js) | 900 | 1098 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureProfilesState.ts](../../server/src/services/structure/structureProfilesState.ts) | 1098 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureService.js](../../server/src/services/structure/structureService.js) | 258 | 367 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureService.ts](../../server/src/services/structure/structureService.ts) | 367 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureServiceAuthority.js](../../server/src/services/structure/structureServiceAuthority.js) | 531 | 615 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureServiceAuthority.ts](../../server/src/services/structure/structureServiceAuthority.ts) | 615 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureServiceModules.js](../../server/src/services/structure/structureServiceModules.js) | 715 | 926 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureServiceModules.ts](../../server/src/services/structure/structureServiceModules.ts) | 926 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureServiceOnlineRequirements.js](../../server/src/services/structure/structureServiceOnlineRequirements.js) | 75 | 95 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureServiceOnlineRequirements.ts](../../server/src/services/structure/structureServiceOnlineRequirements.ts) | 95 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureServiceProximity.js](../../server/src/services/structure/structureServiceProximity.js) | 134 | 165 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureServiceProximity.ts](../../server/src/services/structure/structureServiceProximity.ts) | 165 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureSettingsService.js](../../server/src/services/structure/structureSettingsService.js) | 64 | 88 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureSettingsService.ts](../../server/src/services/structure/structureSettingsService.ts) | 88 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureSpaceInterop.js](../../server/src/services/structure/structureSpaceInterop.js) | 79 | 100 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureSpaceInterop.ts](../../server/src/services/structure/structureSpaceInterop.ts) | 124 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureState.js](../../server/src/services/structure/structureState.js) | 3089 | 3849 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureState.ts](../../server/src/services/structure/structureState.ts) | 3849 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureTetherRestrictionState.js](../../server/src/services/structure/structureTetherRestrictionState.js) | 279 | 341 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureTetherRestrictionState.ts](../../server/src/services/structure/structureTetherRestrictionState.ts) | 341 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureVulnerabilityService.js](../../server/src/services/structure/structureVulnerabilityService.js) | 192 | 262 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureVulnerabilityService.ts](../../server/src/services/structure/structureVulnerabilityService.ts) | 262 | 0 | TypeScript counterpart |
| M | [server/src/services/structure/structureWreckState.js](../../server/src/services/structure/structureWreckState.js) | 218 | 267 | JavaScript with TypeScript counterpart |
| A | [server/src/services/structure/structureWreckState.ts](../../server/src/services/structure/structureWreckState.ts) | 267 | 0 | TypeScript counterpart |

## server/src/services/subscription

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/subscription/subscriptionMgrService.js](../../server/src/services/subscription/subscriptionMgrService.js) | 98 | 128 | JavaScript with TypeScript counterpart |
| A | [server/src/services/subscription/subscriptionMgrService.ts](../../server/src/services/subscription/subscriptionMgrService.ts) | 150 | 0 | TypeScript counterpart |

## server/src/services/superweapons

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/superweapons/npc/npcTitanSuperweaponRuntime.js](../../server/src/services/superweapons/npc/npcTitanSuperweaponRuntime.js) | 59 | 92 | JavaScript with TypeScript counterpart |
| A | [server/src/services/superweapons/npc/npcTitanSuperweaponRuntime.ts](../../server/src/services/superweapons/npc/npcTitanSuperweaponRuntime.ts) | 103 | 0 | TypeScript counterpart |
| M | [server/src/services/superweapons/superweaponCatalog.js](../../server/src/services/superweapons/superweaponCatalog.js) | 133 | 157 | JavaScript with TypeScript counterpart |
| A | [server/src/services/superweapons/superweaponCatalog.ts](../../server/src/services/superweapons/superweaponCatalog.ts) | 181 | 0 | TypeScript counterpart |
| M | [server/src/services/superweapons/superweaponCommands.js](../../server/src/services/superweapons/superweaponCommands.js) | 582 | 871 | JavaScript with TypeScript counterpart |
| A | [server/src/services/superweapons/superweaponCommands.ts](../../server/src/services/superweapons/superweaponCommands.ts) | 871 | 0 | TypeScript counterpart |

## server/src/services/support

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/support/bannedwordsService.js](../../server/src/services/support/bannedwordsService.js) | 135 | 167 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/bannedwordsService.ts](../../server/src/services/support/bannedwordsService.ts) | 167 | 0 | TypeScript counterpart |
| M | [server/src/services/support/eveguardReportService.js](../../server/src/services/support/eveguardReportService.js) | 45 | 53 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/eveguardReportService.ts](../../server/src/services/support/eveguardReportService.ts) | 53 | 0 | TypeScript counterpart |
| M | [server/src/services/support/infoGatheringMgrService.js](../../server/src/services/support/infoGatheringMgrService.js) | 59 | 67 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/infoGatheringMgrService.ts](../../server/src/services/support/infoGatheringMgrService.ts) | 67 | 0 | TypeScript counterpart |
| M | [server/src/services/support/ingamereportService.js](../../server/src/services/support/ingamereportService.js) | 104 | 131 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/ingamereportService.ts](../../server/src/services/support/ingamereportService.ts) | 131 | 0 | TypeScript counterpart |
| M | [server/src/services/support/loadServiceService.js](../../server/src/services/support/loadServiceService.js) | 94 | 109 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/loadServiceService.ts](../../server/src/services/support/loadServiceService.ts) | 109 | 0 | TypeScript counterpart |
| M | [server/src/services/support/localizationServerService.js](../../server/src/services/support/localizationServerService.js) | 59 | 65 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/localizationServerService.ts](../../server/src/services/support/localizationServerService.ts) | 65 | 0 | TypeScript counterpart |
| M | [server/src/services/support/petitionerService.js](../../server/src/services/support/petitionerService.js) | 256 | 311 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/petitionerService.ts](../../server/src/services/support/petitionerService.ts) | 311 | 0 | TypeScript counterpart |
| M | [server/src/services/support/publicQaToolsServerService.js](../../server/src/services/support/publicQaToolsServerService.js) | 57 | 66 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/publicQaToolsServerService.ts](../../server/src/services/support/publicQaToolsServerService.ts) | 66 | 0 | TypeScript counterpart |
| M | [server/src/services/support/serviceGatewayMgrService.js](../../server/src/services/support/serviceGatewayMgrService.js) | 56 | 64 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/serviceGatewayMgrService.ts](../../server/src/services/support/serviceGatewayMgrService.ts) | 64 | 0 | TypeScript counterpart |
| M | [server/src/services/support/surveyService.js](../../server/src/services/support/surveyService.js) | 66 | 76 | JavaScript with TypeScript counterpart |
| A | [server/src/services/support/surveyService.ts](../../server/src/services/support/surveyService.ts) | 76 | 0 | TypeScript counterpart |

## server/src/services/tale

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/tale/observedTaleData.js](../../server/src/services/tale/observedTaleData.js) | 63 | 81 | JavaScript with TypeScript counterpart |
| A | [server/src/services/tale/observedTaleData.ts](../../server/src/services/tale/observedTaleData.ts) | 81 | 0 | TypeScript counterpart |
| M | [server/src/services/tale/taleMgrService.js](../../server/src/services/tale/taleMgrService.js) | 84 | 112 | JavaScript with TypeScript counterpart |
| A | [server/src/services/tale/taleMgrService.ts](../../server/src/services/tale/taleMgrService.ts) | 112 | 0 | TypeScript counterpart |

## server/src/services/tournament

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/tournament/tourneyMgrService.js](../../server/src/services/tournament/tourneyMgrService.js) | 122 | 149 | JavaScript with TypeScript counterpart |
| A | [server/src/services/tournament/tourneyMgrService.ts](../../server/src/services/tournament/tourneyMgrService.ts) | 149 | 0 | TypeScript counterpart |

## server/src/services/trade

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/trade/tradeMgrService.js](../../server/src/services/trade/tradeMgrService.js) | 1246 | 1530 | JavaScript with TypeScript counterpart |
| A | [server/src/services/trade/tradeMgrService.ts](../../server/src/services/trade/tradeMgrService.ts) | 1627 | 0 | TypeScript counterpart |

## server/src/services/user

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/services/user/userService.js](../../server/src/services/user/userService.js) | 909 | 1099 | JavaScript with TypeScript counterpart |
| A | [server/src/services/user/userService.ts](../../server/src/services/user/userService.ts) | 1099 | 0 | TypeScript counterpart |

## server/src/space/asteroids

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/asteroids/asteroidData.js](../../server/src/space/asteroids/asteroidData.js) | 68 | 64 | JavaScript with TypeScript counterpart |
| A | [server/src/space/asteroids/asteroidData.ts](../../server/src/space/asteroids/asteroidData.ts) | 115 | 0 | TypeScript counterpart |
| M | [server/src/space/asteroids/asteroidService.js](../../server/src/space/asteroids/asteroidService.js) | 1064 | 1214 | JavaScript with TypeScript counterpart |
| A | [server/src/space/asteroids/asteroidService.ts](../../server/src/space/asteroids/asteroidService.ts) | 1575 | 0 | TypeScript counterpart |
| M | [server/src/space/asteroids/frontierResourceFields.js](../../server/src/space/asteroids/frontierResourceFields.js) | 132 | 132 | JavaScript with TypeScript counterpart |
| A | [server/src/space/asteroids/frontierResourceFields.ts](../../server/src/space/asteroids/frontierResourceFields.ts) | 169 | 0 | TypeScript counterpart |
| M | [server/src/space/asteroids/index.js](../../server/src/space/asteroids/index.js) | 3 | 0 | JavaScript with TypeScript counterpart |
| A | [server/src/space/asteroids/index.ts](../../server/src/space/asteroids/index.ts) | 1 | 0 | TypeScript counterpart |

## server/src/space/authoredSpaceProps.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/authoredSpaceProps.js](../../server/src/space/authoredSpaceProps.js) | 436 | 504 | JavaScript with TypeScript counterpart |

## server/src/space/authoredSpaceProps.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/authoredSpaceProps.ts](../../server/src/space/authoredSpaceProps.ts) | 522 | 0 | TypeScript counterpart |

## server/src/space/combat

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/combat/damage.js](../../server/src/space/combat/damage.js) | 300 | 444 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/damage.ts](../../server/src/space/combat/damage.ts) | 444 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/killmailTracker.js](../../server/src/space/combat/killmailTracker.js) | 695 | 937 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/killmailTracker.ts](../../server/src/space/combat/killmailTracker.ts) | 937 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/laserTurrets.js](../../server/src/space/combat/laserTurrets.js) | 102 | 149 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/laserTurrets.ts](../../server/src/space/combat/laserTurrets.ts) | 176 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/missiles/missileReloads.js](../../server/src/space/combat/missiles/missileReloads.js) | 287 | 331 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/missiles/missileReloads.ts](../../server/src/space/combat/missiles/missileReloads.ts) | 371 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/missiles/missileSolver.js](../../server/src/space/combat/missiles/missileSolver.js) | 125 | 229 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/missiles/missileSolver.ts](../../server/src/space/combat/missiles/missileSolver.ts) | 259 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/precursorTurrets.js](../../server/src/space/combat/precursorTurrets.js) | 135 | 220 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/precursorTurrets.ts](../../server/src/space/combat/precursorTurrets.ts) | 261 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/vortonProjectors.js](../../server/src/space/combat/vortonProjectors.js) | 171 | 234 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/vortonProjectors.ts](../../server/src/space/combat/vortonProjectors.ts) | 234 | 0 | TypeScript counterpart |
| M | [server/src/space/combat/weaponDogma.js](../../server/src/space/combat/weaponDogma.js) | 977 | 1490 | JavaScript with TypeScript counterpart |
| A | [server/src/space/combat/weaponDogma.ts](../../server/src/space/combat/weaponDogma.ts) | 1507 | 0 | TypeScript counterpart |

## server/src/space/defaultEmpireScenery.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/defaultEmpireScenery.js](../../server/src/space/defaultEmpireScenery.js) | 383 | 511 | JavaScript with TypeScript counterpart |

## server/src/space/defaultEmpireScenery.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/defaultEmpireScenery.ts](../../server/src/space/defaultEmpireScenery.ts) | 513 | 0 | TypeScript counterpart |

## server/src/space/destiny

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/destiny/authority/destinyAuthority.js](../../server/src/space/destiny/authority/destinyAuthority.js) | 1557 | 2396 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/authority/destinyAuthority.ts](../../server/src/space/destiny/authority/destinyAuthority.ts) | 2396 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/authority/destinyContracts.js](../../server/src/space/destiny/authority/destinyContracts.js) | 123 | 169 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/authority/destinyContracts.ts](../../server/src/space/destiny/authority/destinyContracts.ts) | 169 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/authority/destinyJourneyLog.js](../../server/src/space/destiny/authority/destinyJourneyLog.js) | 141 | 192 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/authority/destinyJourneyLog.ts](../../server/src/space/destiny/authority/destinyJourneyLog.ts) | 192 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/authority/destinySessionState.js](../../server/src/space/destiny/authority/destinySessionState.js) | 636 | 878 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/authority/destinySessionState.ts](../../server/src/space/destiny/authority/destinySessionState.ts) | 878 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/batching/packagedAction.js](../../server/src/space/destiny/batching/packagedAction.js) | 109 | 137 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/batching/packagedAction.ts](../../server/src/space/destiny/batching/packagedAction.ts) | 137 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/batching/parkUpdateBatcher.js](../../server/src/space/destiny/batching/parkUpdateBatcher.js) | 577 | 695 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/batching/parkUpdateBatcher.ts](../../server/src/space/destiny/batching/parkUpdateBatcher.ts) | 695 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/batching/systemHistory.js](../../server/src/space/destiny/batching/systemHistory.js) | 41 | 50 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/batching/systemHistory.ts](../../server/src/space/destiny/batching/systemHistory.ts) | 50 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/bootstrap/initialBallpark.js](../../server/src/space/destiny/bootstrap/initialBallpark.js) | 81 | 110 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/bootstrap/initialBallpark.ts](../../server/src/space/destiny/bootstrap/initialBallpark.ts) | 110 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/bootstrap/staticBootstrap.js](../../server/src/space/destiny/bootstrap/staticBootstrap.js) | 39 | 47 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/bootstrap/staticBootstrap.ts](../../server/src/space/destiny/bootstrap/staticBootstrap.ts) | 47 | 0 | TypeScript counterpart |
| A | [server/src/space/destiny/collision/collisionBundle.ts](../../server/src/space/destiny/collision/collisionBundle.ts) | 569 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/destiny/commands/docking.js](../../server/src/space/destiny/commands/docking.js) | 9 | 7 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/docking.ts](../../server/src/space/destiny/commands/docking.ts) | 7 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/drone.js](../../server/src/space/destiny/commands/drone.js) | 30 | 39 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/drone.ts](../../server/src/space/destiny/commands/drone.ts) | 39 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/fighter.js](../../server/src/space/destiny/commands/fighter.js) | 119 | 167 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/fighter.ts](../../server/src/space/destiny/commands/fighter.ts) | 167 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/manualFlightCommands.js](../../server/src/space/destiny/commands/manualFlightCommands.js) | 101 | 175 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/manualFlightCommands.ts](../../server/src/space/destiny/commands/manualFlightCommands.ts) | 175 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/mining.js](../../server/src/space/destiny/commands/mining.js) | 9 | 7 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/mining.ts](../../server/src/space/destiny/commands/mining.ts) | 7 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/missile.js](../../server/src/space/destiny/commands/missile.js) | 31 | 38 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/missile.ts](../../server/src/space/destiny/commands/missile.ts) | 38 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/mobileTractorUnit.js](../../server/src/space/destiny/commands/mobileTractorUnit.js) | 52 | 71 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/mobileTractorUnit.ts](../../server/src/space/destiny/commands/mobileTractorUnit.ts) | 71 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/npc.js](../../server/src/space/destiny/commands/npc.js) | 9 | 7 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/npc.ts](../../server/src/space/destiny/commands/npc.ts) | 7 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/npcWarpCompletion.js](../../server/src/space/destiny/commands/npcWarpCompletion.js) | 9 | 7 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/npcWarpCompletion.ts](../../server/src/space/destiny/commands/npcWarpCompletion.ts) | 7 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/probe.js](../../server/src/space/destiny/commands/probe.js) | 14 | 23 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/probe.ts](../../server/src/space/destiny/commands/probe.ts) | 23 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/shipDerivedMotion.js](../../server/src/space/destiny/commands/shipDerivedMotion.js) | 31 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/shipDerivedMotion.ts](../../server/src/space/destiny/commands/shipDerivedMotion.ts) | 51 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/stopSpeedCommands.js](../../server/src/space/destiny/commands/stopSpeedCommands.js) | 148 | 248 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/stopSpeedCommands.ts](../../server/src/space/destiny/commands/stopSpeedCommands.ts) | 248 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/subwarpCommands.js](../../server/src/space/destiny/commands/subwarpCommands.js) | 445 | 674 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/subwarpCommands.ts](../../server/src/space/destiny/commands/subwarpCommands.ts) | 684 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/superweapon.js](../../server/src/space/destiny/commands/superweapon.js) | 18 | 31 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/superweapon.ts](../../server/src/space/destiny/commands/superweapon.ts) | 31 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/teleport.js](../../server/src/space/destiny/commands/teleport.js) | 14 | 24 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/teleport.ts](../../server/src/space/destiny/commands/teleport.ts) | 24 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/tractorBeam.js](../../server/src/space/destiny/commands/tractorBeam.js) | 224 | 285 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/tractorBeam.ts](../../server/src/space/destiny/commands/tractorBeam.ts) | 285 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/warpCommands.js](../../server/src/space/destiny/commands/warpCommands.js) | 983 | 1210 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/warpCommands.ts](../../server/src/space/destiny/commands/warpCommands.ts) | 1463 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/commands/warpTick.js](../../server/src/space/destiny/commands/warpTick.js) | 14 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/commands/warpTick.ts](../../server/src/space/destiny/commands/warpTick.ts) | 19 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/constants.js](../../server/src/space/destiny/constants.js) | 56 | 58 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/constants.ts](../../server/src/space/destiny/constants.ts) | 58 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/coordinateFrame.js](../../server/src/space/destiny/delivery/coordinateFrame.js) | 70 | 80 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/coordinateFrame.ts](../../server/src/space/destiny/delivery/coordinateFrame.ts) | 80 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/deliveryPolicy.js](../../server/src/space/destiny/delivery/deliveryPolicy.js) | 1757 | 2835 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/deliveryPolicy.ts](../../server/src/space/destiny/delivery/deliveryPolicy.ts) | 2835 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/deliveryTransaction.js](../../server/src/space/destiny/delivery/deliveryTransaction.js) | 345 | 386 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/deliveryTransaction.ts](../../server/src/space/destiny/delivery/deliveryTransaction.ts) | 386 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/explodingDestructionStamp.js](../../server/src/space/destiny/delivery/explodingDestructionStamp.js) | 32 | 69 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/explodingDestructionStamp.ts](../../server/src/space/destiny/delivery/explodingDestructionStamp.ts) | 69 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/fallbackStampAllocator.js](../../server/src/space/destiny/delivery/fallbackStampAllocator.js) | 31 | 41 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/fallbackStampAllocator.ts](../../server/src/space/destiny/delivery/fallbackStampAllocator.ts) | 41 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/michelleContract.js](../../server/src/space/destiny/delivery/michelleContract.js) | 84 | 98 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/michelleContract.ts](../../server/src/space/destiny/delivery/michelleContract.ts) | 98 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/removeBallsSessionStamp.js](../../server/src/space/destiny/delivery/removeBallsSessionStamp.js) | 20 | 43 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/removeBallsSessionStamp.ts](../../server/src/space/destiny/delivery/removeBallsSessionStamp.ts) | 43 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sameSceneShipHandoff.js](../../server/src/space/destiny/delivery/sameSceneShipHandoff.js) | 533 | 769 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sameSceneShipHandoff.ts](../../server/src/space/destiny/delivery/sameSceneShipHandoff.ts) | 769 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sendOptions.js](../../server/src/space/destiny/delivery/sendOptions.js) | 223 | 367 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sendOptions.ts](../../server/src/space/destiny/delivery/sendOptions.ts) | 367 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sessionAlignedStamp.js](../../server/src/space/destiny/delivery/sessionAlignedStamp.js) | 14 | 16 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sessionAlignedStamp.ts](../../server/src/space/destiny/delivery/sessionAlignedStamp.ts) | 16 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sessionOrigin.js](../../server/src/space/destiny/delivery/sessionOrigin.js) | 18 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sessionOrigin.ts](../../server/src/space/destiny/delivery/sessionOrigin.ts) | 19 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sessionStamps.js](../../server/src/space/destiny/delivery/sessionStamps.js) | 187 | 319 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sessionStamps.ts](../../server/src/space/destiny/delivery/sessionStamps.ts) | 319 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sessionWindows.js](../../server/src/space/destiny/delivery/sessionWindows.js) | 51 | 94 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sessionWindows.ts](../../server/src/space/destiny/delivery/sessionWindows.ts) | 94 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/stamps.js](../../server/src/space/destiny/delivery/stamps.js) | 235 | 341 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/stamps.ts](../../server/src/space/destiny/delivery/stamps.ts) | 341 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/sync.js](../../server/src/space/destiny/delivery/sync.js) | 108 | 186 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/sync.ts](../../server/src/space/destiny/delivery/sync.ts) | 186 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/delivery/transitionStamps.js](../../server/src/space/destiny/delivery/transitionStamps.js) | 112 | 158 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/delivery/transitionStamps.ts](../../server/src/space/destiny/delivery/transitionStamps.ts) | 158 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/contractDispatch.js](../../server/src/space/destiny/dispatch/contractDispatch.js) | 474 | 746 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/contractDispatch.ts](../../server/src/space/destiny/dispatch/contractDispatch.ts) | 746 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/destinyDispatch.js](../../server/src/space/destiny/dispatch/destinyDispatch.js) | 2515 | 3655 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/destinyDispatch.ts](../../server/src/space/destiny/dispatch/destinyDispatch.ts) | 3655 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/dispatchUtils.js](../../server/src/space/destiny/dispatch/dispatchUtils.js) | 66 | 86 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/dispatchUtils.ts](../../server/src/space/destiny/dispatch/dispatchUtils.ts) | 86 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/ownerDispatch.js](../../server/src/space/destiny/dispatch/ownerDispatch.js) | 392 | 615 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/ownerDispatch.ts](../../server/src/space/destiny/dispatch/ownerDispatch.ts) | 615 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/sceneRefresh.js](../../server/src/space/destiny/dispatch/sceneRefresh.js) | 196 | 295 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/sceneRefresh.ts](../../server/src/space/destiny/dispatch/sceneRefresh.ts) | 336 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/ticker.js](../../server/src/space/destiny/dispatch/ticker.js) | 28 | 30 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/ticker.ts](../../server/src/space/destiny/dispatch/ticker.ts) | 30 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/dispatch/watcherCorrections.js](../../server/src/space/destiny/dispatch/watcherCorrections.js) | 171 | 210 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/dispatch/watcherCorrections.ts](../../server/src/space/destiny/dispatch/watcherCorrections.ts) | 210 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/identity/entityID.js](../../server/src/space/destiny/identity/entityID.js) | 208 | 227 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/identity/entityID.ts](../../server/src/space/destiny/identity/entityID.ts) | 227 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/identity/interactionScope.js](../../server/src/space/destiny/identity/interactionScope.js) | 365 | 477 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/identity/interactionScope.ts](../../server/src/space/destiny/identity/interactionScope.ts) | 477 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/index.js](../../server/src/space/destiny/index.js) | 778 | 900 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/index.ts](../../server/src/space/destiny/index.ts) | 944 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/activeSpecialFxReplay.js](../../server/src/space/destiny/presentation/activeSpecialFxReplay.js) | 219 | 305 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/activeSpecialFxReplay.ts](../../server/src/space/destiny/presentation/activeSpecialFxReplay.ts) | 305 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/addBalls.js](../../server/src/space/destiny/presentation/addBalls.js) | 218 | 324 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/addBalls.ts](../../server/src/space/destiny/presentation/addBalls.ts) | 324 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/addBallsTimeline.js](../../server/src/space/destiny/presentation/addBallsTimeline.js) | 213 | 383 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/addBallsTimeline.ts](../../server/src/space/destiny/presentation/addBallsTimeline.ts) | 383 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/freshAcquire.js](../../server/src/space/destiny/presentation/freshAcquire.js) | 74 | 118 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/freshAcquire.ts](../../server/src/space/destiny/presentation/freshAcquire.ts) | 118 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/mode.js](../../server/src/space/destiny/presentation/mode.js) | 208 | 296 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/mode.ts](../../server/src/space/destiny/presentation/mode.ts) | 296 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/removeBalls.js](../../server/src/space/destiny/presentation/removeBalls.js) | 60 | 83 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/removeBalls.ts](../../server/src/space/destiny/presentation/removeBalls.ts) | 83 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/shipBoarding.js](../../server/src/space/destiny/presentation/shipBoarding.js) | 178 | 283 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/shipBoarding.ts](../../server/src/space/destiny/presentation/shipBoarding.ts) | 326 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/shipPrime.js](../../server/src/space/destiny/presentation/shipPrime.js) | 189 | 253 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/shipPrime.ts](../../server/src/space/destiny/presentation/shipPrime.ts) | 253 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/siteEnvironment.js](../../server/src/space/destiny/presentation/siteEnvironment.js) | 134 | 172 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/siteEnvironment.ts](../../server/src/space/destiny/presentation/siteEnvironment.ts) | 172 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/presentation/specialFxPayloads.js](../../server/src/space/destiny/presentation/specialFxPayloads.js) | 215 | 377 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/presentation/specialFxPayloads.ts](../../server/src/space/destiny/presentation/specialFxPayloads.ts) | 417 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/projection/entityProjection.js](../../server/src/space/destiny/projection/entityProjection.js) | 282 | 402 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/projection/entityProjection.ts](../../server/src/space/destiny/projection/entityProjection.ts) | 402 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/projection/kinematics.js](../../server/src/space/destiny/projection/kinematics.js) | 425 | 595 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/projection/kinematics.ts](../../server/src/space/destiny/projection/kinematics.ts) | 595 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/projection/range.js](../../server/src/space/destiny/projection/range.js) | 197 | 283 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/projection/range.ts](../../server/src/space/destiny/projection/range.ts) | 283 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/protocol/direction.js](../../server/src/space/destiny/protocol/direction.js) | 219 | 249 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/protocol/direction.ts](../../server/src/space/destiny/protocol/direction.ts) | 251 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/protocol/payloadIdentity.js](../../server/src/space/destiny/protocol/payloadIdentity.js) | 184 | 215 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/protocol/payloadIdentity.ts](../../server/src/space/destiny/protocol/payloadIdentity.ts) | 216 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/protocol/payloadSummary.js](../../server/src/space/destiny/protocol/payloadSummary.js) | 493 | 557 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/protocol/payloadSummary.ts](../../server/src/space/destiny/protocol/payloadSummary.ts) | 557 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/protocol/payloads.js](../../server/src/space/destiny/protocol/payloads.js) | 218 | 237 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/protocol/payloads.ts](../../server/src/space/destiny/protocol/payloads.ts) | 239 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/activeWarpTick.js](../../server/src/space/destiny/simulation/activeWarpTick.js) | 77 | 97 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/activeWarpTick.ts](../../server/src/space/destiny/simulation/activeWarpTick.ts) | 97 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/carbonIntegration.js](../../server/src/space/destiny/simulation/carbonIntegration.js) | 91 | 153 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/carbonIntegration.ts](../../server/src/space/destiny/simulation/carbonIntegration.ts) | 153 | 0 | TypeScript counterpart |
| A | [server/src/space/destiny/simulation/collisionImpact.ts](../../server/src/space/destiny/simulation/collisionImpact.ts) | 240 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/destiny/simulation/collisions.ts](../../server/src/space/destiny/simulation/collisions.ts) | 1399 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/destiny/simulation/massDynamics.ts](../../server/src/space/destiny/simulation/massDynamics.ts) | 75 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/destiny/simulation/motionState.js](../../server/src/space/destiny/simulation/motionState.js) | 114 | 146 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/motionState.ts](../../server/src/space/destiny/simulation/motionState.ts) | 146 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/movement.js](../../server/src/space/destiny/simulation/movement.js) | 966 | 1560 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/movement.ts](../../server/src/space/destiny/simulation/movement.ts) | 1558 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/nativeSubwarp.js](../../server/src/space/destiny/simulation/nativeSubwarp.js) | 1458 | 1872 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/nativeSubwarp.ts](../../server/src/space/destiny/simulation/nativeSubwarp.ts) | 1872 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/pilotWarpPhase.js](../../server/src/space/destiny/simulation/pilotWarpPhase.js) | 123 | 178 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/pilotWarpPhase.ts](../../server/src/space/destiny/simulation/pilotWarpPhase.ts) | 178 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warp.js](../../server/src/space/destiny/simulation/warp.js) | 65 | 110 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warp.ts](../../server/src/space/destiny/simulation/warp.ts) | 110 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpBuilders.js](../../server/src/space/destiny/simulation/warpBuilders.js) | 493 | 756 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpBuilders.ts](../../server/src/space/destiny/simulation/warpBuilders.ts) | 760 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpContract.js](../../server/src/space/destiny/simulation/warpContract.js) | 25 | 24 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpContract.ts](../../server/src/space/destiny/simulation/warpContract.ts) | 24 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpDiagnostics.js](../../server/src/space/destiny/simulation/warpDiagnostics.js) | 169 | 280 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpDiagnostics.ts](../../server/src/space/destiny/simulation/warpDiagnostics.ts) | 280 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpInPointParity.js](../../server/src/space/destiny/simulation/warpInPointParity.js) | 210 | 244 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpInPointParity.ts](../../server/src/space/destiny/simulation/warpInPointParity.ts) | 286 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpNativeBoundary.js](../../server/src/space/destiny/simulation/warpNativeBoundary.js) | 63 | 90 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpNativeBoundary.ts](../../server/src/space/destiny/simulation/warpNativeBoundary.ts) | 90 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpPhase.js](../../server/src/space/destiny/simulation/warpPhase.js) | 15 | 19 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpPhase.ts](../../server/src/space/destiny/simulation/warpPhase.ts) | 19 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpRamp.js](../../server/src/space/destiny/simulation/warpRamp.js) | 22 | 26 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpRamp.ts](../../server/src/space/destiny/simulation/warpRamp.ts) | 26 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpSerialization.js](../../server/src/space/destiny/simulation/warpSerialization.js) | 143 | 222 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpSerialization.ts](../../server/src/space/destiny/simulation/warpSerialization.ts) | 222 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpState.js](../../server/src/space/destiny/simulation/warpState.js) | 631 | 923 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpState.ts](../../server/src/space/destiny/simulation/warpState.ts) | 953 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/simulation/warpTargets.js](../../server/src/space/destiny/simulation/warpTargets.js) | 152 | 235 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/simulation/warpTargets.ts](../../server/src/space/destiny/simulation/warpTargets.ts) | 251 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/actions.js](../../server/src/space/destiny/stream/actions.js) | 339 | 441 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/actions.ts](../../server/src/space/destiny/stream/actions.ts) | 446 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/ballConfig.js](../../server/src/space/destiny/stream/ballConfig.js) | 56 | 67 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/ballConfig.ts](../../server/src/space/destiny/stream/ballConfig.ts) | 67 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/ballEncoding.js](../../server/src/space/destiny/stream/ballEncoding.js) | 814 | 927 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/ballEncoding.ts](../../server/src/space/destiny/stream/ballEncoding.ts) | 1019 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/freeBallHeader.js](../../server/src/space/destiny/stream/freeBallHeader.js) | 62 | 78 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/freeBallHeader.ts](../../server/src/space/destiny/stream/freeBallHeader.ts) | 78 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/primitives.js](../../server/src/space/destiny/stream/primitives.js) | 144 | 166 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/primitives.ts](../../server/src/space/destiny/stream/primitives.ts) | 166 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/statePayloadCompatibility.js](../../server/src/space/destiny/stream/statePayloadCompatibility.js) | 182 | 210 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/statePayloadCompatibility.ts](../../server/src/space/destiny/stream/statePayloadCompatibility.ts) | 265 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/statePayloads.js](../../server/src/space/destiny/stream/statePayloads.js) | 355 | 466 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/statePayloads.ts](../../server/src/space/destiny/stream/statePayloads.ts) | 487 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/stream/staticBallTail.js](../../server/src/space/destiny/stream/staticBallTail.js) | 237 | 271 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/stream/staticBallTail.ts](../../server/src/space/destiny/stream/staticBallTail.ts) | 290 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/acquisition.js](../../server/src/space/destiny/visibility/acquisition.js) | 431 | 526 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/acquisition.ts](../../server/src/space/destiny/visibility/acquisition.ts) | 526 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/bubbleUpdater.js](../../server/src/space/destiny/visibility/bubbleUpdater.js) | 112 | 122 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/bubbleUpdater.ts](../../server/src/space/destiny/visibility/bubbleUpdater.ts) | 122 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/constants.js](../../server/src/space/destiny/visibility/constants.js) | 35 | 39 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/constants.ts](../../server/src/space/destiny/visibility/constants.ts) | 39 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/controlState.js](../../server/src/space/destiny/visibility/controlState.js) | 633 | 798 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/controlState.ts](../../server/src/space/destiny/visibility/controlState.ts) | 798 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/delta.js](../../server/src/space/destiny/visibility/delta.js) | 153 | 199 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/delta.ts](../../server/src/space/destiny/visibility/delta.ts) | 199 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/membershipState.js](../../server/src/space/destiny/visibility/membershipState.js) | 704 | 1052 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/membershipState.ts](../../server/src/space/destiny/visibility/membershipState.ts) | 1055 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/referencePosition.js](../../server/src/space/destiny/visibility/referencePosition.js) | 27 | 33 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/referencePosition.ts](../../server/src/space/destiny/visibility/referencePosition.ts) | 33 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/sceneTickCoordinator.js](../../server/src/space/destiny/visibility/sceneTickCoordinator.js) | 4 | 3 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/sceneTickCoordinator.ts](../../server/src/space/destiny/visibility/sceneTickCoordinator.ts) | 3 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/warpHandoff.js](../../server/src/space/destiny/visibility/warpHandoff.js) | 577 | 799 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/warpHandoff.ts](../../server/src/space/destiny/visibility/warpHandoff.ts) | 799 | 0 | TypeScript counterpart |
| M | [server/src/space/destiny/visibility/warpLanding.js](../../server/src/space/destiny/visibility/warpLanding.js) | 264 | 349 | JavaScript with TypeScript counterpart |
| A | [server/src/space/destiny/visibility/warpLanding.ts](../../server/src/space/destiny/visibility/warpLanding.ts) | 349 | 0 | TypeScript counterpart |

## server/src/space/detachedDungeonProps.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/detachedDungeonProps.ts](../../server/src/space/detachedDungeonProps.ts) | 401 | 0 | New TypeScript path; Source or declaration |

## server/src/space/dungeonPropDetachment.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/dungeonPropDetachment.ts](../../server/src/space/dungeonPropDetachment.ts) | 159 | 0 | New TypeScript path; Source or declaration |

## server/src/space/dungeonPropMovement.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/dungeonPropMovement.ts](../../server/src/space/dungeonPropMovement.ts) | 667 | 0 | New TypeScript path; Source or declaration |

## server/src/space/empireGatePresence

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/empireGatePresence/empireSentryLayout.js](../../server/src/space/empireGatePresence/empireSentryLayout.js) | 85 | 103 | JavaScript with TypeScript counterpart |
| A | [server/src/space/empireGatePresence/empireSentryLayout.ts](../../server/src/space/empireGatePresence/empireSentryLayout.ts) | 134 | 0 | TypeScript counterpart |
| M | [server/src/space/empireGatePresence/everMoreGatePresence.js](../../server/src/space/empireGatePresence/everMoreGatePresence.js) | 193 | 224 | JavaScript with TypeScript counterpart |
| A | [server/src/space/empireGatePresence/everMoreGatePresence.ts](../../server/src/space/empireGatePresence/everMoreGatePresence.ts) | 285 | 0 | TypeScript counterpart |
| M | [server/src/space/empireGatePresence/gateSceneryLayout.js](../../server/src/space/empireGatePresence/gateSceneryLayout.js) | 31 | 47 | JavaScript with TypeScript counterpart |
| A | [server/src/space/empireGatePresence/gateSceneryLayout.ts](../../server/src/space/empireGatePresence/gateSceneryLayout.ts) | 65 | 0 | TypeScript counterpart |
| M | [server/src/space/empireGatePresence/stationSceneryLayout.js](../../server/src/space/empireGatePresence/stationSceneryLayout.js) | 13 | 22 | JavaScript with TypeScript counterpart |
| A | [server/src/space/empireGatePresence/stationSceneryLayout.ts](../../server/src/space/empireGatePresence/stationSceneryLayout.ts) | 29 | 0 | TypeScript counterpart |

## server/src/space/entityConstants.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/entityConstants.js](../../server/src/space/entityConstants.js) | 21 | 21 | JavaScript with TypeScript counterpart |

## server/src/space/entityConstants.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/entityConstants.ts](../../server/src/space/entityConstants.ts) | 21 | 0 | TypeScript counterpart |

## server/src/space/frontierLandscapeCustomSites.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/frontierLandscapeCustomSites.js](../../server/src/space/frontierLandscapeCustomSites.js) | 238 | 297 | JavaScript with TypeScript counterpart |

## server/src/space/frontierLandscapeCustomSites.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/frontierLandscapeCustomSites.ts](../../server/src/space/frontierLandscapeCustomSites.ts) | 334 | 0 | TypeScript counterpart |

## server/src/space/frontierLandscapeScenePlan.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/frontierLandscapeScenePlan.js](../../server/src/space/frontierLandscapeScenePlan.js) | 298 | 334 | JavaScript with TypeScript counterpart |

## server/src/space/frontierLandscapeScenePlan.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/frontierLandscapeScenePlan.ts](../../server/src/space/frontierLandscapeScenePlan.ts) | 456 | 0 | TypeScript counterpart |

## server/src/space/frontierLandscapeSceneService.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/frontierLandscapeSceneService.js](../../server/src/space/frontierLandscapeSceneService.js) | 426 | 259 | JavaScript with TypeScript counterpart |

## server/src/space/frontierLandscapeSceneService.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/frontierLandscapeSceneService.ts](../../server/src/space/frontierLandscapeSceneService.ts) | 579 | 0 | TypeScript counterpart |

## server/src/space/frontierRiftAuthority.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/frontierRiftAuthority.js](../../server/src/space/frontierRiftAuthority.js) | 239 | 207 | JavaScript with TypeScript counterpart |

## server/src/space/frontierRiftAuthority.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/frontierRiftAuthority.ts](../../server/src/space/frontierRiftAuthority.ts) | 322 | 0 | TypeScript counterpart |

## server/src/space/frontierRiftSceneService.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/frontierRiftSceneService.js](../../server/src/space/frontierRiftSceneService.js) | 343 | 229 | JavaScript with TypeScript counterpart |

## server/src/space/frontierRiftSceneService.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/frontierRiftSceneService.ts](../../server/src/space/frontierRiftSceneService.ts) | 439 | 0 | TypeScript counterpart |

## server/src/space/frontierRiftSites.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/frontierRiftSites.js](../../server/src/space/frontierRiftSites.js) | 315 | 207 | JavaScript with TypeScript counterpart |

## server/src/space/frontierRiftSites.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/frontierRiftSites.ts](../../server/src/space/frontierRiftSites.ts) | 392 | 0 | TypeScript counterpart |

## server/src/space/gateSkinCommand.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/gateSkinCommand.js](../../server/src/space/gateSkinCommand.js) | 610 | 729 | JavaScript with TypeScript counterpart |

## server/src/space/gateSkinCommand.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/gateSkinCommand.ts](../../server/src/space/gateSkinCommand.ts) | 834 | 0 | TypeScript counterpart |

## server/src/space/modules

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/modules/assistanceModuleRuntime.js](../../server/src/space/modules/assistanceModuleRuntime.js) | 906 | 1292 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/assistanceModuleRuntime.ts](../../server/src/space/modules/assistanceModuleRuntime.ts) | 1292 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/commandBurstRuntime.js](../../server/src/space/modules/commandBurstRuntime.js) | 788 | 999 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/commandBurstRuntime.ts](../../server/src/space/modules/commandBurstRuntime.ts) | 1006 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/genericModuleFuelRuntime.js](../../server/src/space/modules/genericModuleFuelRuntime.js) | 10 | 15 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/genericModuleFuelRuntime.ts](../../server/src/space/modules/genericModuleFuelRuntime.ts) | 22 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/hostileModuleRuntime.js](../../server/src/space/modules/hostileModuleRuntime.js) | 1077 | 1486 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/hostileModuleRuntime.ts](../../server/src/space/modules/hostileModuleRuntime.ts) | 1486 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/hudIconRuntime.js](../../server/src/space/modules/hudIconRuntime.js) | 238 | 270 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/hudIconRuntime.ts](../../server/src/space/modules/hudIconRuntime.ts) | 270 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/jammerModuleRuntime.js](../../server/src/space/modules/jammerModuleRuntime.js) | 773 | 1143 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/jammerModuleRuntime.ts](../../server/src/space/modules/jammerModuleRuntime.ts) | 1143 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/liveModuleAttributes.js](../../server/src/space/modules/liveModuleAttributes.js) | 92 | 189 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/liveModuleAttributes.ts](../../server/src/space/modules/liveModuleAttributes.ts) | 189 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/localCycleReloads.js](../../server/src/space/modules/localCycleReloads.js) | 305 | 357 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/localCycleReloads.ts](../../server/src/space/modules/localCycleReloads.ts) | 397 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/localCycleRuntime.js](../../server/src/space/modules/localCycleRuntime.js) | 915 | 1260 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/localCycleRuntime.ts](../../server/src/space/modules/localCycleRuntime.ts) | 1260 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/microJumpDriveRuntime.js](../../server/src/space/modules/microJumpDriveRuntime.js) | 178 | 250 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/microJumpDriveRuntime.ts](../../server/src/space/modules/microJumpDriveRuntime.ts) | 250 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/moduleClientParityAuthority.js](../../server/src/space/modules/moduleClientParityAuthority.js) | 112 | 138 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/moduleClientParityAuthority.ts](../../server/src/space/modules/moduleClientParityAuthority.ts) | 159 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/moduleLoadParity.js](../../server/src/space/modules/moduleLoadParity.js) | 17 | 18 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/moduleLoadParity.ts](../../server/src/space/modules/moduleLoadParity.ts) | 27 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/pointDefenseRuntime.js](../../server/src/space/modules/pointDefenseRuntime.js) | 268 | 392 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/pointDefenseRuntime.ts](../../server/src/space/modules/pointDefenseRuntime.ts) | 392 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/salvagerRuntime.js](../../server/src/space/modules/salvagerRuntime.js) | 1061 | 1337 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/salvagerRuntime.ts](../../server/src/space/modules/salvagerRuntime.ts) | 1337 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/sharedFuelRuntime.js](../../server/src/space/modules/sharedFuelRuntime.js) | 182 | 241 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/sharedFuelRuntime.ts](../../server/src/space/modules/sharedFuelRuntime.ts) | 276 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/smartbombRuntime.js](../../server/src/space/modules/smartbombRuntime.js) | 188 | 278 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/smartbombRuntime.ts](../../server/src/space/modules/smartbombRuntime.ts) | 278 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/spaceAttachHydration.js](../../server/src/space/modules/spaceAttachHydration.js) | 41 | 72 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/spaceAttachHydration.ts](../../server/src/space/modules/spaceAttachHydration.ts) | 77 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/superweapons/superweaponRuntime.js](../../server/src/space/modules/superweapons/superweaponRuntime.js) | 2455 | 3616 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/superweapons/superweaponRuntime.ts](../../server/src/space/modules/superweapons/superweaponRuntime.ts) | 3623 | 0 | TypeScript counterpart |
| M | [server/src/space/modules/tractorBeamRuntime.js](../../server/src/space/modules/tractorBeamRuntime.js) | 493 | 701 | JavaScript with TypeScript counterpart |
| A | [server/src/space/modules/tractorBeamRuntime.ts](../../server/src/space/modules/tractorBeamRuntime.ts) | 701 | 0 | TypeScript counterpart |

## server/src/space/npc

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/npc/beltRatRuntime.js](../../server/src/space/npc/beltRatRuntime.js) | 1170 | 1366 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/beltRatRuntime.ts](../../server/src/space/npc/beltRatRuntime.ts) | 1414 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcAuthority.js](../../server/src/space/npc/capitals/capitalNpcAuthority.js) | 42 | 59 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcAuthority.ts](../../server/src/space/npc/capitals/capitalNpcAuthority.ts) | 59 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcBehavior.js](../../server/src/space/npc/capitals/capitalNpcBehavior.js) | 25 | 59 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcBehavior.ts](../../server/src/space/npc/capitals/capitalNpcBehavior.ts) | 64 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcCatalog.js](../../server/src/space/npc/capitals/capitalNpcCatalog.js) | 253 | 330 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcCatalog.ts](../../server/src/space/npc/capitals/capitalNpcCatalog.ts) | 330 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcDoctrine.js](../../server/src/space/npc/capitals/capitalNpcDoctrine.js) | 158 | 215 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcDoctrine.ts](../../server/src/space/npc/capitals/capitalNpcDoctrine.ts) | 215 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcEngagement.js](../../server/src/space/npc/capitals/capitalNpcEngagement.js) | 98 | 128 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcEngagement.ts](../../server/src/space/npc/capitals/capitalNpcEngagement.ts) | 128 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcMovement.js](../../server/src/space/npc/capitals/capitalNpcMovement.js) | 211 | 305 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcMovement.ts](../../server/src/space/npc/capitals/capitalNpcMovement.ts) | 305 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcRuntimeConfig.js](../../server/src/space/npc/capitals/capitalNpcRuntimeConfig.js) | 67 | 66 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcRuntimeConfig.ts](../../server/src/space/npc/capitals/capitalNpcRuntimeConfig.ts) | 66 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcState.js](../../server/src/space/npc/capitals/capitalNpcState.js) | 70 | 74 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcState.ts](../../server/src/space/npc/capitals/capitalNpcState.ts) | 74 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcTargeting.js](../../server/src/space/npc/capitals/capitalNpcTargeting.js) | 141 | 199 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcTargeting.ts](../../server/src/space/npc/capitals/capitalNpcTargeting.ts) | 221 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/capitals/capitalNpcWrecks.js](../../server/src/space/npc/capitals/capitalNpcWrecks.js) | 130 | 168 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/capitals/capitalNpcWrecks.ts](../../server/src/space/npc/capitals/capitalNpcWrecks.ts) | 193 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/empireSecurity/empireSecurityNpcCatalog.js](../../server/src/space/npc/empireSecurity/empireSecurityNpcCatalog.js) | 102 | 127 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/empireSecurity/empireSecurityNpcCatalog.ts](../../server/src/space/npc/empireSecurity/empireSecurityNpcCatalog.ts) | 127 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/index.js](../../server/src/space/npc/index.js) | 23 | 3 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/index.ts](../../server/src/space/npc/index.ts) | 25 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/legacySyntheticNpcCleanup.js](../../server/src/space/npc/legacySyntheticNpcCleanup.js) | 155 | 193 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/legacySyntheticNpcCleanup.ts](../../server/src/space/npc/legacySyntheticNpcCleanup.ts) | 193 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/nativeNpcService.js](../../server/src/space/npc/nativeNpcService.js) | 1809 | 1743 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/nativeNpcService.ts](../../server/src/space/npc/nativeNpcService.ts) | 2383 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/nativeNpcStore.js](../../server/src/space/npc/nativeNpcStore.js) | 788 | 842 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/nativeNpcStore.ts](../../server/src/space/npc/nativeNpcStore.ts) | 991 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/nativeNpcWreckService.js](../../server/src/space/npc/nativeNpcWreckService.js) | 594 | 709 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/nativeNpcWreckService.ts](../../server/src/space/npc/nativeNpcWreckService.ts) | 744 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcAmbientMaterialization.js](../../server/src/space/npc/npcAmbientMaterialization.js) | 201 | 240 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcAmbientMaterialization.ts](../../server/src/space/npc/npcAmbientMaterialization.ts) | 240 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcAnchorRelevance.js](../../server/src/space/npc/npcAnchorRelevance.js) | 343 | 428 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcAnchorRelevance.ts](../../server/src/space/npc/npcAnchorRelevance.ts) | 477 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcAnchors.js](../../server/src/space/npc/npcAnchors.js) | 303 | 428 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcAnchors.ts](../../server/src/space/npc/npcAnchors.ts) | 486 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcAssemblyAccessService.ts](../../server/src/space/npc/npcAssemblyAccessService.ts) | 160 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcAssemblyActorContext.ts](../../server/src/space/npc/npcAssemblyActorContext.ts) | 148 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcBehaviorCapabilities.ts](../../server/src/space/npc/npcBehaviorCapabilities.ts) | 48 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcBehaviorLoop.js](../../server/src/space/npc/npcBehaviorLoop.js) | 4041 | 4708 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcBehaviorLoop.ts](../../server/src/space/npc/npcBehaviorLoop.ts) | 5747 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcBehaviorTreeRuntime.ts](../../server/src/space/npc/npcBehaviorTreeRuntime.ts) | 373 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcCapabilityResolver.js](../../server/src/space/npc/npcCapabilityResolver.js) | 53 | 69 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcCapabilityResolver.ts](../../server/src/space/npc/npcCapabilityResolver.ts) | 89 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcCombatDebug.js](../../server/src/space/npc/npcCombatDebug.js) | 121 | 133 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcCombatDebug.ts](../../server/src/space/npc/npcCombatDebug.ts) | 162 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcCombatDormancy.js](../../server/src/space/npc/npcCombatDormancy.js) | 300 | 391 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcCombatDormancy.ts](../../server/src/space/npc/npcCombatDormancy.ts) | 391 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcConstructionJobService.ts](../../server/src/space/npc/npcConstructionJobService.ts) | 940 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcConstructionTemplateJobService.ts](../../server/src/space/npc/npcConstructionTemplateJobService.ts) | 364 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcControlState.js](../../server/src/space/npc/npcControlState.js) | 353 | 431 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcControlState.ts](../../server/src/space/npc/npcControlState.ts) | 431 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcData.js](../../server/src/space/npc/npcData.js) | 548 | 527 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcData.ts](../../server/src/space/npc/npcData.ts) | 649 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcDecisionTreeScaffolds.ts](../../server/src/space/npc/npcDecisionTreeScaffolds.ts) | 569 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcDefaultConcordRules.js](../../server/src/space/npc/npcDefaultConcordRules.js) | 277 | 324 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcDefaultConcordRules.ts](../../server/src/space/npc/npcDefaultConcordRules.ts) | 324 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcEntityEwarCatalog.js](../../server/src/space/npc/npcEntityEwarCatalog.js) | 155 | 160 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcEntityEwarCatalog.ts](../../server/src/space/npc/npcEntityEwarCatalog.ts) | 160 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcEquipment.js](../../server/src/space/npc/npcEquipment.js) | 904 | 1229 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcEquipment.ts](../../server/src/space/npc/npcEquipment.ts) | 1229 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcFittingService.ts](../../server/src/space/npc/npcFittingService.ts) | 1509 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcFittingTrust.ts](../../server/src/space/npc/npcFittingTrust.ts) | 147 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcFuelLogistics.ts](../../server/src/space/npc/npcFuelLogistics.ts) | 189 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcHardwareCatalog.js](../../server/src/space/npc/npcHardwareCatalog.js) | 646 | 728 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcHardwareCatalog.ts](../../server/src/space/npc/npcHardwareCatalog.ts) | 749 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcHeadlessFittingWindow.ts](../../server/src/space/npc/npcHeadlessFittingWindow.ts) | 259 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcHostileUtilityCatalog.js](../../server/src/space/npc/npcHostileUtilityCatalog.js) | 198 | 251 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcHostileUtilityCatalog.ts](../../server/src/space/npc/npcHostileUtilityCatalog.ts) | 251 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcIndustryJobService.ts](../../server/src/space/npc/npcIndustryJobService.ts) | 761 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcLoot.js](../../server/src/space/npc/npcLoot.js) | 626 | 808 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcLoot.ts](../../server/src/space/npc/npcLoot.ts) | 877 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcMetamorphosis.ts](../../server/src/space/npc/npcMetamorphosis.ts) | 218 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcNetworkNodeCoordinator.ts](../../server/src/space/npc/npcNetworkNodeCoordinator.ts) | 444 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcPilotIdentityRuntime.ts](../../server/src/space/npc/npcPilotIdentityRuntime.ts) | 57 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcPilotIdentityStore.ts](../../server/src/space/npc/npcPilotIdentityStore.ts) | 164 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcPresentation.js](../../server/src/space/npc/npcPresentation.js) | 181 | 255 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcPresentation.ts](../../server/src/space/npc/npcPresentation.ts) | 255 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcRegistry.js](../../server/src/space/npc/npcRegistry.js) | 151 | 177 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcRegistry.ts](../../server/src/space/npc/npcRegistry.ts) | 177 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcResourceJobService.ts](../../server/src/space/npc/npcResourceJobService.ts) | 868 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcRuntime.js](../../server/src/space/npc/npcRuntime.js) | 485 | 645 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcRuntime.ts](../../server/src/space/npc/npcRuntime.ts) | 652 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcRuntimePersistence.ts](../../server/src/space/npc/npcRuntimePersistence.ts) | 2109 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcScanning.ts](../../server/src/space/npc/npcScanning.ts) | 651 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcSceneActivity.js](../../server/src/space/npc/npcSceneActivity.js) | 347 | 401 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcSceneActivity.ts](../../server/src/space/npc/npcSceneActivity.ts) | 401 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcSelection.js](../../server/src/space/npc/npcSelection.js) | 369 | 506 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcSelection.ts](../../server/src/space/npc/npcSelection.ts) | 561 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/npcService.js](../../server/src/space/npc/npcService.js) | 1830 | 1936 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcService.ts](../../server/src/space/npc/npcService.ts) | 2377 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcStargateMaintenanceService.ts](../../server/src/space/npc/npcStargateMaintenanceService.ts) | 479 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcSupportCoordinator.ts](../../server/src/space/npc/npcSupportCoordinator.ts) | 592 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcTaskActionAdapters.ts](../../server/src/space/npc/npcTaskActionAdapters.ts) | 400 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcTestService.js](../../server/src/space/npc/npcTestService.js) | 613 | 816 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcTestService.ts](../../server/src/space/npc/npcTestService.ts) | 816 | 0 | TypeScript counterpart |
| A | [server/src/space/npc/npcTransponderMembership.ts](../../server/src/space/npc/npcTransponderMembership.ts) | 180 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcTravelRoute.ts](../../server/src/space/npc/npcTravelRoute.ts) | 230 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcTravelService.ts](../../server/src/space/npc/npcTravelService.ts) | 340 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/space/npc/npcTravelTransition.ts](../../server/src/space/npc/npcTravelTransition.ts) | 352 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/space/npc/npcWarpOrigins.js](../../server/src/space/npc/npcWarpOrigins.js) | 218 | 262 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/npcWarpOrigins.ts](../../server/src/space/npc/npcWarpOrigins.ts) | 366 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/pirateFactionPolicy.js](../../server/src/space/npc/pirateFactionPolicy.js) | 234 | 293 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/pirateFactionPolicy.ts](../../server/src/space/npc/pirateFactionPolicy.ts) | 343 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/trigDrifter/trigDrifterNpcCatalog.js](../../server/src/space/npc/trigDrifter/trigDrifterNpcCatalog.js) | 1819 | 2248 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/trigDrifter/trigDrifterNpcCatalog.ts](../../server/src/space/npc/trigDrifter/trigDrifterNpcCatalog.ts) | 2228 | 0 | TypeScript counterpart |
| M | [server/src/space/npc/trigDrifter/trigDrifterSpawnAuthority.js](../../server/src/space/npc/trigDrifter/trigDrifterSpawnAuthority.js) | 40 | 51 | JavaScript with TypeScript counterpart |
| A | [server/src/space/npc/trigDrifter/trigDrifterSpawnAuthority.ts](../../server/src/space/npc/trigDrifter/trigDrifterSpawnAuthority.ts) | 51 | 0 | TypeScript counterpart |

## server/src/space/physicsGunPickup.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/physicsGunPickup.ts](../../server/src/space/physicsGunPickup.ts) | 111 | 0 | New TypeScript path; Source or declaration |

## server/src/space/physicsGunPoseStream.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/physicsGunPoseStream.ts](../../server/src/space/physicsGunPoseStream.ts) | 127 | 0 | New TypeScript path; Source or declaration |

## server/src/space/runtime.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/runtime.js](../../server/src/space/runtime.js) | 35441 | 43644 | JavaScript with TypeScript counterpart |

## server/src/space/runtime.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/runtime.ts](../../server/src/space/runtime.ts) | 49303 | 0 | TypeScript counterpart |

## server/src/space/sceneBootstrapPlanningTask.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/sceneBootstrapPlanningTask.ts](../../server/src/space/sceneBootstrapPlanningTask.ts) | 61 | 0 | New TypeScript path; Source or declaration |

## server/src/space/sceneIdleLifecycle.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/sceneIdleLifecycle.ts](../../server/src/space/sceneIdleLifecycle.ts) | 89 | 0 | New TypeScript path; Source or declaration |

## server/src/space/shipDestruction.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/shipDestruction.js](../../server/src/space/shipDestruction.js) | 1500 | 1233 | JavaScript with TypeScript counterpart |

## server/src/space/shipDestruction.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/shipDestruction.ts](../../server/src/space/shipDestruction.ts) | 1966 | 0 | TypeScript counterpart |

## server/src/space/stargateOrientation.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/stargateOrientation.js](../../server/src/space/stargateOrientation.js) | 54 | 88 | JavaScript with TypeScript counterpart |

## server/src/space/stargateOrientation.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/stargateOrientation.ts](../../server/src/space/stargateOrientation.ts) | 112 | 0 | TypeScript counterpart |

## server/src/space/stargateRadius.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/stargateRadius.js](../../server/src/space/stargateRadius.js) | 39 | 53 | JavaScript with TypeScript counterpart |

## server/src/space/stargateRadius.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/stargateRadius.ts](../../server/src/space/stargateRadius.ts) | 71 | 0 | TypeScript counterpart |

## server/src/space/stargateVisualOverrides.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/stargateVisualOverrides.js](../../server/src/space/stargateVisualOverrides.js) | 86 | 98 | JavaScript with TypeScript counterpart |

## server/src/space/stargateVisualOverrides.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/stargateVisualOverrides.ts](../../server/src/space/stargateVisualOverrides.ts) | 98 | 0 | TypeScript counterpart |

## server/src/space/startupPreloadCompatibility.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/startupPreloadCompatibility.js](../../server/src/space/startupPreloadCompatibility.js) | 16 | 16 | JavaScript with TypeScript counterpart |

## server/src/space/startupPreloadCompatibility.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/startupPreloadCompatibility.ts](../../server/src/space/startupPreloadCompatibility.ts) | 25 | 0 | TypeScript counterpart |

## server/src/space/stationRadius.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/stationRadius.js](../../server/src/space/stationRadius.js) | 78 | 101 | JavaScript with TypeScript counterpart |

## server/src/space/stationRadius.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/stationRadius.ts](../../server/src/space/stationRadius.ts) | 126 | 0 | TypeScript counterpart |

## server/src/space/structureTethering.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/structureTethering.js](../../server/src/space/structureTethering.js) | 273 | 365 | JavaScript with TypeScript counterpart |

## server/src/space/structureTethering.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/structureTethering.ts](../../server/src/space/structureTethering.ts) | 365 | 0 | TypeScript counterpart |

## server/src/space/tickProfiler.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/tickProfiler.js](../../server/src/space/tickProfiler.js) | 125 | 136 | JavaScript with TypeScript counterpart |

## server/src/space/tickProfiler.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/tickProfiler.ts](../../server/src/space/tickProfiler.ts) | 136 | 0 | TypeScript counterpart |

## server/src/space/transitions.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/transitions.js](../../server/src/space/transitions.js) | 3535 | 4585 | JavaScript with TypeScript counterpart |

## server/src/space/transitions.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/transitions.ts](../../server/src/space/transitions.ts) | 4778 | 0 | TypeScript counterpart |

## server/src/space/types.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/types.ts](../../server/src/space/types.ts) | 14 | 0 | New TypeScript path; Source or declaration |

## server/src/space/worldData.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/worldData.js](../../server/src/space/worldData.js) | 207 | 245 | JavaScript with TypeScript counterpart |

## server/src/space/worldData.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/worldData.ts](../../server/src/space/worldData.ts) | 317 | 0 | TypeScript counterpart |

## server/src/space/worldPlanningPool.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/worldPlanningPool.ts](../../server/src/space/worldPlanningPool.ts) | 58 | 0 | New TypeScript path; Source or declaration |

## server/src/space/wreckUtils.js

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [server/src/space/wreckUtils.js](../../server/src/space/wreckUtils.js) | 475 | 574 | JavaScript with TypeScript counterpart |

## server/src/space/wreckUtils.ts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/space/wreckUtils.ts](../../server/src/space/wreckUtils.ts) | 574 | 0 | TypeScript counterpart |

## server/src/utils

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/src/utils/adaptiveTickRate.ts](../../server/src/utils/adaptiveTickRate.ts) | 353 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/utils/asyncFileQueue.ts](../../server/src/utils/asyncFileQueue.ts) | 55 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/utils/dungeonSpawnPlacement.ts](../../server/src/utils/dungeonSpawnPlacement.ts) | 141 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/utils/interactiveWorkloadGate.ts](../../server/src/utils/interactiveWorkloadGate.ts) | 91 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/utils/logger/index.js](../../server/src/utils/logger/index.js) | 268 | 326 | JavaScript with TypeScript counterpart |
| A | [server/src/utils/logger/index.ts](../../server/src/utils/logger/index.ts) | 412 | 0 | TypeScript counterpart |
| M | [server/src/utils/processLifecycle.js](../../server/src/utils/processLifecycle.js) | 178 | 273 | JavaScript with TypeScript counterpart |
| A | [server/src/utils/processLifecycle.ts](../../server/src/utils/processLifecycle.ts) | 289 | 0 | TypeScript counterpart |
| M | [server/src/utils/rotatingLog.js](../../server/src/utils/rotatingLog.js) | 95 | 106 | JavaScript with TypeScript counterpart |
| A | [server/src/utils/rotatingLog.ts](../../server/src/utils/rotatingLog.ts) | 182 | 0 | TypeScript counterpart |
| A | [server/src/utils/serviceTaskPool.ts](../../server/src/utils/serviceTaskPool.ts) | 250 | 0 | New TypeScript path; Source or declaration |
| A | [server/src/utils/serviceTaskPool.worker.ts](../../server/src/utils/serviceTaskPool.worker.ts) | 69 | 0 | New TypeScript path; Source or declaration |
| M | [server/src/utils/startupDataSummary.js](../../server/src/utils/startupDataSummary.js) | 103 | 135 | JavaScript with TypeScript counterpart |
| A | [server/src/utils/startupDataSummary.ts](../../server/src/utils/startupDataSummary.ts) | 135 | 0 | TypeScript counterpart |
| M | [server/src/utils/synchronizedTimeDilation.js](../../server/src/utils/synchronizedTimeDilation.js) | 174 | 243 | JavaScript with TypeScript counterpart |
| A | [server/src/utils/synchronizedTimeDilation.ts](../../server/src/utils/synchronizedTimeDilation.ts) | 243 | 0 | TypeScript counterpart |
| M | [server/src/utils/tidiAutoscaler.js](../../server/src/utils/tidiAutoscaler.js) | 473 | 635 | JavaScript with TypeScript counterpart |
| A | [server/src/utils/tidiAutoscaler.ts](../../server/src/utils/tidiAutoscaler.ts) | 734 | 0 | TypeScript counterpart |

## server/tests

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [server/tests/adaptiveTickRate.test.ts](../../server/tests/adaptiveTickRate.test.ts) | 140 | 0 | New TypeScript path; Test |
| A | [server/tests/beltRatIdentitySlots.test.ts](../../server/tests/beltRatIdentitySlots.test.ts) | 68 | 0 | New TypeScript path; Test |
| A | [server/tests/chatDungeonTeleportInitialization.test.ts](../../server/tests/chatDungeonTeleportInitialization.test.ts) | 207 | 0 | New TypeScript path; Test |
| A | [server/tests/collisionImpact.test.ts](../../server/tests/collisionImpact.test.ts) | 164 | 0 | New TypeScript path; Test |
| M | [server/tests/destinyPayloadSummary.test.js](../../server/tests/destinyPayloadSummary.test.js) | 52 | 60 | JavaScript with TypeScript counterpart |
| A | [server/tests/destinyPayloadSummary.test.ts](../../server/tests/destinyPayloadSummary.test.ts) | 67 | 0 | TypeScript counterpart |
| A | [server/tests/detachedDungeonProps.test.ts](../../server/tests/detachedDungeonProps.test.ts) | 973 | 0 | New TypeScript path; Test |
| A | [server/tests/detachedDungeonPropsSqlite.test.ts](../../server/tests/detachedDungeonPropsSqlite.test.ts) | 124 | 0 | New TypeScript path; Test |
| A | [server/tests/dungeonPropMoveSelection.test.ts](../../server/tests/dungeonPropMoveSelection.test.ts) | 249 | 0 | New TypeScript path; Test |
| A | [server/tests/dungeonRuntimeStateIncremental.test.ts](../../server/tests/dungeonRuntimeStateIncremental.test.ts) | 349 | 0 | New TypeScript path; Test |
| A | [server/tests/fixtures/frontierTypeListClient3502403.json](../../server/tests/fixtures/frontierTypeListClient3502403.json) | 27 | 0 | Added file |
| A | [server/tests/fixtures/serviceTaskFixture.ts](../../server/tests/fixtures/serviceTaskFixture.ts) | 20 | 0 | New TypeScript path; Source or declaration |
| A | [server/tests/frontierActualGatewayContracts.test.ts](../../server/tests/frontierActualGatewayContracts.test.ts) | 161 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierArrivalSafety.test.ts](../../server/tests/frontierArrivalSafety.test.ts) | 170 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierAssemblyAccess.test.ts](../../server/tests/frontierAssemblyAccess.test.ts) | 360 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierAssemblyCommands.test.js](../../server/tests/frontierAssemblyCommands.test.js) | 378 | 558 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierAssemblyCommands.test.ts](../../server/tests/frontierAssemblyCommands.test.ts) | 610 | 0 | TypeScript counterpart |
| A | [server/tests/frontierAssemblyCrossOwnerInventory.test.ts](../../server/tests/frontierAssemblyCrossOwnerInventory.test.ts) | 165 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierAssemblyEnergyConfig.test.js](../../server/tests/frontierAssemblyEnergyConfig.test.js) | 88 | 77 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierAssemblyEnergyConfig.test.ts](../../server/tests/frontierAssemblyEnergyConfig.test.ts) | 148 | 0 | TypeScript counterpart |
| A | [server/tests/frontierAssemblyStatePresentation.test.ts](../../server/tests/frontierAssemblyStatePresentation.test.ts) | 178 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierAssemblyStateProjection.test.ts](../../server/tests/frontierAssemblyStateProjection.test.ts) | 191 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierAsteroidData.test.ts](../../server/tests/frontierAsteroidData.test.ts) | 145 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierAsteroidPresentation.test.ts](../../server/tests/frontierAsteroidPresentation.test.ts) | 109 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierBerthingActivation.test.ts](../../server/tests/frontierBerthingActivation.test.ts) | 32 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCelestialStargateRuntime.test.ts](../../server/tests/frontierCelestialStargateRuntime.test.ts) | 141 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierClientContracts.test.js](../../server/tests/frontierClientContracts.test.js) | 55 | 92 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierClientContracts.test.ts](../../server/tests/frontierClientContracts.test.ts) | 105 | 0 | TypeScript counterpart |
| A | [server/tests/frontierCollisionBundle.test.ts](../../server/tests/frontierCollisionBundle.test.ts) | 182 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierConstructionPresentation.test.ts](../../server/tests/frontierConstructionPresentation.test.ts) | 414 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierConstructionTemplates.test.ts](../../server/tests/frontierConstructionTemplates.test.ts) | 238 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierCreationAbilities.test.js](../../server/tests/frontierCreationAbilities.test.js) | 2505 | 1694 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierCreationAbilities.test.ts](../../server/tests/frontierCreationAbilities.test.ts) | 4085 | 0 | TypeScript counterpart |
| A | [server/tests/frontierCreationAbilityMarshalling.test.ts](../../server/tests/frontierCreationAbilityMarshalling.test.ts) | 43 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCreationActiveModules.test.ts](../../server/tests/frontierCreationActiveModules.test.ts) | 1098 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCreationControlAuthority.test.ts](../../server/tests/frontierCreationControlAuthority.test.ts) | 386 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCreationIndustryAbilities.test.ts](../../server/tests/frontierCreationIndustryAbilities.test.ts) | 443 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCreationLayoutValidation.test.ts](../../server/tests/frontierCreationLayoutValidation.test.ts) | 272 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCreationPresets.test.ts](../../server/tests/frontierCreationPresets.test.ts) | 643 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierCreationTypeAbilityRegistry.test.ts](../../server/tests/frontierCreationTypeAbilityRegistry.test.ts) | 120 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDeploymentActivation.test.ts](../../server/tests/frontierDeploymentActivation.test.ts) | 752 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDeploymentMaterials.test.ts](../../server/tests/frontierDeploymentMaterials.test.ts) | 361 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDockedHealthPresentation.test.ts](../../server/tests/frontierDockedHealthPresentation.test.ts) | 51 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonBeaconMapVisibility.test.ts](../../server/tests/frontierDungeonBeaconMapVisibility.test.ts) | 206 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonMapVisibility.test.ts](../../server/tests/frontierDungeonMapVisibility.test.ts) | 869 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonSignaturePlacement.test.ts](../../server/tests/frontierDungeonSignaturePlacement.test.ts) | 50 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonSpawnEligibility.test.ts](../../server/tests/frontierDungeonSpawnEligibility.test.ts) | 248 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonSpawnPlacement.test.ts](../../server/tests/frontierDungeonSpawnPlacement.test.ts) | 83 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonSpawns.test.ts](../../server/tests/frontierDungeonSpawns.test.ts) | 1567 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonTrackingNotification.test.ts](../../server/tests/frontierDungeonTrackingNotification.test.ts) | 53 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonWarpMaterialization.test.ts](../../server/tests/frontierDungeonWarpMaterialization.test.ts) | 618 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierDungeonWarpTargetCleanup.test.ts](../../server/tests/frontierDungeonWarpTargetCleanup.test.ts) | 103 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierEngineFitting.test.ts](../../server/tests/frontierEngineFitting.test.ts) | 116 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierEnvironmentalEffects.test.ts](../../server/tests/frontierEnvironmentalEffects.test.ts) | 1222 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierExperienceService.test.js](../../server/tests/frontierExperienceService.test.js) | 229 | 217 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierExperienceService.test.ts](../../server/tests/frontierExperienceService.test.ts) | 395 | 0 | TypeScript counterpart |
| A | [server/tests/frontierFieldStorageActivation.test.ts](../../server/tests/frontierFieldStorageActivation.test.ts) | 83 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierHandshakeProfile.test.js](../../server/tests/frontierHandshakeProfile.test.js) | 2349 | 3056 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierHandshakeProfile.test.ts](../../server/tests/frontierHandshakeProfile.test.ts) | 3429 | 0 | TypeScript counterpart |
| M | [server/tests/frontierHudData.test.js](../../server/tests/frontierHudData.test.js) | 200 | 216 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierHudData.test.ts](../../server/tests/frontierHudData.test.ts) | 277 | 0 | TypeScript counterpart |
| A | [server/tests/frontierIndustryBlueprintApi.test.ts](../../server/tests/frontierIndustryBlueprintApi.test.ts) | 227 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryBlueprintParity.test.ts](../../server/tests/frontierIndustryBlueprintParity.test.ts) | 135 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryBlueprints.test.ts](../../server/tests/frontierIndustryBlueprints.test.ts) | 87 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryInventory.test.ts](../../server/tests/frontierIndustryInventory.test.ts) | 1140 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryInventoryAccess.test.ts](../../server/tests/frontierIndustryInventoryAccess.test.ts) | 231 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryNotifications.test.ts](../../server/tests/frontierIndustryNotifications.test.ts) | 88 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryProduction.test.ts](../../server/tests/frontierIndustryProduction.test.ts) | 514 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryProductionWorker.test.ts](../../server/tests/frontierIndustryProductionWorker.test.ts) | 259 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierIndustryStorageApi.test.ts](../../server/tests/frontierIndustryStorageApi.test.ts) | 169 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierInventoryListener.test.ts](../../server/tests/frontierInventoryListener.test.ts) | 90 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierJumpDriveRuntime.test.ts](../../server/tests/frontierJumpDriveRuntime.test.ts) | 255 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierLandscapeCommands.test.js](../../server/tests/frontierLandscapeCommands.test.js) | 165 | 189 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierLandscapeCommands.test.ts](../../server/tests/frontierLandscapeCommands.test.ts) | 205 | 0 | TypeScript counterpart |
| M | [server/tests/frontierLandscapeScenes.test.js](../../server/tests/frontierLandscapeScenes.test.js) | 603 | 256 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierLandscapeScenes.test.ts](../../server/tests/frontierLandscapeScenes.test.ts) | 761 | 0 | TypeScript counterpart |
| A | [server/tests/frontierLaunchBayPayloadRuntime.test.ts](../../server/tests/frontierLaunchBayPayloadRuntime.test.ts) | 294 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierLensDurability.test.ts](../../server/tests/frontierLensDurability.test.ts) | 191 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierLoadFuel.test.js](../../server/tests/frontierLoadFuel.test.js) | 1569 | 497 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierLoadFuel.test.ts](../../server/tests/frontierLoadFuel.test.ts) | 1973 | 0 | TypeScript counterpart |
| M | [server/tests/frontierMapSkinCompatibility.test.js](../../server/tests/frontierMapSkinCompatibility.test.js) | 132 | 199 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierMapSkinCompatibility.test.ts](../../server/tests/frontierMapSkinCompatibility.test.ts) | 218 | 0 | TypeScript counterpart |
| A | [server/tests/frontierMiningRespawn.test.ts](../../server/tests/frontierMiningRespawn.test.ts) | 123 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierModuleChargeNotifications.test.ts](../../server/tests/frontierModuleChargeNotifications.test.ts) | 251 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierNetworkNodeChainFuel.test.ts](../../server/tests/frontierNetworkNodeChainFuel.test.ts) | 336 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierNetworkNodeEnergy.test.ts](../../server/tests/frontierNetworkNodeEnergy.test.ts) | 414 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierNetworkNodeFuel.test.js](../../server/tests/frontierNetworkNodeFuel.test.js) | 781 | 717 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierNetworkNodeFuel.test.ts](../../server/tests/frontierNetworkNodeFuel.test.ts) | 1101 | 0 | TypeScript counterpart |
| A | [server/tests/frontierNetworkNodeFuelConsumption.test.ts](../../server/tests/frontierNetworkNodeFuelConsumption.test.ts) | 615 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierNewCharacterCreation.test.js](../../server/tests/frontierNewCharacterCreation.test.js) | 436 | 248 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierNewCharacterCreation.test.ts](../../server/tests/frontierNewCharacterCreation.test.ts) | 730 | 0 | TypeScript counterpart |
| A | [server/tests/frontierNpcMetamorphosis.test.ts](../../server/tests/frontierNpcMetamorphosis.test.ts) | 117 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierNpcPilotIdentity.test.ts](../../server/tests/frontierNpcPilotIdentity.test.ts) | 115 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierNpcScanning.test.ts](../../server/tests/frontierNpcScanning.test.ts) | 375 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierPassiveScanning.test.ts](../../server/tests/frontierPassiveScanning.test.ts) | 357 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierPublicGatewayAsync.test.ts](../../server/tests/frontierPublicGatewayAsync.test.ts) | 70 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierRefugeFitting.test.ts](../../server/tests/frontierRefugeFitting.test.ts) | 179 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierRemoteSystemScanning.test.ts](../../server/tests/frontierRemoteSystemScanning.test.ts) | 564 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierResourceFields.test.js](../../server/tests/frontierResourceFields.test.js) | 93 | 58 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierResourceFields.test.ts](../../server/tests/frontierResourceFields.test.ts) | 108 | 0 | TypeScript counterpart |
| M | [server/tests/frontierRifts.test.js](../../server/tests/frontierRifts.test.js) | 434 | 345 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierRifts.test.ts](../../server/tests/frontierRifts.test.ts) | 532 | 0 | TypeScript counterpart |
| M | [server/tests/frontierSafeLogoffStrafe.test.js](../../server/tests/frontierSafeLogoffStrafe.test.js) | 659 | 533 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierSafeLogoffStrafe.test.ts](../../server/tests/frontierSafeLogoffStrafe.test.ts) | 826 | 0 | TypeScript counterpart |
| A | [server/tests/frontierSelfDestruct.test.ts](../../server/tests/frontierSelfDestruct.test.ts) | 82 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierShipMassDynamics.test.ts](../../server/tests/frontierShipMassDynamics.test.ts) | 179 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSkillShotService.test.ts](../../server/tests/frontierSkillShotService.test.ts) | 1088 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSkillShotUtilityRuntime.test.ts](../../server/tests/frontierSkillShotUtilityRuntime.test.ts) | 365 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartAssemblyAdminApi.test.ts](../../server/tests/frontierSmartAssemblyAdminApi.test.ts) | 183 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartAssemblyEnergyApi.test.ts](../../server/tests/frontierSmartAssemblyEnergyApi.test.ts) | 282 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartAssemblyGlobalConfig.test.ts](../../server/tests/frontierSmartAssemblyGlobalConfig.test.ts) | 112 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartAssemblyRequests.test.ts](../../server/tests/frontierSmartAssemblyRequests.test.ts) | 541 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartGateApi.test.ts](../../server/tests/frontierSmartGateApi.test.ts) | 170 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartGateRuntime.test.ts](../../server/tests/frontierSmartGateRuntime.test.ts) | 301 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartStorageApi.test.ts](../../server/tests/frontierSmartStorageApi.test.ts) | 375 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSmartStorageApiRuntime.test.ts](../../server/tests/frontierSmartStorageApiRuntime.test.ts) | 80 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierSmartStorageUnit.test.js](../../server/tests/frontierSmartStorageUnit.test.js) | 951 | 585 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierSmartStorageUnit.test.ts](../../server/tests/frontierSmartStorageUnit.test.ts) | 1261 | 0 | TypeScript counterpart |
| A | [server/tests/frontierSmartTurretRuntime.test.ts](../../server/tests/frontierSmartTurretRuntime.test.ts) | 547 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSpaceCollisions.test.ts](../../server/tests/frontierSpaceCollisions.test.ts) | 2117 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyAccess.test.ts](../../server/tests/frontierSuiAssemblyAccess.test.ts) | 204 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyActionQueue.test.ts](../../server/tests/frontierSuiAssemblyActionQueue.test.ts) | 181 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyAdmin.test.ts](../../server/tests/frontierSuiAssemblyAdmin.test.ts) | 235 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyChain.test.ts](../../server/tests/frontierSuiAssemblyChain.test.ts) | 345 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyContents.test.ts](../../server/tests/frontierSuiAssemblyContents.test.ts) | 501 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyEnergy.test.ts](../../server/tests/frontierSuiAssemblyEnergy.test.ts) | 182 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyFuelBurn.test.ts](../../server/tests/frontierSuiAssemblyFuelBurn.test.ts) | 211 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyGate.test.ts](../../server/tests/frontierSuiAssemblyGate.test.ts) | 77 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyReconcile.test.ts](../../server/tests/frontierSuiAssemblyReconcile.test.ts) | 479 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyRequestLink.test.ts](../../server/tests/frontierSuiAssemblyRequestLink.test.ts) | 180 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblySnapshot.test.ts](../../server/tests/frontierSuiAssemblySnapshot.test.ts) | 248 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyState.test.ts](../../server/tests/frontierSuiAssemblyState.test.ts) | 446 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyStates.test.ts](../../server/tests/frontierSuiAssemblyStates.test.ts) | 77 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblySupervisor.test.ts](../../server/tests/frontierSuiAssemblySupervisor.test.ts) | 96 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblySync.test.ts](../../server/tests/frontierSuiAssemblySync.test.ts) | 291 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiAssemblyTransactions.test.ts](../../server/tests/frontierSuiAssemblyTransactions.test.ts) | 587 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiCharacterProvisioning.test.ts](../../server/tests/frontierSuiCharacterProvisioning.test.ts) | 1286 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiGateSync.test.ts](../../server/tests/frontierSuiGateSync.test.ts) | 39 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiGrpcClient.test.ts](../../server/tests/frontierSuiGrpcClient.test.ts) | 76 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiIndustry.test.ts](../../server/tests/frontierSuiIndustry.test.ts) | 598 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiIndustryDeployment.test.ts](../../server/tests/frontierSuiIndustryDeployment.test.ts) | 147 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiIndustryStorageSync.test.ts](../../server/tests/frontierSuiIndustryStorageSync.test.ts) | 119 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiNpcCharacterProvisioning.test.ts](../../server/tests/frontierSuiNpcCharacterProvisioning.test.ts) | 441 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiNpcFactionFunding.test.ts](../../server/tests/frontierSuiNpcFactionFunding.test.ts) | 199 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiNpcIdentitySync.test.ts](../../server/tests/frontierSuiNpcIdentitySync.test.ts) | 346 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiNpcProfile.test.ts](../../server/tests/frontierSuiNpcProfile.test.ts) | 280 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiNpcWorldConfig.test.ts](../../server/tests/frontierSuiNpcWorldConfig.test.ts) | 508 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiStorageSync.test.ts](../../server/tests/frontierSuiStorageSync.test.ts) | 66 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierSuiTransponderCommitment.test.ts](../../server/tests/frontierSuiTransponderCommitment.test.ts) | 197 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierTemperatureRuntime.test.ts](../../server/tests/frontierTemperatureRuntime.test.ts) | 239 | 0 | New TypeScript path; Test |
| A | [server/tests/frontierUndockSceneTransition.test.ts](../../server/tests/frontierUndockSceneTransition.test.ts) | 57 | 0 | New TypeScript path; Test |
| M | [server/tests/frontierWarpAlign.test.js](../../server/tests/frontierWarpAlign.test.js) | 108 | 160 | JavaScript with TypeScript counterpart |
| A | [server/tests/frontierWarpAlign.test.ts](../../server/tests/frontierWarpAlign.test.ts) | 194 | 0 | TypeScript counterpart |
| A | [server/tests/gameStoreShutdown.test.ts](../../server/tests/gameStoreShutdown.test.ts) | 40 | 0 | New TypeScript path; Test |
| M | [server/tests/helpers/isolatedGameStore.js](../../server/tests/helpers/isolatedGameStore.js) | 139 | 182 | JavaScript with TypeScript counterpart |
| A | [server/tests/helpers/isolatedGameStore.ts](../../server/tests/helpers/isolatedGameStore.ts) | 239 | 0 | TypeScript counterpart |
| A | [server/tests/interactiveWorkloadGate.test.ts](../../server/tests/interactiveWorkloadGate.test.ts) | 38 | 0 | New TypeScript path; Test |
| A | [server/tests/invBrokerDestroyItem.test.ts](../../server/tests/invBrokerDestroyItem.test.ts) | 97 | 0 | New TypeScript path; Test |
| M | [server/tests/isolatedGameStore.test.js](../../server/tests/isolatedGameStore.test.js) | 38 | 48 | JavaScript with TypeScript counterpart |
| A | [server/tests/isolatedGameStore.test.ts](../../server/tests/isolatedGameStore.test.ts) | 60 | 0 | TypeScript counterpart |
| A | [server/tests/nativeNpcIdentityPersistence.test.ts](../../server/tests/nativeNpcIdentityPersistence.test.ts) | 161 | 0 | New TypeScript path; Test |
| A | [server/tests/nativeNpcPersistence.test.ts](../../server/tests/nativeNpcPersistence.test.ts) | 205 | 0 | New TypeScript path; Test |
| A | [server/tests/npcBehaviorConfig.test.ts](../../server/tests/npcBehaviorConfig.test.ts) | 468 | 0 | New TypeScript path; Test |
| A | [server/tests/npcBehaviorTreeRuntime.test.ts](../../server/tests/npcBehaviorTreeRuntime.test.ts) | 69 | 0 | New TypeScript path; Test |
| A | [server/tests/npcConstructionJobService.test.ts](../../server/tests/npcConstructionJobService.test.ts) | 753 | 0 | New TypeScript path; Test |
| A | [server/tests/npcCreationDraft.test.ts](../../server/tests/npcCreationDraft.test.ts) | 324 | 0 | New TypeScript path; Test |
| A | [server/tests/npcDataCache.test.ts](../../server/tests/npcDataCache.test.ts) | 31 | 0 | New TypeScript path; Test |
| A | [server/tests/npcDecisionTreeScaffolds.test.ts](../../server/tests/npcDecisionTreeScaffolds.test.ts) | 600 | 0 | New TypeScript path; Test |
| A | [server/tests/npcFactionInteractions.test.ts](../../server/tests/npcFactionInteractions.test.ts) | 904 | 0 | New TypeScript path; Test |
| A | [server/tests/npcFittingMgrService.test.ts](../../server/tests/npcFittingMgrService.test.ts) | 651 | 0 | New TypeScript path; Test |
| A | [server/tests/npcFittingService.test.ts](../../server/tests/npcFittingService.test.ts) | 706 | 0 | New TypeScript path; Test |
| A | [server/tests/npcFuelLogistics.test.ts](../../server/tests/npcFuelLogistics.test.ts) | 84 | 0 | New TypeScript path; Test |
| A | [server/tests/npcHeadlessFittingWindow.test.ts](../../server/tests/npcHeadlessFittingWindow.test.ts) | 143 | 0 | New TypeScript path; Test |
| A | [server/tests/npcIdentityAllocation.test.ts](../../server/tests/npcIdentityAllocation.test.ts) | 96 | 0 | New TypeScript path; Test |
| A | [server/tests/npcIndustryJobService.test.ts](../../server/tests/npcIndustryJobService.test.ts) | 362 | 0 | New TypeScript path; Test |
| A | [server/tests/npcManualOrders.test.ts](../../server/tests/npcManualOrders.test.ts) | 59 | 0 | New TypeScript path; Test |
| A | [server/tests/npcNetworkNodeCoordinator.test.ts](../../server/tests/npcNetworkNodeCoordinator.test.ts) | 84 | 0 | New TypeScript path; Test |
| A | [server/tests/npcPhaseZeroPersistence.test.ts](../../server/tests/npcPhaseZeroPersistence.test.ts) | 628 | 0 | New TypeScript path; Test |
| A | [server/tests/npcPilotClientFeed.test.ts](../../server/tests/npcPilotClientFeed.test.ts) | 92 | 0 | New TypeScript path; Test |
| A | [server/tests/npcPilotIdentityStore.test.ts](../../server/tests/npcPilotIdentityStore.test.ts) | 112 | 0 | New TypeScript path; Test |
| A | [server/tests/npcResourceJobService.test.ts](../../server/tests/npcResourceJobService.test.ts) | 568 | 0 | New TypeScript path; Test |
| A | [server/tests/npcStargateMaintenanceService.test.ts](../../server/tests/npcStargateMaintenanceService.test.ts) | 159 | 0 | New TypeScript path; Test |
| A | [server/tests/npcStartupIdentitySlots.test.ts](../../server/tests/npcStartupIdentitySlots.test.ts) | 182 | 0 | New TypeScript path; Test |
| A | [server/tests/npcSupportCoordinator.test.ts](../../server/tests/npcSupportCoordinator.test.ts) | 305 | 0 | New TypeScript path; Test |
| A | [server/tests/npcTaskActionAdapters.test.ts](../../server/tests/npcTaskActionAdapters.test.ts) | 294 | 0 | New TypeScript path; Test |
| A | [server/tests/npcTravelRoute.test.ts](../../server/tests/npcTravelRoute.test.ts) | 104 | 0 | New TypeScript path; Test |
| A | [server/tests/npcTravelService.test.ts](../../server/tests/npcTravelService.test.ts) | 140 | 0 | New TypeScript path; Test |
| A | [server/tests/npcTravelTransition.test.ts](../../server/tests/npcTravelTransition.test.ts) | 140 | 0 | New TypeScript path; Test |
| A | [server/tests/npcTypeSpawnCommand.test.ts](../../server/tests/npcTypeSpawnCommand.test.ts) | 328 | 0 | New TypeScript path; Test |
| A | [server/tests/physicsGunPoseStream.test.ts](../../server/tests/physicsGunPoseStream.test.ts) | 97 | 0 | New TypeScript path; Test |
| A | [server/tests/sceneRefreshDeferredStatics.test.ts](../../server/tests/sceneRefreshDeferredStatics.test.ts) | 68 | 0 | New TypeScript path; Test |
| A | [server/tests/serviceIsolation.test.ts](../../server/tests/serviceIsolation.test.ts) | 97 | 0 | New TypeScript path; Test |
| A | [server/tests/serviceIsolationPhaseThree.test.ts](../../server/tests/serviceIsolationPhaseThree.test.ts) | 48 | 0 | New TypeScript path; Test |
| A | [server/tests/serviceIsolationPhaseTwo.test.ts](../../server/tests/serviceIsolationPhaseTwo.test.ts) | 206 | 0 | New TypeScript path; Test |
| A | [server/tests/serviceTaskPool.test.ts](../../server/tests/serviceTaskPool.test.ts) | 75 | 0 | New TypeScript path; Test |
| A | [server/tests/sessionOutboundDrain.test.ts](../../server/tests/sessionOutboundDrain.test.ts) | 112 | 0 | New TypeScript path; Test |
| A | [server/tests/smartFactionTaskEndpoints.test.ts](../../server/tests/smartFactionTaskEndpoints.test.ts) | 136 | 0 | New TypeScript path; Test |
| A | [server/tests/typeListAuthority.test.js](../../server/tests/typeListAuthority.test.js) | 249 | 0 | JavaScript with TypeScript counterpart |
| A | [server/tests/typeListAuthority.test.ts](../../server/tests/typeListAuthority.test.ts) | 284 | 0 | New TypeScript path; Test |
| A | [server/tests/typescriptRuntime.test.ts](../../server/tests/typescriptRuntime.test.ts) | 138 | 0 | New TypeScript path; Test |
| A | [server/tests/worldShutdown.test.ts](../../server/tests/worldShutdown.test.ts) | 84 | 0 | New TypeScript path; Test |

## tools/BuildTypeScript.bat

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [tools/BuildTypeScript.bat](../../tools/BuildTypeScript.bat) | 4 | 0 | Added file |

## tools/BuildTypeScript.ps1

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [tools/BuildTypeScript.ps1](../../tools/BuildTypeScript.ps1) | 28 | 0 | Added file |

## tools/ClientSETUP

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/ClientSETUP/scripts/Install-EvEJSCerts.ps1](../../tools/ClientSETUP/scripts/Install-EvEJSCerts.ps1) | 3 | 2 | Modified file |
| M | [tools/ClientSETUP/scripts/build-gateway-cert.js](../../tools/ClientSETUP/scripts/build-gateway-cert.js) | 171 | 201 | JavaScript with TypeScript counterpart |
| A | [tools/ClientSETUP/scripts/build-gateway-cert.ts](../../tools/ClientSETUP/scripts/build-gateway-cert.ts) | 233 | 0 | TypeScript counterpart |

## tools/ConfigEditor

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/ConfigEditor/OpenServerConfigV2.ps1](../../tools/ConfigEditor/OpenServerConfigV2.ps1) | 2 | 0 | Modified file |
| M | [tools/ConfigEditor/config-manager-cli.js](../../tools/ConfigEditor/config-manager-cli.js) | 2277 | 2620 | JavaScript with TypeScript counterpart |
| A | [tools/ConfigEditor/config-manager-cli.ts](../../tools/ConfigEditor/config-manager-cli.ts) | 2620 | 0 | TypeScript counterpart |
| M | [tools/ConfigEditor/dockerDeployment.js](../../tools/ConfigEditor/dockerDeployment.js) | 88 | 115 | JavaScript with TypeScript counterpart |
| A | [tools/ConfigEditor/dockerDeployment.ts](../../tools/ConfigEditor/dockerDeployment.ts) | 178 | 0 | TypeScript counterpart |
| M | [tools/ConfigEditor/extract-client-icons.js](../../tools/ConfigEditor/extract-client-icons.js) | 286 | 337 | JavaScript with TypeScript counterpart |
| A | [tools/ConfigEditor/extract-client-icons.ts](../../tools/ConfigEditor/extract-client-icons.ts) | 337 | 0 | TypeScript counterpart |
| M | [tools/ConfigEditor/extract-ui-icons.js](../../tools/ConfigEditor/extract-ui-icons.js) | 62 | 71 | JavaScript with TypeScript counterpart |
| A | [tools/ConfigEditor/extract-ui-icons.ts](../../tools/ConfigEditor/extract-ui-icons.ts) | 88 | 0 | TypeScript counterpart |

## tools/DatabaseCreator

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/DatabaseCreator/CreateDatabase.bat](../../tools/DatabaseCreator/CreateDatabase.bat) | 3 | 0 | Modified file |
| M | [tools/DatabaseCreator/build-scraped-mission-authority.js](../../tools/DatabaseCreator/build-scraped-mission-authority.js) | 8 | 11 | JavaScript with TypeScript counterpart |
| A | [tools/DatabaseCreator/build-scraped-mission-authority.ts](../../tools/DatabaseCreator/build-scraped-mission-authority.ts) | 20 | 0 | TypeScript counterpart |
| M | [tools/DatabaseCreator/database-creator.js](../../tools/DatabaseCreator/database-creator.js) | 3546 | 3720 | JavaScript with TypeScript counterpart |
| A | [tools/DatabaseCreator/database-creator.ts](../../tools/DatabaseCreator/database-creator.ts) | 3831 | 0 | TypeScript counterpart |
| M | [tools/DatabaseCreator/enforce-production-mission-policy.js](../../tools/DatabaseCreator/enforce-production-mission-policy.js) | 111 | 123 | JavaScript with TypeScript counterpart |
| A | [tools/DatabaseCreator/enforce-production-mission-policy.ts](../../tools/DatabaseCreator/enforce-production-mission-policy.ts) | 153 | 0 | TypeScript counterpart |
| M | [tools/DatabaseCreator/production-mission-policy.js](../../tools/DatabaseCreator/production-mission-policy.js) | 447 | 553 | JavaScript with TypeScript counterpart |
| A | [tools/DatabaseCreator/production-mission-policy.ts](../../tools/DatabaseCreator/production-mission-policy.ts) | 553 | 0 | TypeScript counterpart |

## tools/ElysianNpcDogma

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [tools/ElysianNpcDogma/.gitignore](../../tools/ElysianNpcDogma/.gitignore) | 8 | 0 | Added file |
| A | [tools/ElysianNpcDogma/Launch-Elysian-NPC-Dogma.bat](../../tools/ElysianNpcDogma/Launch-Elysian-NPC-Dogma.bat) | 9 | 0 | Added file |
| A | [tools/ElysianNpcDogma/README.md](../../tools/ElysianNpcDogma/README.md) | 31 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/__init__.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/__init__.py) | 17 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/__main__.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/__main__.py) | 21 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/catalog.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/catalog.py) | 514 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/changes.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/changes.py) | 220 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/cli.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/cli.py) | 255 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/deployment.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/deployment.py) | 206 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/models.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/models.py) | 264 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/paths.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/paths.py) | 29 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/presets.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/presets.py) | 100 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/server_projection.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/server_projection.py) | 180 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/ui/__init__.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/ui/__init__.py) | 1 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/ui/app.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/ui/app.py) | 542 | 0 | Added file |
| A | [tools/ElysianNpcDogma/elysian_npc_dogma/validation.py](../../tools/ElysianNpcDogma/elysian_npc_dogma/validation.py) | 258 | 0 | Added file |
| A | [tools/ElysianNpcDogma/pyproject.toml](../../tools/ElysianNpcDogma/pyproject.toml) | 25 | 0 | Added file |
| A | [tools/ElysianNpcDogma/tests/test_workbench.py](../../tools/ElysianNpcDogma/tests/test_workbench.py) | 204 | 0 | Added file |

## tools/Launch-Elysian-NPC-Dogma.bat

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [tools/Launch-Elysian-NPC-Dogma.bat](../../tools/Launch-Elysian-NPC-Dogma.bat) | 4 | 0 | Added file |

## tools/NewEdenStoreEditor

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/NewEdenStoreEditor/StartStoreEditor.bat](../../tools/NewEdenStoreEditor/StartStoreEditor.bat) | 3 | 0 | Modified file |
| M | [tools/NewEdenStoreEditor/build_seed_authority.js](../../tools/NewEdenStoreEditor/build_seed_authority.js) | 923 | 1041 | JavaScript with TypeScript counterpart |
| A | [tools/NewEdenStoreEditor/build_seed_authority.ts](../../tools/NewEdenStoreEditor/build_seed_authority.ts) | 1049 | 0 | TypeScript counterpart |
| M | [tools/NewEdenStoreEditor/build_store_icon_cache.js](../../tools/NewEdenStoreEditor/build_store_icon_cache.js) | 104 | 129 | JavaScript with TypeScript counterpart |
| A | [tools/NewEdenStoreEditor/build_store_icon_cache.ts](../../tools/NewEdenStoreEditor/build_store_icon_cache.ts) | 129 | 0 | TypeScript counterpart |
| M | [tools/NewEdenStoreEditor/editor.js](../../tools/NewEdenStoreEditor/editor.js) | 95 | 122 | JavaScript with TypeScript counterpart |
| A | [tools/NewEdenStoreEditor/editor.ts](../../tools/NewEdenStoreEditor/editor.ts) | 149 | 0 | TypeScript counterpart |
| M | [tools/NewEdenStoreEditor/public/app.js](../../tools/NewEdenStoreEditor/public/app.js) | 172 | 189 | JavaScript with TypeScript counterpart |
| A | [tools/NewEdenStoreEditor/public/app.ts](../../tools/NewEdenStoreEditor/public/app.ts) | 222 | 0 | TypeScript counterpart |

## tools/Setup

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/Setup/Setup-EvEJS.ps1](../../tools/Setup/Setup-EvEJS.ps1) | 8 | 8 | Modified file |

## tools/frontier-client

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [tools/frontier-client/AGENTS.md](../../tools/frontier-client/AGENTS.md) | 5 | 0 | Added file |
| M | [tools/frontier-client/FrontierWindows.Common.psm1](../../tools/frontier-client/FrontierWindows.Common.psm1) | 3 | 0 | Modified file |
| A | [tools/frontier-client/action_bar_compatibility_adapter.py](../../tools/frontier-client/action_bar_compatibility_adapter.py) | 352 | 0 | Added file |
| A | [tools/frontier-client/action_bar_deactivation_adapter.py](../../tools/frontier-client/action_bar_deactivation_adapter.py) | 61 | 0 | Added file |
| A | [tools/frontier-client/action_bar_selection_adapter.py](../../tools/frontier-client/action_bar_selection_adapter.py) | 126 | 0 | Added file |
| A | [tools/frontier-client/asteroid_visual_scale_adapter.py](../../tools/frontier-client/asteroid_visual_scale_adapter.py) | 102 | 0 | Added file |
| A | [tools/frontier-client/blue-pyd.3488090.patch.json](../../tools/frontier-client/blue-pyd.3488090.patch.json) | 69 | 0 | Added file |
| A | [tools/frontier-client/blue-pyd.3502403.patch.json](../../tools/frontier-client/blue-pyd.3502403.patch.json) | 69 | 0 | Added file |
| A | [tools/frontier-client/collision_vfx_compatibility_adapter.py](../../tools/frontier-client/collision_vfx_compatibility_adapter.py) | 88 | 0 | Added file |
| A | [tools/frontier-client/creation_preset_view_adapter.py](../../tools/frontier-client/creation_preset_view_adapter.py) | 577 | 0 | Added file |
| A | [tools/frontier-client/creation_service_compatibility_adapter.py](../../tools/frontier-client/creation_service_compatibility_adapter.py) | 215 | 0 | Added file |
| A | [tools/frontier-client/creation_transform_adapter.py](../../tools/frontier-client/creation_transform_adapter.py) | 357 | 0 | Added file |
| A | [tools/frontier-client/creation_transform_validation_adapter.py](../../tools/frontier-client/creation_transform_validation_adapter.py) | 54 | 0 | Added file |
| A | [tools/frontier-client/dungeon_prop_hologram_adapter.py](../../tools/frontier-client/dungeon_prop_hologram_adapter.py) | 220 | 0 | Added file |
| A | [tools/frontier-client/fitting_compatibility_adapter.py](../../tools/frontier-client/fitting_compatibility_adapter.py) | 1284 | 0 | Added file |
| M | [tools/frontier-client/frontier_windows_client.py](../../tools/frontier-client/frontier_windows_client.py) | 635 | 12 | Modified file |
| A | [tools/frontier-client/industry_storage_adapter.py](../../tools/frontier-client/industry_storage_adapter.py) | 774 | 0 | Added file |
| A | [tools/frontier-client/inventory_view_compatibility_adapter.py](../../tools/frontier-client/inventory_view_compatibility_adapter.py) | 78 | 0 | Added file |
| A | [tools/frontier-client/leap_hint_compatibility_adapter.py](../../tools/frontier-client/leap_hint_compatibility_adapter.py) | 38 | 0 | Added file |
| A | [tools/frontier-client/map_view_lifecycle_adapter.py](../../tools/frontier-client/map_view_lifecycle_adapter.py) | 76 | 0 | Added file |
| A | [tools/frontier-client/map_view_scene_adapter.py](../../tools/frontier-client/map_view_scene_adapter.py) | 26 | 0 | Added file |
| A | [tools/frontier-client/npc_fitting_menu_adapter.py](../../tools/frontier-client/npc_fitting_menu_adapter.py) | 1235 | 0 | Added file |
| A | [tools/frontier-client/npc_primary_action_adapter.py](../../tools/frontier-client/npc_primary_action_adapter.py) | 87 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_asteroid_visual_scale.py](../../tools/frontier-client/patch_frontier_asteroid_visual_scale.py) | 115 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_blue_cache.py](../../tools/frontier-client/patch_frontier_blue_cache.py) | 179 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_collision_vfx.py](../../tools/frontier-client/patch_frontier_collision_vfx.py) | 132 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_creation_transform.py](../../tools/frontier-client/patch_frontier_creation_transform.py) | 189 | 0 | Added file |
| M | [tools/frontier-client/patch_frontier_docking.py](../../tools/frontier-client/patch_frontier_docking.py) | 13 | 1 | Modified file |
| A | [tools/frontier-client/patch_frontier_dungeon_prop_hologram.py](../../tools/frontier-client/patch_frontier_dungeon_prop_hologram.py) | 122 | 0 | Added file |
| M | [tools/frontier-client/patch_frontier_features.py](../../tools/frontier-client/patch_frontier_features.py) | 45 | 2 | Modified file |
| A | [tools/frontier-client/patch_frontier_fitting.py](../../tools/frontier-client/patch_frontier_fitting.py) | 777 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_industry_storage.py](../../tools/frontier-client/patch_frontier_industry_storage.py) | 201 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_inventory.py](../../tools/frontier-client/patch_frontier_inventory.py) | 162 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_map_view.py](../../tools/frontier-client/patch_frontier_map_view.py) | 200 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_physics_gun.py](../../tools/frontier-client/patch_frontier_physics_gun.py) | 122 | 0 | Added file |
| A | [tools/frontier-client/patch_frontier_turret_tracking.py](../../tools/frontier-client/patch_frontier_turret_tracking.py) | 119 | 0 | Added file |
| A | [tools/frontier-client/patch_npc_interaction_stage.py](../../tools/frontier-client/patch_npc_interaction_stage.py) | 163 | 0 | Added file |
| A | [tools/frontier-client/patch_npc_primary_stage.py](../../tools/frontier-client/patch_npc_primary_stage.py) | 136 | 0 | Added file |
| A | [tools/frontier-client/physics_gun_adapter.py](../../tools/frontier-client/physics_gun_adapter.py) | 153 | 0 | Added file |
| A | [tools/frontier-client/physics_gun_interpolation_adapter.py](../../tools/frontier-client/physics_gun_interpolation_adapter.py) | 312 | 0 | Added file |
| A | [tools/frontier-client/reconcile_npc_order_stage.py](../../tools/frontier-client/reconcile_npc_order_stage.py) | 154 | 0 | Added file |
| M | [tools/frontier-client/requirements-windows-frontier.txt](../../tools/frontier-client/requirements-windows-frontier.txt) | 2 | 1 | Modified file |
| A | [tools/frontier-client/skillshot_authority_auto_cannon_adapter.py](../../tools/frontier-client/skillshot_authority_auto_cannon_adapter.py) | 66 | 0 | Added file |
| A | [tools/frontier-client/skillshot_authority_controller_adapter.py](../../tools/frontier-client/skillshot_authority_controller_adapter.py) | 66 | 0 | Added file |
| A | [tools/frontier-client/skillshot_held_beam_charge_adapter.py](../../tools/frontier-client/skillshot_held_beam_charge_adapter.py) | 14 | 0 | Added file |
| A | [tools/frontier-client/test/test_asteroid_visual_scale.py](../../tools/frontier-client/test/test_asteroid_visual_scale.py) | 122 | 0 | Added file |
| A | [tools/frontier-client/test/test_dungeon_prop_hologram.py](../../tools/frontier-client/test/test_dungeon_prop_hologram.py) | 144 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_blue_cache.py](../../tools/frontier-client/test/test_frontier_blue_cache.py) | 155 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_bytecode_profiles.py](../../tools/frontier-client/test/test_frontier_bytecode_profiles.py) | 180 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_collision_vfx.py](../../tools/frontier-client/test/test_frontier_collision_vfx.py) | 255 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_creation_transform.py](../../tools/frontier-client/test/test_frontier_creation_transform.py) | 376 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_fitting_compatibility.py](../../tools/frontier-client/test/test_frontier_fitting_compatibility.py) | 2995 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_industry_blueprint_sync.py](../../tools/frontier-client/test/test_frontier_industry_blueprint_sync.py) | 253 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_industry_job_lanes.py](../../tools/frontier-client/test/test_frontier_industry_job_lanes.py) | 231 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_industry_production_panel.py](../../tools/frontier-client/test/test_frontier_industry_production_panel.py) | 354 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_industry_storage.py](../../tools/frontier-client/test/test_frontier_industry_storage.py) | 469 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_industry_storage_upgrade.py](../../tools/frontier-client/test/test_frontier_industry_storage_upgrade.py) | 277 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_industry_window_reopen.py](../../tools/frontier-client/test/test_frontier_industry_window_reopen.py) | 213 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_inventory_view.py](../../tools/frontier-client/test/test_frontier_inventory_view.py) | 342 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_map_view.py](../../tools/frontier-client/test/test_frontier_map_view.py) | 428 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_skillshot_authority.py](../../tools/frontier-client/test/test_frontier_skillshot_authority.py) | 223 | 0 | Added file |
| A | [tools/frontier-client/test/test_frontier_turret_tracking.py](../../tools/frontier-client/test/test_frontier_turret_tracking.py) | 192 | 0 | Added file |
| M | [tools/frontier-client/test/test_frontier_windows_client.py](../../tools/frontier-client/test/test_frontier_windows_client.py) | 110 | 0 | Modified file |
| A | [tools/frontier-client/test/test_physics_gun_adapter.py](../../tools/frontier-client/test/test_physics_gun_adapter.py) | 70 | 0 | Added file |
| A | [tools/frontier-client/test/test_physics_gun_interpolation.py](../../tools/frontier-client/test/test_physics_gun_interpolation.py) | 181 | 0 | Added file |
| A | [tools/frontier-client/turret_target_tracking_adapter.py](../../tools/frontier-client/turret_target_tracking_adapter.py) | 88 | 0 | Added file |
| M | [tools/frontier-client/verify-frontier-certificates.mjs](../../tools/frontier-client/verify-frontier-certificates.mjs) | 157 | 193 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-client/verify-frontier-certificates.mts](../../tools/frontier-client/verify-frontier-certificates.mts) | 234 | 0 | TypeScript counterpart |

## tools/frontier-contracts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/frontier-contracts/export-frontier-contracts.mjs](../../tools/frontier-contracts/export-frontier-contracts.mjs) | 190 | 260 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-contracts/export-frontier-contracts.mts](../../tools/frontier-contracts/export-frontier-contracts.mts) | 293 | 0 | TypeScript counterpart |
| A | [tools/frontier-contracts/frontier-build.3488090.comparison.json](../../tools/frontier-contracts/frontier-build.3488090.comparison.json) | 163 | 0 | Added file |
| A | [tools/frontier-contracts/frontier-build.3502403.comparison.json](../../tools/frontier-contracts/frontier-build.3502403.comparison.json) | 248 | 0 | Added file |

## tools/frontier-static

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| M | [tools/frontier-static/README.md](../../tools/frontier-static/README.md) | 141 | 15 | Modified file |
| A | [tools/frontier-static/audit-frontier-references.mts](../../tools/frontier-static/audit-frontier-references.mts) | 865 | 0 | New TypeScript path; Source or declaration |
| M | [tools/frontier-static/build-frontier-database.mjs](../../tools/frontier-static/build-frontier-database.mjs) | 330 | 296 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/build-frontier-database.mts](../../tools/frontier-static/build-frontier-database.mts) | 458 | 0 | TypeScript counterpart |
| A | [tools/frontier-static/build-type-list-registry.mjs](../../tools/frontier-static/build-type-list-registry.mjs) | 69 | 0 | Added file |
| M | [tools/frontier-static/discover-frontier-client.mjs](../../tools/frontier-static/discover-frontier-client.mjs) | 72 | 87 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/discover-frontier-client.mts](../../tools/frontier-static/discover-frontier-client.mts) | 99 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/dump_frontier_static.py](../../tools/frontier-static/dump_frontier_static.py) | 5 | 0 | Modified file |
| M | [tools/frontier-static/extract-frontier-static.mjs](../../tools/frontier-static/extract-frontier-static.mjs) | 387 | 327 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/extract-frontier-static.mts](../../tools/frontier-static/extract-frontier-static.mts) | 494 | 0 | TypeScript counterpart |
| A | [tools/frontier-static/extract-industry-static.py](../../tools/frontier-static/extract-industry-static.py) | 105 | 0 | Added file |
| M | [tools/frontier-static/lib/frontier-client-discovery.mjs](../../tools/frontier-static/lib/frontier-client-discovery.mjs) | 285 | 357 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/lib/frontier-client-discovery.mts](../../tools/frontier-static/lib/frontier-client-discovery.mts) | 422 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/lib/frontier-python.mjs](../../tools/frontier-static/lib/frontier-python.mjs) | 327 | 247 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/lib/frontier-python.mts](../../tools/frontier-static/lib/frontier-python.mts) | 440 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/lib/resource-index.mjs](../../tools/frontier-static/lib/resource-index.mjs) | 55 | 67 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/lib/resource-index.mts](../../tools/frontier-static/lib/resource-index.mts) | 84 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/lib/start-ini.mjs](../../tools/frontier-static/lib/start-ini.mjs) | 22 | 25 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/lib/start-ini.mts](../../tools/frontier-static/lib/start-ini.mts) | 31 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/test/client-discovery.test.mjs](../../tools/frontier-static/test/client-discovery.test.mjs) | 110 | 166 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/client-discovery.test.mts](../../tools/frontier-static/test/client-discovery.test.mts) | 194 | 0 | TypeScript counterpart |
| A | [tools/frontier-static/test/client-type-list-oracle.py](../../tools/frontier-static/test/client-type-list-oracle.py) | 93 | 0 | Added file |
| M | [tools/frontier-static/test/contracts-cli.test.mjs](../../tools/frontier-static/test/contracts-cli.test.mjs) | 95 | 41 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/contracts-cli.test.mts](../../tools/frontier-static/test/contracts-cli.test.mts) | 145 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/test/database-profile.test.mjs](../../tools/frontier-static/test/database-profile.test.mjs) | 56 | 41 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/database-profile.test.mts](../../tools/frontier-static/test/database-profile.test.mts) | 96 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/test/extractor-cli.test.mjs](../../tools/frontier-static/test/extractor-cli.test.mjs) | 35 | 69 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/extractor-cli.test.mts](../../tools/frontier-static/test/extractor-cli.test.mts) | 91 | 0 | TypeScript counterpart |
| A | [tools/frontier-static/test/physics-gun.test.mts](../../tools/frontier-static/test/physics-gun.test.mts) | 25 | 0 | New TypeScript path; Test |
| A | [tools/frontier-static/test/reference-audit.test.mts](../../tools/frontier-static/test/reference-audit.test.mts) | 126 | 0 | New TypeScript path; Test |
| M | [tools/frontier-static/test/resource-index.test.mjs](../../tools/frontier-static/test/resource-index.test.mjs) | 25 | 43 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/resource-index.test.mts](../../tools/frontier-static/test/resource-index.test.mts) | 54 | 0 | TypeScript counterpart |
| M | [tools/frontier-static/test/start-ini.test.mjs](../../tools/frontier-static/test/start-ini.test.mjs) | 11 | 14 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/start-ini.test.mts](../../tools/frontier-static/test/start-ini.test.mts) | 32 | 0 | TypeScript counterpart |
| A | [tools/frontier-static/test/type-list-audit.test.mjs](../../tools/frontier-static/test/type-list-audit.test.mjs) | 112 | 0 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/test/type-list-audit.test.mts](../../tools/frontier-static/test/type-list-audit.test.mts) | 131 | 0 | New TypeScript path; Test |
| A | [tools/frontier-static/test/type-list-registry.test.mjs](../../tools/frontier-static/test/type-list-registry.test.mjs) | 24 | 0 | Added file |
| A | [tools/frontier-static/type-list-audit.mjs](../../tools/frontier-static/type-list-audit.mjs) | 187 | 0 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/type-list-audit.mts](../../tools/frontier-static/type-list-audit.mts) | 202 | 0 | New TypeScript path; Source or declaration |
| M | [tools/frontier-static/validate-frontier-static.mjs](../../tools/frontier-static/validate-frontier-static.mjs) | 319 | 402 | JavaScript with TypeScript counterpart |
| A | [tools/frontier-static/validate-frontier-static.mts](../../tools/frontier-static/validate-frontier-static.mts) | 489 | 0 | TypeScript counterpart |

## tools/verifyNpcFactionGasSponsorship.mts

| Status | Path | Added | Deleted | Interpretation |
| --- | --- | ---: | ---: | --- |
| A | [tools/verifyNpcFactionGasSponsorship.mts](../../tools/verifyNpcFactionGasSponsorship.mts) | 93 | 0 | New TypeScript path; Source or declaration |
