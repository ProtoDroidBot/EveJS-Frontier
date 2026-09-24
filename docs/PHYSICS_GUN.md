# Physics Gun (99999)

Physics Gun is a local copy of Cutting Laser (95317) for Frontier build 3502403. The DatabaseCreator copies the source type and complete type Dogma entry, changes the display name to `Physics Gun`, and adds a `creationModules` adapter with generic weapon behavior on weapon hardpoints. It rejects an upstream SDE collision on type ID 99999.

The server registers 99999 as a laser turret held beam. It uses Cutting Laser's 250 ms spool, effect 12887, charge and mining attributes, first collision routing, and combat damage path. The staged client overlays the native type, Dogma, and Creation module dictionaries; localization message IDs 99999001 and 99999002 supply the Physics Gun name and description; the SkillShot profile points to Cutting Laser's held beam profile.

Rebuild the generated Frontier game store after changing the source snapshot, then sync the generated static tables into the runtime game store through the normal deployment workflow. Patch or upgrade the build 3502403 staged client with `tools/frontier-client/frontier_windows_client.py`; the stage verifier reports `physicsGun: patched`. Existing installed runtime stores need the regenerated `itemTypes`, `typeDogma`, and `creationModules` tables before they can create or fit the item.
