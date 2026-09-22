# SDE typelist catalog — Frontier build 3502403

This is the complete 420-entry catalog from `_local/frontier-sde/3502403/typeLists.jsonl`, regenerated 2026-09-22. Source SHA-256: `adef57d15d4163851a0e0a457d6a4a3de7b3740fba7193681d01f4b3a8d88583`. See [the integration plan](SDE_TYPELIST_INTEGRATION_PLAN.md) for priorities and behavior.

Rule counts are include/exclude for categories (`C`), groups (`G`), types (`T`), and nested typelists (`L`). `tag` is include/exclude/filter counts; `all-tags` denotes `requireAllFilteredTags`. `empty` means the source row has no selection rules, not that its name is unimportant. This table is an inventory, not evidence that each list is enforced by the server.

| ID | SDE name | Source rule counts |
| ---: | --- | --- |
| 4 | ShipyardStructureTargets | empty |
| 6 | BehaviourStructureWeaponModules | G2/0 |
| 7 | BehaviourStructureAOEWeaponModules | G1/0 |
| 8 | BehaviourStructureEWarModules | G5/0 |
| 10 | KillreportEligable | C6/0 G4/0 T2/0 |
| 11 | AllowedInSMACargoholds | C2/0 G5/0 T2/0 |
| 15 | BehaviourStructureAntiLogiEWarModules | G3/0 |
| 18 | FleetEvaluationIsCapital | G4/0 |
| 19 | FleetEvaluationIsFighter | G3/0 |
| 20 | FleetEvaluationIsFleetShip | C1/0 G0/8 |
| 21 | FleetEvaluationFleetWeaponsTurrets | G3/0 |
| 22 | FleetEvaluationFleetWeaponsLaunchers | G8/0 |
| 23 | FleetEvaluationNeutTargetModules | G7/0 |
| 24 | FleetEvaluationIsSubCapital | C1/0 G0/8 |
| 27 | IsPlayerPilotable | C2/0 G0/1 |
| 29 | ResourceWarsPirateEnemies | C2/0 G5/1 |
| 30 | ResourceWarsEmpireEnemies | G4/0 |
| 32 | MiningLaserModules | G2/0 |
| 34 | Asteroids | C1/0 G0/3 |
| 35 | Stargate - Stations - Structures | C1/0 G2/0 |
| 36 | NonTradableItems | C1/0 G1/0 T2/0 |
| 37 | CannotBeAddedToContainer | T1/0 |
| 38 | CannotBeDroppedAsLoot | G1/0 |
| 39 | Ships and Drones - NOT Capsules | C2/0 G0/1 |
| 41 | Ships only - NOT Capsules | C1/0 G0/1 |
| 42 | Player Ships, Drones, Fighters & Structures, NOT Freighters | C4/0 G1/2 |
| 43 | Small AOEs | T3/0 |
| 44 | Medium AOEs | T5/0 |
| 45 | Large AOEs | T5/0 |
| 46 | AoE Point Defense Targets | C3/0 G1/0 T0/4 |
| 48 | Medium Structure AOEs | T2/0 |
| 49 | Large Structure AOEs | T2/0 |
| 50 | Abyssal Filament Proximity Restrictions | C4/0 G7/0 |
| 51 | NPC Entity Drone Targets | C2/0 G0/5 |
| 52 | Mutaplasmid Decayed | T27/0 |
| 53 | Mutaplasmid Abnormal | T6/0 |
| 54 | Mutaplasmid Gravid | T27/0 |
| 55 | Mutaplasmid Unstable | T33/0 |
| 57 | Abyssal Deadspace Solo - Allowed Cruisers | G6/0 |
| 58 | Mobile Warp Disruptor objects | G2/0 |
| 77 | Capital Ships | G6/0 |
| 85 | Soft Penalty | T10/0 |
| 92 | Abyssal Deadspace Fleet - Allowed Frigates | G8/0 |
| 93 | Skills available for purchase | T427/0 |
| 94 | Frigates | G8/0 |
| 95 | Pirate Stronghold Valid Targets | C3/0 G0/1 |
| 124 | Abyssal NPC Valid Targets | C3/0 |
| 125 | Player Ships, Drones & Fighters | C3/1 |
| 126 | Player Ships, Drones & Fighters, NPCs | C3/0 G1/0 |
| 133 | RaffleTypeValidation | C2/0 G1/1 T2/0 |
| 134 | RaffleSingletonValidation | G1/0 |
| 135 | InvalidShipGroupsForRandomJump | G8/0 |
| 136 | Target List for Dreadnought Dungeon Friendly Dreads | T2/0 |
| 137 | Max three turret hardpoints | G6/0 T4/0 |
| 138 | Jita Stations | T5/0 |
| 140 | RenderableTypeIDs | C11/0 G8/15 |
| 142 | Soulbound | T5/0 |
| 143 | Wormholes | G1/0 |
| 144 | Ships/Drones/Fighters - NOT Capsules | C3/0 G0/1 |
| 145 | FittingWarningsShieldGroups | G10/0 |
| 146 | FittingWarningsArmorGroups | G9/0 |
| 147 | FittingWarningsHullGroups | G3/0 |
| 148 | FittingWarningsBuffingModules | G6/0 |
| 149 | Valid High Sec Combat Targets | C1/0 G0/125 |
| 209 | Target List for Invasion NPCs | C4/1 G0/4 |
| 210 | Structure Deployment Avoidance List | C6/0 G9/0 |
| 211 | Invasion 3 Structure Population List | T3/0 |
| 212 | Invasion 3 Mining Structures | T3/0 |
| 213 | Invasion 3 Mining Rig Deployment Pieces | T4/0 |
| 214 | RestrictedForRenaming | C1/0 G11/0 |
| 215 | BasicT1CombatAttackDisruptionCruisers | empty |
| 216 | FittingWarningModulesWithOptionCharges | G14/0 |
| 217 | FittingWarningModulesNeedingCharges | G23/0 |
| 218 | T1DestroyersNoKiki | empty |
| 219 | NavySlicers | empty |
| 220 | Basic T1 Battlecruisers | T1/0 |
| 221 | BasicT1CombatAttackDisruptionFrigates | empty |
| 222 | CaldariT1DessyIntyFactionFrig | empty |
| 223 | AssaultFrigatesIncludingNergalandAT | empty |
| 224 | AttackBattlecruisers | G1/0 |
| 225 | T1CombatAttackDisruptionNavyFrigatesAndT1DessiesNoKiki | empty |
| 227 | FactionandPrecursorBattlecruisers | empty |
| 231 | ESSLinkableShips | G14/0 |
| 232 | BasicCorvettes | empty |
| 233 | Abyssal Deadspace two player- Allowed Destroyers | G4/0 |
| 234 | ESS Encrypted Bonds | T4/0 |
| 236 | T1CombatAndNavyFrigates | empty |
| 238 | BasicT1CombatAttackFrigates | empty |
| 240 | DynamicBountSystemIgnoredTypes | G3/0 |
| 241 | TacticalDestroyers | G1/0 |
| 243 | BasicEmpireAssaultFrigates | empty |
| 244 | BasicInterceptors | G1/0 |
| 245 | WormholeJumpBlacklist | G2/0 |
| 246 | UnusualChargelikesList | T169/0 |
| 247 | Navy Frigates | empty |
| 249 | BasicOreCompressorChargelikes | T2/0 |
| 250 | Allowed Real Item Dungeon Objects | empty |
| 251 | New Player Ship | empty |
| 253 | Mining and Compression Common Ores A1 | T16/0 |
| 254 | Mining and Compression Uncommon Ores A2 | T20/0 |
| 255 | Mining and Compression Rare Ores A3 | T12/0 |
| 256 | Mining and Compression Premium Ores A4 | T14/0 |
| 257 | Mining and Compression Abyssal Ores A5 | T9/0 |
| 258 | Mining and Compression Mercoxit Ores A6 | T3/0 |
| 259 | Mining and Compression Ubiquitous Moon ores B4 | T12/0 |
| 260 | Mining and Compression Common Moon ores B8 | T12/0 |
| 261 | Mining and Compression Uncommon Moon Ores B16 | T12/0 |
| 262 | Mining and Compression Rare Moon Ores B32 | T12/0 |
| 263 | Mining and Compression Exceptional Moon Ores B64 | T12/0 |
| 264 | Compression Low Grade Gases G1 | T8/0 |
| 265 | Compression High Grade Gases G2 | T8/0 |
| 266 | Compression Low Grade Fullerites G3 | T3/0 |
| 267 | Compression Medium Grade Fullerites G4 | T3/0 |
| 268 | Compression High Grade Fullerites G5 | T3/0 |
| 269 | Gnosis | empty |
| 270 | Basic T1 Battleships | empty |
| 271 | Local Armor/Shield Reps | G4/0 |
| 272 | Compression Common Ice I1 | T4/0 |
| 273 | Compression Uncommon Ice I2 | T4/0 |
| 274 | Compression Rare Ice I3 | T4/0 |
| 277 | GallenteCruiserNoExequrorAndAssaultFrigate | empty |
| 278 | Unidentified Hostile Vessels (AIR NPE) | G1/0 |
| 279 | AIR Security Types (AIR NPE) | G1/0 T0/3 |
| 280 | Rifter | empty |
| 281 | Sensor Dampener and Weapon Disruptor Range Scripts | empty |
| 282 | Specific Resistance Hardeners and Rigs | G5/0 |
| 283 | HACs Recons and Pirate Cruisers | G3/0 |
| 284 | Omen | empty |
| 293 | T1DestroyersNoKikiOrSunesis | empty |
| 294 | Caldari Battlecruisers | empty |
| 295 | Damps and Shield Regen Modules/Rigs | G4/0 |
| 296 | Damps, Shield Boost Amps, and Shield Regen Modules/Rigs | G5/0 |
| 298 | NonTrashableItems | T1/0 |
| 300 | LinkWithShip valid ships | G9/0 T1/0 |
| 301 | Kikimora | empty |
| 302 | Damps, Weapon Disruptors, and Specific Resistance Hardeners and Rigs | G7/0 |
| 303 | CRAB npc target typelist | C2/0 |
| 310 | CRAB HostileBaiter scan blockers | G6/0 T0/2 |
| 313 | Shield Regen Modules/Rigs | G3/0 |
| 314 | Key for AEGIS Secure Capital Construction Forges site | T1/0 |
| 315 | Damps, Weapon Disruptors, and Shield Regen Modules/Rigs | G5/0 |
| 316 | Prophecy | empty |
| 318 | Sensor Damps and Weapon Disruptors | G2/0 |
| 319 | AEGIS Capital Ship Security Facility | T1/0 |
| 320 | Sensor Damps | G1/0 |
| 321 | Shield Regen Modules/Rigs, Sensor Dampener/Weapon Disruptor range scripts | G3/0 |
| 322 | BasicT1EmpireCruisers | empty |
| 323 | BasicT1CombatAttackCruisers | empty |
| 324 | Filaments | G4/0 |
| 325 | ExplorationFrigatesAndCovops | empty |
| 327 | BasicExplorationFrigates | empty |
| 329 | Compression ALL RESOURCES Typelist | C1/0 G1/7 T0/79 |
| 330 | Compression ALL Moon Ore | G5/0 |
| 331 | Compression ALL Ice | T14/0 |
| 332 | Compression ALL Gas Types | G1/0 T0/4 |
| 333 | Compression ALL Mercoxit | T4/0 |
| 334 | Compression ALL Asteroid Ore | T70/0 |
| 336 | Compression Structure Allowed | G20/0 |
| 337 | NonContractableItems | C2/0 G7/0 T15/0 |
| 338 | CannotBeUnfitted | empty |
| 339 | Damps, Weapon Disruptors, Shield Regen Modules/Rigs, Boost Amps, Active Tank Rigs, and all T2 Rigs | G6/0 |
| 340 | Venture | empty |
| 341 | Capital Jump Drive Target Beacons | T2/0 |
| 342 | Covert Jump Drive Target Beacons | T5/0 |
| 343 | Industrial Jump Drive Target Beacons | T3/0 |
| 348 | Industrial Jump Drive Target Beacons | T3/0 |
| 349 | everGreenSkinCollectionCrates | T9/0 |
| 350 | Damps, Weapon Disruptors, Shield Boost Amps, and Shield Regen Modules/Rigs | G6/0 |
| 351 | Strategic Cruisers | G1/0 |
| 352 | T3Cs and Command Ships | G2/0 |
| 355 | Stargates | G1/0 |
| 356 | Sunesis | empty |
| 489 | Combat Cruisers and Assault Frigates | empty |
| 490 | Thorax | empty |
| 491 | Athounon Edencom Factory Active | T1/0 |
| 492 | Video Fragments | T126/0 |
| 493 | Minmatar T1 Attack/Combat/Disruption Cruisers | empty |
| 539 | testNewIndustryAngelice | T194/0 |
| 540 | testNewIndustry2 | T1/0 |
| 553 | Boreas | T36/0 |
| 555 | Exclave Regicide Storm Operations | T48/0 |
| 556 | Clan Taranaxas | T38/0 |
| 560 | Clan Mother-I | T30/0 |
| 565 | Synod Fabricator | L28/0 |
| 566 | Notus | T30/0 |
| 567 | Exclave Regicide Assault Operations | T47/0 |
| 568 | Exclave Eyrie Expeditionary Branch | T33/0 |
| 569 | Akrojian Industry | T29/0 |
| 570 | Exclave Eyrie Extraction Branch | T27/0 |
| 572 | NPC Beacon | G1/0 T2/0 |
| 588 | Stargate Gatecamp Typelist | G1/0 |
| 597 | Keep Clonebank Zarquis | T1/0 L14/0 |
| 598 | Starting System - Tower | T13/0 |
| 599 | Minable Asteroids - All | T24/0 |
| 600 | Frontier Minable Megastructure | empty |
| 601 | Frontier Minable Crude Rifts | T4/0 |
| 603 | Clan Kikheros | T30/0 |
| 604 | Clan Saraqael | T30/0 |
| 605 | Clan Rapax | T37/0 |
| 606 | Keep Clonebank Quox | T1/0 L14/0 |
| 607 | Keep Clonebank Astor | T1/0 L14/0 |
| 609 | Synod Advanced Fabricator | L98/0 |
| 612 | Minable Asteroids - T1 | T19/0 |
| 613 | Minable Asteroids - T2 | T20/0 |
| 615 | Osa Reinforcement | T3/0 |
| 616 | Tsikada Reinfrocement  | T3/0 |
| 617 | Termit Reinforcement | T3/0 |
| 618 | Okryda Reinforcements | T3/0 |
| 619 | POC Hackathon Industry list | T14/0 |
| 623 | Grade 0 Generic Manufacturing Industry | tag1/2/1 all-tags |
| 626 | Arctic planets | T2/0 |
| 627 | Inferno planets | T2/0 |
| 628 | Temperate planets | T2/0 |
| 629 | Grade 1 Generic Manufacturing Industry | tag2/2/1 all-tags |
| 635 | Grade 0 Generic Weapons Industry | tag1/2/1 all-tags |
| 636 | Grade 0 Generic Ships Industry | tag1/2/1 all-tags |
| 637 | Grade 0 Generic Defense Industry | tag1/2/1 all-tags |
| 638 | Grade 1 Generic Weapons Industry | tag2/2/1 all-tags |
| 639 | Grade 1 Generic Ships Industry | tag2/2/1 all-tags |
| 640 | Grade 1 Generic Defense Industry | tag2/2/1 all-tags |
| 641 | Grade 1 Generic Tech Industry | tag2/2/1 all-tags |
| 642 | Grade 0 Generic Tech Industry | tag1/2/1 all-tags |
| 643 | Grade 0 Generic Mining Industry | tag1/2/1 all-tags |
| 644 | Grade 1 Generic Mining Industry | tag2/2/1 all-tags |
| 645 | Grade 2 Generic Manufacturing Industry | tag3/2/1 all-tags |
| 646 | Grade 3 Generic Manufacturing Industry | tag4/2/1 all-tags |
| 647 | Grade 4 Generic Manufacturing Industry | tag5/2/1 all-tags |
| 648 | Grade 5 Generic Manufacturing Industry | tag6/2/1 all-tags |
| 649 | Grade 6 Generic Manufacturing Industry | tag7/2/1 all-tags |
| 650 | Grade 2 Generic Weapons Industry | tag3/2/1 all-tags |
| 651 | Grade 3 Generic Weapons Industry | tag4/2/1 all-tags |
| 652 | Grade 4 Generic Weapons Industry | tag5/2/1 all-tags |
| 653 | Grade 5 Generic Weapons Industry | tag6/2/1 all-tags |
| 654 | Grade 6 Generic Weapons Industry | tag7/2/1 all-tags |
| 655 | Grade 2 Generic Ships Industry | tag3/2/1 all-tags |
| 656 | Grade 3 Generic Ships Industry | tag4/2/1 all-tags |
| 657 | Grade 4 Generic Ships Industry | tag5/2/1 all-tags |
| 658 | Grade 5 Generic Ships Industry | tag6/2/1 all-tags |
| 659 | Grade 6 Generic Ships Industry | tag7/2/1 all-tags |
| 660 | Grade 2 Generic Defense Industry | tag3/2/1 all-tags |
| 661 | Grade 3 Generic Defense Industry | tag4/2/1 all-tags |
| 662 | Grade 4 Generic Defense Industry | tag5/2/1 all-tags |
| 663 | Grade 5 Generic Defense Industry | tag6/2/1 all-tags |
| 664 | Grade 6 Generic Defense Industry | tag7/2/1 all-tags |
| 665 | Grade 2 Generic Tech Industry | tag3/2/1 all-tags |
| 666 | Grade 3 Generic Tech Industry | tag4/2/1 all-tags |
| 667 | Grade 4 Generic Tech Industry | tag5/2/1 all-tags |
| 668 | Grade 5 Generic Tech Industry | tag6/2/1 all-tags |
| 669 | Grade 6 Generic Tech Industry | tag7/2/1 all-tags |
| 670 | Grade 2 Generic Mining Industry | tag3/2/1 all-tags |
| 671 | Grade 3 Generic Mining Industry | tag4/2/1 all-tags |
| 672 | Grade 4 Generic Mining Industry | tag5/2/1 all-tags |
| 673 | Grade 5 Generic Mining Industry | tag6/2/1 all-tags |
| 674 | Grade 6 Generic Mining Industry | tag7/2/1 all-tags |
| 675 | Grade 0 Generic Clone Industry | empty |
| 676 | Grade 1 Generic Clone Industry | empty |
| 677 | Grade 2 Generic Clone Industry | empty |
| 678 | Grade 3 Generic Clone Industry | empty |
| 679 | Grade 4 Generic Clone Industry | empty |
| 680 | Grade 5 Generic Clone Industry | empty |
| 681 | Grade 6 Generic Clone Industry | empty |
| 683 | Free Fuel Ships | empty |
| 685 | All Planets | G2/0 |
| 686 | Grade 0 Synod Manufacturing Industry | tag1/0/2 all-tags |
| 687 | Grade 1 Synod Manufacturing Industry | tag2/0/2 all-tags |
| 688 | Grade 2 Synod Manufacturing Industry | tag3/0/2 all-tags |
| 689 | Grade 3 Synod Manufacturing Industry | tag4/0/2 all-tags |
| 690 | Grade 4 Synod Manufacturing Industry | tag5/0/2 all-tags |
| 691 | Grade 5 Synod Manufacturing Industry | tag6/0/2 all-tags |
| 692 | Grade 6 Synod Manufacturing Industry | tag7/0/2 all-tags |
| 693 | Grade 0 Synod Weapons Industry | tag1/0/2 all-tags |
| 694 | Grade 1 Synod Weapons Industry | tag2/0/2 all-tags |
| 695 | Grade 2 Synod Weapons Industry | tag3/0/2 all-tags |
| 696 | Grade 3 Synod Weapons Industry | tag4/0/2 all-tags |
| 697 | Grade 4 Synod Weapons Industry | tag5/0/0 |
| 698 | Grade 5 Synod Weapons Industry | tag6/0/2 all-tags |
| 699 | Grade 6 Synod Weapons Industry | tag7/0/2 all-tags |
| 700 | Grade 0 Synod Ships Industry | tag1/0/2 all-tags |
| 701 | Grade 1 Synod Ships Industry | tag2/0/2 all-tags |
| 702 | Grade 2 Synod Ships Industry | tag3/0/2 all-tags |
| 703 | Grade 3 Synod Ships Industry | tag4/0/2 all-tags |
| 704 | Grade 4 Synod Ships Industry | tag5/0/2 all-tags |
| 705 | Grade 5 Synod Ships Industry | tag6/0/2 all-tags |
| 706 | Grade 6 Synod Ships Industry | tag7/0/2 all-tags |
| 707 | Grade 0 Synod Defense Industry | tag1/0/2 all-tags |
| 708 | Grade 1 Synod Defense Industry | tag2/0/2 all-tags |
| 709 | Grade 2 Synod Defense Industry | tag3/0/2 all-tags |
| 710 | Grade 3 Synod Defense Industry | tag4/0/2 all-tags |
| 711 | Grade 4 Synod Defense Industry | tag5/0/2 all-tags |
| 712 | Grade 5 Synod Defense Industry | tag6/0/2 all-tags |
| 713 | Grade 6 Synod Defense Industry | tag7/0/2 all-tags |
| 714 | _(unnamed)_ | empty |
| 715 | Grade 1 Synod Tech Industry | tag2/0/2 all-tags |
| 716 | Grade 2 Synod Tech Industry | tag3/0/2 all-tags |
| 717 | Grade 3 Synod Tech Industry | tag4/0/2 all-tags |
| 718 | Grade 4 Synod Tech Industry | tag5/0/2 all-tags |
| 719 | Grade 5 Synod Tech Industry | tag6/0/2 all-tags |
| 720 | Grade 6 Synod Tech Industry | tag7/0/2 all-tags |
| 721 | _(unnamed)_ | empty |
| 722 | Grade 1 Synod Mining Industry | tag2/0/2 all-tags |
| 723 | Grade 2 Synod Mining Industry | tag3/0/2 all-tags |
| 724 | Grade 3 Synod Mining Industry | tag4/0/2 all-tags |
| 725 | Grade 4 Synod Mining Industry | tag5/0/2 all-tags |
| 726 | _(unnamed)_ | empty |
| 727 | Grade 6 Synod Mining Industry | tag7/0/2 all-tags |
| 728 | _(unnamed)_ | empty |
| 729 | _(unnamed)_ | empty |
| 730 | _(unnamed)_ | empty |
| 731 | _(unnamed)_ | empty |
| 732 | _(unnamed)_ | empty |
| 733 | _(unnamed)_ | empty |
| 734 | _(unnamed)_ | empty |
| 735 | _(unnamed)_ | empty |
| 736 | _(unnamed)_ | empty |
| 737 | Grade 2 Exclave Manufacturing Industry | tag3/0/2 all-tags |
| 738 | Grade 3 Exclave Manufacturing Industry | tag4/0/2 all-tags |
| 739 | Grade 4 Exclave Manufacturing Industry | tag5/0/2 all-tags |
| 740 | _(unnamed)_ | empty |
| 741 | Grade 6 Exclave Manufacturing Industry | tag7/0/2 all-tags |
| 742 | _(unnamed)_ | empty |
| 743 | Grade 1 Exclave Weapons Industry | tag2/0/2 all-tags |
| 744 | Grade 2 Exclave Weapons Industry | tag3/0/2 all-tags |
| 745 | Grade 3 Exclave Weapons Industry | tag4/0/2 all-tags |
| 746 | Grade 4 Exclave Weapons Industry | tag5/0/2 all-tags |
| 747 | Grade 5 Exclave Weapons Industry | tag6/0/2 all-tags |
| 748 | Grade 6 Exclave Weapons Industry | tag7/0/2 all-tags |
| 749 | _(unnamed)_ | empty |
| 750 | Grade 1 Exclave Ships Industry | tag2/0/2 all-tags |
| 751 | Grade 2 Exclave Ships Industry | tag3/0/2 all-tags |
| 752 | Grade 3 Exclave Ships Industry | tag4/0/2 all-tags |
| 753 | Grade 4 Exclave Ships Industry | tag5/0/2 all-tags |
| 754 | Grade 5 Exclave Ships Industry | tag6/0/2 all-tags |
| 755 | Grade 6 Exclave Ships Industry | tag7/0/2 all-tags |
| 756 | _(unnamed)_ | empty |
| 757 | Grade 1 Exclave Defense Industry | tag2/0/2 all-tags |
| 758 | Grade 2 Exclave Defense Industry | tag3/0/2 all-tags |
| 759 | Grade 3 Exclave Defense Industry | tag4/0/2 all-tags |
| 760 | Grade 4 Exclave Defense Industry | tag5/0/2 all-tags |
| 761 | Grade 5 Exclave Defense Industry | tag6/0/2 all-tags |
| 762 | Grade 6 Exclave Defense Industry | tag7/0/2 all-tags |
| 763 | _(unnamed)_ | empty |
| 764 | _(unnamed)_ | empty |
| 765 | Grade 2 Exclave Tech Industry | tag3/0/2 all-tags |
| 766 | Grade 3 Exclave Tech Industry | tag4/0/2 all-tags |
| 767 | Grade 4 Exclave Tech Industry | tag5/0/2 all-tags |
| 768 | Grade 5 Exclave Tech Industry | tag6/0/2 all-tags |
| 769 | Grade 6 Exclave Tech Industry | tag7/0/2 all-tags |
| 770 | _(unnamed)_ | empty |
| 771 | _(unnamed)_ | empty |
| 772 | _(unnamed)_ | empty |
| 773 | Grade 3 Exclave Mining Industry | tag4/0/2 all-tags |
| 774 | _(unnamed)_ | empty |
| 775 | _(unnamed)_ | empty |
| 776 | Grade 6 Exclave Mining Industry | tag7/0/2 all-tags |
| 777 | _(unnamed)_ | empty |
| 778 | _(unnamed)_ | empty |
| 779 | _(unnamed)_ | empty |
| 780 | _(unnamed)_ | empty |
| 781 | _(unnamed)_ | empty |
| 782 | _(unnamed)_ | empty |
| 783 | _(unnamed)_ | empty |
| 784 | Stations September - Outpost 1 | L21/0 |
| 785 | Stations September - Outpost 2 | L35/0 |
| 786 | Stations September - Exclave Defense | L64/0 |
| 787 | Stations September - Exclave Weapons | L64/0 |
| 788 | Stations September - Exclave HQ | L88/0 |
| 789 | Stations September - Exclave Tech | L66/0 |
| 794 | Frontier New Universe - Keep | T2/0 tag7/1/0 |
| 795 | Frontier New Universe - Exclave | T2/0 tag6/1/0 |
| 798 | Eve Universe - White Star  | T1/0 |
| 802 | Keep | L12/0 |
| 803 | Ukase No.1 | L12/0 |
| 804 | Ukase No.2 | L12/0 |
| 805 | Ochi Boga | L1/0 |
| 806 | Ukase No.3 | L12/0 |
| 807 | Ukase No.4 | L12/0 |
| 808 | Ukase No.5 | L12/0 |
| 809 | Ukase No.6 | L12/0 |
| 810 | Stellar Constructions | L12/0 |
| 811 | Assembly Protocol | L12/0 |
| 812 | Hromada | L6/0 |
| 827 | _(unnamed)_ | T1/0 |
| 835 | Tactical Grid Anchor Lines | C2/0 G1/0 |
| 839 | Engines | G2/0 |
| 845 | Frontier - All Frigates | G4/0 |
| 846 | Frontier - All Cruisers | G2/0 |
| 847 | Frontier - Battleships | G1/0 |
| 848 | Frontier - Destroyer | G1/0 |
| 849 | Frontier - Battlecruiser | G1/0 |
| 850 | Default Bracket Filter | C5/0 G9/0 T10/9 |
| 852 | Build Mode Bracket Filter | C1/0 |
| 860 | Frontier NPC Scannable Targets Test | C4/0 G3/0 |
| 861 | Frontier NPC Lootable Targets Test | G3/0 T1/0 |
| 862 | Frontier NPC Asteroid Target List Test | C1/0 G0/1 |
| 864 | Feral Network Node - Constructable List | empty |
| 906 | Feral Drone General Targets of Interest | C1/0 G5/0 T1/0 |
| 916 | Feral Drone Combat Capable Targets and Player Structures | C2/0 G1/0 |
| 918 | Feral Moon TumorII Favorite TypelList 1 | T1/0 |
| 919 | Feral Moon Tumor Follow TypelList | T7/0 |
| 920 | Feral Moon TumorII Favorite TypelList 2 | T1/0 |
| 921 | Feral Moon Tumor Scannable Types | G3/0 |
| 922 | Brackets Distance based | T1/0 |
| 923 | Conservator Clade Inventory Items of Interest | G4/0 T18/0 |
| 924 | Feal Moon Tumor Exempted items from inspection | T2/0 |
| 931 | Feral Moon Tumor Mining TypeList | G1/0 |
| 935 | Roaming Trader Targets of Interest | T2/0 |
| 938 | Hand-in Terminal Follow TypelList | T1/0 |
| 939 | Portable Assemblies | T4/0 |
| 940 | Xeroti interest items No.1 | T9/0 |
| 941 | Xeroti interest items No.2 | T2/0 |
| 942 | Xeroti interest items No.3 | T1/0 |
| 943 | Xeroti interest items all | T12/0 |
| 957 | Empty Container Exempt List | T2/0 |
| 963 | Conservator Clade Storage Objects | T1/0 |
| 975 | L-Point Anchor Points | T6/0 |
| 976 | Roaming Trader Drone Market List | T11/0 |
| 977 | Large Roaming Trader Drone Market List 1 | T1/0 |
| 982 | Ships and Enemies of Conservator Clade | C1/0 G1/0 |
| 985 | Feral Drone Metamorphosis Targets of Interest | C2/0 G1/0 T0/5 |
| 989 | CreationCriticalModules | G1/0 T1/0 |
