# Changes in whatisthisthingdoing001 compared with upstream main

The `whatisthisthingdoing001` branch expands the upstream Frontier emulator with TypeScript builds, build 3502403 client support, a Sui Localnet integration, smart assembly control, production and inventory systems, and substantial Creation, scanning, physics and NPC behavior changes. This report documents the committed differences, separates implementation from plans, and provides complete file, configuration and commit inventories.

## Comparison baseline

Comparison date: **October 18, 2026**.

| Item | Exact reference |
| --- | --- |
| Local checkout | `H:\carbonengine_ef-2\EveJS-Frontier` |
| Upstream repository | [melkordoran/EveJS-Frontier](https://github.com/melkordoran/EveJS-Frontier) |
| Upstream default branch | `main`, verified using `git ls-remote --symref upstream HEAD refs/heads/main` |
| Upstream commit | [`7ca669fa147966c86846d54a0dc82f4826fb7927`](https://github.com/melkordoran/EveJS-Frontier/commit/7ca669fa147966c86846d54a0dc82f4826fb7927), August 21, 2026 |
| Compared local branch | `whatisthisthingdoing001` |
| Branch commit | [`bce53b1baa6bc1e62d7076863dd5454425042a8f`](https://github.com/ProtoDroidBot/EveJS-Frontier/commit/bce53b1baa6bc1e62d7076863dd5454425042a8f), September 24, 2026 |
| Merge base | The upstream commit above |
| Divergence | **67 branch-only commits; zero upstream-only commits** |

The GitHub main commit matched the existing `upstream/main` reference. The baseline is the original repository's main branch; this checkout's separate `main` and `origin/main` point to the fork and were not used. The working tree was clean before this documentation was created.

The detailed descriptions cover the net state at the two pinned commits. The commit appendix also records intermediate commits, including edits later superseded. Ignored client installations, extracted datasets, live databases, local credentials, running chain state and uncommitted/generated files outside the committed trees are outside this comparison. The three newly added submodules are documented by repository, purpose and exact gitlink; their internal histories are not part of the parent repository's diff.

## Size and structure of the changes

| Measure | Count |
| --- | ---: |
| Changed entries with rename detection | **2,551** |
| Added paths | 1,479 |
| Modified paths | 1,060 |
| Renamed paths | 12 |
| Standalone deleted paths | 0 |
| Raw inserted lines | 1,215,801 |
| Raw deleted lines | 560,074 |
| New submodule gitlinks | 3 |

These totals include both TypeScript sources and retained, tracked JavaScript. There are **1,028 added `.ts`/`.mts` paths with same-stem upstream `.js`/`.mjs` counterparts**, **1,031 changed JavaScript/MJS paths with branch TypeScript counterparts**, and **315 additional TypeScript/MTS paths without an upstream same-stem JavaScript counterpart**. These are path classifications, not proofs of semantic equivalence. Among the last group, 161 are test paths. Raw line counts therefore substantially exceed the amount of independent new functionality.

| Location | Diff entries |
| --- | ---: |
| Repository root and submodule pins | 33 |
| `docker/` | 3 |
| `docs/` | 39 |
| `scripts/` | 21 |
| `server/` | 2,289 |
| `tools/` | 166 |

## Functional changes

| Area | Resulting branch behavior | Detailed report |
| --- | --- | --- |
| Build and deployment | TypeScript becomes the editable source; separate server/tools/browser/test builds, source maps, incremental caches, Node version requirements and a Docker compile stage are added. Existing JavaScript entry paths continue to be emitted. | [Build and client tooling](branch-comparison-whatisthisthingdoing001/build-and-client.md) |
| Client compatibility and launchers | Windows defaults advance from 3474408 to 3502403; exact 3488090/3502403 profiles and many compatibility adapters are added. Collision assets become required. The Windows server launcher also builds and manages the Smart Assembly dApp. Build 3502403 remains a candidate rather than a demonstrated complete live release. | [Build and client tooling](branch-comparison-whatisthisthingdoing001/build-and-client.md) |
| Sui world integration | New world lifecycle/sync commands, three pinned submodules, character/NPC provisioning, assembly mirroring, signed transaction journaling, reconciliation and independently identified feature packages connect local game state to a Localnet deployment. | [Frontier and Sui](branch-comparison-whatisthisthingdoing001/frontier-and-sui.md) |
| Assemblies and inventory | Network Node energy/fuel authority, additional storage endpoints, access grants, verified cross-owner custody, durable requests, transponder commitments, construction templates, dismantling and smart turrets extend the upstream assembly implementation. | [Frontier and Sui](branch-comparison-whatisthisthingdoing001/frontier-and-sui.md) |
| Industry and gates | The idle Industry service becomes persisted recipes, inventory escrow and production with independent lanes and chain synchronization. Wallet-authenticated APIs expose storage, energy, industry, gate and faction operations. Paired gates gain synchronization; catapults add one-way system destinations. | [Frontier and Sui](branch-comparison-whatisthisthingdoing001/frontier-and-sui.md) |
| Creation, ship and character systems | Presets, transforms, specialized modules, fitting/runtime attributes, fuel and power accounting, thermal/environmental effects, shell/clone behavior and related client-facing service responses expand. | [Gameplay and NPCs](branch-comparison-whatisthisthingdoing001/gameplay-and-npcs.md) |
| Space simulation | Native collision geometry, contact damage, authoritative skillshots, movable props/Physics Gun, directional/passive/remote scanning, signature events and scene/dungeon lifecycle changes add new simulation behavior. | [Gameplay and NPCs](branch-comparison-whatisthisthingdoing001/gameplay-and-npcs.md) |
| NPCs and authored content | Persistent pilot identities, faction policy, custody and job execution, control/fitting adapters, world bridges, and authored dungeon/landscape spawn and loot configurations expand NPC behavior. Proposed later decision trees remain distinct from registered runtime behavior. | [Gameplay and NPCs](branch-comparison-whatisthisthingdoing001/gameplay-and-npcs.md) |
| Network and persistence | Bounded worker pools move packet codecs and planning work off the main loop; ordered queues, protocol limits and login work deferral are added. Persistence adds new records, queue limits and shutdown hooks. | [Infrastructure](branch-comparison-whatisthisthingdoing001/infrastructure.md) |
| Configuration and documentation | 56 declared settings are added and one existing default changes. Six root policy/content JSON files are added. Twelve documents move from `doc/` to `docs/`, and 27 additional files appear under `docs/`. | [Infrastructure](branch-comparison-whatisthisthingdoing001/infrastructure.md), [configuration inventory](branch-comparison-whatisthisthingdoing001/configuration.md) |

## Operational differences and known gaps

- A fresh checkout now needs recursive submodule initialization and a TypeScript build. Windows normal server startup additionally depends on pnpm and the configured Smart Assembly dApp/world artifacts. The macOS launcher does not acquire equivalent world/dApp orchestration.
- Local gameplay completion and successful chain convergence are separate states. The synchronization code tracks pending/error/confirmed results and retries; committed source does not prove a particular live world has the matching packages or identities deployed.
- `asteroidBeltStartupReset` changes from `true` to `false`. Adaptive ticks are configurable but disabled in the committed configuration. The dApp URL's code default and committed local override differ; the configuration appendix records both.
- Default staging continues to use a separate client copy. New explicitly invoked `sync-base`/`restore-base` and native blue-cache tools can also modify or restore the original client source, as described in the tooling report.
- Existing Industry inventory documentation says production is absent, and the job-lane document describes shared recipes/escrow and lane-1-only chain state. The final implementation has production, independent lane recipes/escrow and lane-state chain synchronization. The older world-sync package count is also outdated.
- Construction-template, NPC decision-tree, prop-health and advanced Physics Gun documents include future scope. The detailed reports identify implemented portions and remaining plans rather than counting the entire design as complete.
- `tools/frontier-static/build-type-list-registry.mjs` still refers to `doc/SDE_TYPELIST_REGISTRY_3502403.json`, while the tracked registry is under `docs/`. Other older documentation links also retain `doc/` references. The NPC Dogma workbench depends on local Elysian sibling tooling that is not tracked in this repository.

## Complete inventories

- [Every changed file](branch-comparison-whatisthisthingdoing001/files.md): all 2,551 diff entries, status, line statistics, moves and migration classifications.
- [Every branch-only commit](branch-comparison-whatisthisthingdoing001/commits.md): all 67 commits, timestamps, recorded subjects and per-commit statistics.
- [Every changed declared setting](branch-comparison-whatisthisthingdoing001/configuration.md): defaults, local overrides, environment variables, descriptions and bounds for all 57 changed configuration entries.
- [Machine-readable inventory](branch-comparison-whatisthisthingdoing001/inventory.json): exact file paths, status, modes, line counts, classifications, comparison commits and history.

## Reproducing and interpreting the comparison

Run these from the repository root to recover the exact underlying diff and history:

```powershell
git diff --stat -M 7ca669fa147966c86846d54a0dc82f4826fb7927 bce53b1baa6bc1e62d7076863dd5454425042a8f
git diff --name-status -M 7ca669fa147966c86846d54a0dc82f4826fb7927 bce53b1baa6bc1e62d7076863dd5454425042a8f
git diff -M 7ca669fa147966c86846d54a0dc82f4826fb7927 bce53b1baa6bc1e62d7076863dd5454425042a8f
git log --reverse --format="%h %aI %s" 7ca669fa147966c86846d54a0dc82f4826fb7927..bce53b1baa6bc1e62d7076863dd5454425042a8f
```

Source references in the reports point to this checkout; the pinned commits above define the snapshot. For migrated modules, compare upstream JavaScript with branch TypeScript to inspect behavioral changes without treating the complete new source file as a newly invented system.

Validation for this documentation checked the remote main SHA, ancestry, complete file/commit enumeration, aggregate diff totals, configuration extraction and local report links. Test files are described as added or expanded coverage; **no application builds, test suites, live client sessions or chain transactions were run for this report**. Runtime behavior descriptions are based on the committed implementation and test source.
