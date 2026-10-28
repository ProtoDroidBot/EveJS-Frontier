# Elysian NPC Dogma Workbench

This tool inventories published, hidden, configured, and spawn-referenced NPC
hulls and safely edits their client `typeDogma` records. It can copy selected
player-ship fitting attributes (fuel, slot counts, CPU, power grid, hardpoints,
rig capacity, durability, navigation, targeting, drones, and fighters) and
selected `dogmaEffects`, including each effect's `isDefault` value.

Run `Launch-Elysian-NPC-Dogma.bat` for the desktop workbench, or use the shared
suite bootstrap:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\ElysianToolSuite\Bootstrap.ps1 -Tool NpcDogma
```

The package also exposes a CLI after bootstrap:

```powershell
python -m elysian_npc_dogma scan --published
python -m elysian_npc_dogma create --target 123 --source 456 --output change.elysiannpcdogma
python -m elysian_npc_dogma validate change.elysiannpcdogma
python -m elysian_npc_dogma diff change.elysiannpcdogma
python -m elysian_npc_dogma compile change.elysiannpcdogma --output .\candidate
python -m elysian_npc_dogma apply change.elysiannpcdogma
python -m elysian_npc_dogma rollback
```

Compilation is gated on native no-op and mutation verification. Apply writes
the client resource and EveJS `typeDogma/data.json` as one owned transaction;
rollback restores both. Restart the EVE client and EveJS server after apply or
rollback.
