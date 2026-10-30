// Exact, audited source layouts. Missing modern data never opts into a legacy
// schema: both the build identity and its source fingerprints must match.
const MODERN = Object.freeze({
  id: "frontier-modern-v1", collisionBundle: true, creation: true,
  landscape: true, relayConstruction: true, omittedResourceKeys: [] as string[],
  emptyOutputs: [] as string[], unsupportedRuntimeTypeListIDs: [] as number[],
  authoredStarlessSystems: false,
});

const PHASE4 = Object.freeze({
  id: "frontier-phase4-2703993-v1", collisionBundle: false, creation: false,
  landscape: false, relayConstruction: false,
  authoredStarlessSystems: true,
  unsupportedRuntimeTypeListIDs: [861, 923, 985],
  omittedResourceKeys: ["creationHardpointTypes", "creationModules", "creationParts", "creationTemplates", "ecosystems", "landscapes"],
  emptyOutputs: ["creationHardpointTypes.jsonl", "creationModules.jsonl", "creationParts.jsonl", "creationTemplates.jsonl",
    "landscapeDungeonTemplates.jsonl", "landscapeEcosystems.jsonl", "landscapeSites.jsonl"],
});

export const PHASE4_SOURCE_HASHES = Object.freeze({
  codeArchive: "c31d2d4ba8edbd1e15297623dbb6856b6f515376e20b2286da98c20ecda271a9",
  nativeBlue: "bbb482acbd968513107b3755e08e8bb54796d1d498e62034c64e841a17f1aa81",
  index: "7206e372c7c34a4323672a24bb4ab76c81b99158c3e995d821d941aebace2aaf",
});

export function resolveStaticSchema(build: unknown) {
  const numeric = Number(build);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error("Static schema requires an exact positive client build.");
  return numeric === 2703993 ? PHASE4 : MODERN;
}

export function assertStaticSource(build: unknown, source: any) {
  const schema = resolveStaticSchema(build);
  if (schema === PHASE4) {
    for (const [key, expected] of Object.entries(PHASE4_SOURCE_HASHES)) {
      if (source?.[key]?.sha256 !== expected) {
        throw new Error(`Static schema ${schema.id} requires the audited ${key} SHA-256 for build 2703993.`);
      }
    }
  }
  return schema;
}

export function snapshotStaticSchema(manifest: any) {
  const build = manifest?.source?.client?.build;
  const schema = resolveStaticSchema(build);
  if (manifest.schemaProfile !== undefined && manifest.schemaProfile !== schema.id ||
      schema === PHASE4 && manifest.schemaProfile !== schema.id) {
    throw new Error(`Snapshot schema profile does not match exact client build ${build}.`);
  }
  assertStaticSource(build, manifest.source);
  if (!schema.collisionBundle && (manifest.assets?.collisionBundle != null || manifest.source?.collisionBundle != null)) {
    throw new Error("The audited Phase 4 schema has no collision bundle; unexpected collision metadata is rejected.");
  }
  return schema;
}

export function databaseStaticSchema(snapshot: any, database: any) {
  const schema = snapshotStaticSchema(snapshot);
  if (database.build !== snapshot.source.client.build ||
      database.schemaProfile !== undefined && database.schemaProfile !== schema.id ||
      schema === PHASE4 && database.schemaProfile !== schema.id) {
    throw new Error("Generated database schema profile does not match the selected snapshot.");
  }
  if (!schema.collisionBundle && database.assets?.collisionBundle != null) {
    throw new Error("The audited Phase 4 database must not declare a collision bundle.");
  }
  return schema;
}
