"use strict";

/** The wire schema bundled with Frontier client build 3640684. */
export const EXPLORATION_SCHEMA_VERSION = 14;
export type UniverseId = number | bigint | string;
export type UniverseVector3 = { x: number; y: number; z: number } | readonly number[];
export interface UniverseRecord {
  id: UniverseId;
  [field: string]: unknown;
}
export interface UniverseDeltaInput {
  schemaVersion?: 14;
  bundleVersion: string;
  complete?: boolean;
  sequence?: UniverseId;
  regions?: readonly UniverseRecord[];
  constellations?: readonly UniverseRecord[];
  systems?: readonly UniverseRecord[];
}

/*
 * Field order and widths come from the generated eve.universe.v1 accessors
 * and Add*Slot functions in build 3640684, schema 14 / flatc 25.1.24.
 * code.ccp SHA256: 2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c
 * Array indices below are FlatBuffers field numbers, not byte offsets.
 * Vec3 and GabrielNeighbour are inline structs; all other named types are
 * tables. Keep existing slots intact when adding a future schema version.
 */
const TABLE_FIELDS: Record<string, readonly string[]> = {
  UniverseDelta: [
    "schemaVersion:u16", "bundleVersion:string", "complete:bool", "sequence:u64",
    "regions:Region[]", "constellations:Constellation[]", "systems:SolarSystem[]",
  ],
  Region: [
    "id:u64", "center:Vec3", "nameId:u32", "nebulaId:u32", "factionId:u32",
    "descriptionId:u32", "name:string",
  ],
  Constellation: [
    "id:u64", "regionId:u64", "center:Vec3", "nameId:u32", "factionId:u32", "name:string",
  ],
  SolarSystem: [
    "id:u64", "nameId:u32", "regionId:u64", "constellationId:u64", "center:Vec3",
    "security:f32", "sunTypeId:u32", "radiusM:f64", "revealLevel:u8", "sun:Sun",
    "planets:Planet[]", "asteroidBelts:AsteroidBelt[]", "frostLineM:f64",
    "habitableZoneInnerM:f64", "habitableZoneOuterM:f64", "luminosity:f64",
    "factionId:u32", "descriptionId:u32", "sunFlareGraphicId:u32", "wormholeClassId:u32",
    "visualEffect:u32", "securityClass:string", "fringe:bool", "hub:bool",
    "international:bool", "regional:bool", "border:bool", "corridor:bool",
    "secondarySun:Sun", "celestialScopeFull:bool", "lagrangeScopeFull:bool", "oreScopeFull:bool",
    "exploredCelestialIds:u64[]", "exploredLagrangeIds:u64[]", "exploredOreSiteIds:u64[]",
    "neighbours:u64[]", "stargates:Stargate[]", "gabrielNeighbours:GabrielNeighbour[]",
    "stellarObjects:StellarObject[]", "interacting:string", "name:string", "companionSuns:Sun[]",
    "signalThermalW:f64", "signalEmW:f64", "thermalRung:u8", "emRung:u8", "sunTemperatureK:f64",
  ],
  Sun: [
    "id:u64", "typeId:u32", "radiusM:f64", "spectralClass:string", "luminosity:f64",
    "temperature:f64", "position:Vec3", "effectBeaconTypeId:u32", "kind:string",
    "name:string", "companionIndex:u8",
  ],
  Planet: [
    "id:u64", "typeId:u32", "position:Vec3", "radiusM:f64", "nameId:u32",
    "moons:Moon[]", "lagrangePoints:LagrangePoint[]", "trojans:Trojan[]", "celestialIndex:u32",
    "orbitRadiusM:f64", "orbitPeriodS:f64", "orbitClockwise:bool", "orbitPlaneNormal:Vec3",
    "orbitSemiMajor:Vec3", "orbitSemiMinor:Vec3", "orbitEllipseCenter:Vec3", "spectralClass:string",
    "temperatureK:f64", "shaderPreset:u32", "heightMap1:u32", "heightMap2:u32", "population:bool",
    "typeDescription:string", "hostCelestialId:u64", "name:string",
  ],
  Moon: [
    "id:u64", "typeId:u32", "position:Vec3", "radiusM:f64", "nameId:u32", "orbitRadiusM:f64",
    "orbitPeriodS:f64", "orbitClockwise:bool", "orbitPlaneNormal:Vec3", "orbitSemiMajor:Vec3",
    "orbitSemiMinor:Vec3", "orbitEllipseCenter:Vec3", "miningBeacon:Vec3", "spectralClass:string",
    "temperatureK:f64", "shaderPreset:u32", "heightMap1:u32", "heightMap2:u32", "population:bool",
    "typeDescription:string", "name:string", "orbitIndex:u8",
  ],
  Stargate: [
    "id:u64", "typeId:u32", "position:Vec3", "destinationGateId:u64", "destinationSystemId:u64",
    "planetId:u64", "lagrangePointId:u64",
  ],
  LagrangePoint: ["id:u64", "typeId:u32", "position:Vec3", "pointIndex:u8", "name:string"],
  AsteroidBelt: [
    "id:u64", "typeId:u32", "position:Vec3", "innerPlanetId:u64", "outerPlanetId:u64",
    "innerRadiusM:f64", "outerRadiusM:f64", "nameId:u32", "clusters:AsteroidBeltCluster[]",
    "minorRadiusM:f64", "minorRadiusVerticalM:f64", "centerCelestialId:u64",
  ],
  AsteroidBeltCluster: ["id:u64", "typeId:u32", "position:Vec3", "arcMin:f64", "arcMax:f64", "sites:Site[]"],
  Site: ["id:u64", "typeId:u32", "position:Vec3", "ecosystemId:u32"],
  Trojan: [
    "id:u64", "typeId:u32", "position:Vec3", "lagrangePointId:u64", "controlPoints:Vec3[]",
    "midPoint:Vec3", "sites:Site[]", "planetId:u64",
  ],
  StellarObject: [
    "id:u64", "kind:string", "luminosity:f64", "mass:f64", "separationAu:f64",
    "magneticFieldGauss:f64", "temperature:f64", "companionIndex:u32",
  ],
};

type Field = { name: string; type: string };
const SCHEMA: Record<string, readonly Field[]> = Object.fromEntries(
  Object.entries(TABLE_FIELDS).map(([table, fields]) => [
    table, fields.map((field) => {
      const [name, type] = field.split(":");
      return { name, type };
    }),
  ]),
);
const INLINE: Record<string, { size: number; align: number }> = {
  bool: { size: 1, align: 1 }, u8: { size: 1, align: 1 }, u16: { size: 2, align: 2 },
  u32: { size: 4, align: 4 }, u64: { size: 8, align: 8 },
  f32: { size: 4, align: 4 }, f64: { size: 8, align: 8 },
  Vec3: { size: 24, align: 8 }, GabrielNeighbour: { size: 16, align: 8 },
};
const OFFSET = { size: 4, align: 4 };
const UINT64_MAX = (1n << 64n) - 1n;
// FlatBuffers offsets are 32-bit; this also bounds accidental oversized inputs.
const MAX_BUFFER_BYTES = 0x7fffffff;

function uint64(value: unknown, label: string): bigint {
  let integer: bigint;
  if (typeof value === "bigint") integer = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) integer = BigInt(value);
  else if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) integer = BigInt(value);
  else throw new TypeError(`${label} must be a safe integer, bigint, or unsigned decimal string`);
  if (integer < 0n || integer > UINT64_MAX) throw new RangeError(`${label} is outside uint64`);
  return integer;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function aligned(offset: number, alignment: number): number {
  return Math.ceil(offset / alignment) * alignment;
}

/**
 * A forward FlatBuffer writer. Tables reserve their bodies before emitting
 * referenced objects, so every uoffset points forward; vtables precede tables.
 * This deliberately avoids a dependency on a second generated schema/runtime.
 */
class UniverseBufferWriter {
  private bytes = Buffer.alloc(4096);
  private cursor = 4; // The buffer begins with the root-table uoffset.

  private reserve(size: number, alignment = 1, alignmentBias = 0): number {
    const start = aligned(this.cursor + alignmentBias, alignment) - alignmentBias;
    const end = start + size;
    if (!Number.isSafeInteger(size) || size < 0 || end > MAX_BUFFER_BYTES) {
      throw new RangeError("Universe payload exceeds the FlatBuffer size limit");
    }
    if (end > this.bytes.length) {
      const expanded = Buffer.alloc(Math.min(MAX_BUFFER_BYTES, Math.max(end, this.bytes.length * 2)));
      this.bytes.copy(expanded, 0, 0, this.cursor);
      this.bytes = expanded;
    }
    this.cursor = end;
    return start;
  }

  private inline(type: string, value: unknown, at: number, label: string): void {
    if (type === "Vec3") {
      const vector = Array.isArray(value)
        ? value
        : (() => { const v = record(value, label); return [v.x, v.y, v.z]; })();
      if (vector.length !== 3) throw new TypeError(`${label} must contain exactly three components`);
      vector.forEach((component, i) => this.bytes.writeDoubleLE(finiteNumber(component, `${label}[${i}]`), at + i * 8));
    } else if (type === "GabrielNeighbour") {
      const neighbour = record(value, label);
      this.bytes.writeBigUInt64LE(uint64(neighbour.id, `${label}.id`), at);
      this.bytes.writeDoubleLE(finiteNumber(neighbour.distanceM, `${label}.distanceM`), at + 8);
    } else if (type === "u64") {
      this.bytes.writeBigUInt64LE(uint64(value, label), at);
    } else if (type === "bool") {
      if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
      this.bytes.writeUInt8(value ? 1 : 0, at);
    } else if (type === "f32" || type === "f64") {
      const number = finiteNumber(value, label);
      if (type === "f32") {
        if (!Number.isFinite(Math.fround(number))) throw new RangeError(`${label} is outside Float32`);
        this.bytes.writeFloatLE(number, at);
      } else this.bytes.writeDoubleLE(number, at);
    } else {
      const number = finiteNumber(value, label);
      const size = INLINE[type].size;
      if (!Number.isInteger(number) || number < 0 || number >= 2 ** (size * 8)) {
        throw new RangeError(`${label} is outside ${type}`);
      }
      this.bytes.writeUIntLE(number, at, size);
    }
  }

  private indirect(type: string, value: unknown, label: string): number {
    if (type.endsWith("[]")) {
      if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
      const elementType = type.slice(0, -2);
      const layout = INLINE[elementType] || OFFSET;
      // Vector data, rather than its four-byte length, must have element alignment.
      const at = this.reserve(4 + value.length * layout.size, Math.max(4, layout.align), 4);
      this.bytes.writeUInt32LE(value.length, at);
      value.forEach((element, i) => {
        const slot = at + 4 + i * layout.size;
        const elementLabel = `${label}[${i}]`;
        if (INLINE[elementType]) this.inline(elementType, element, slot, elementLabel);
        else {
          const target = this.indirect(elementType, element, elementLabel);
          this.bytes.writeUInt32LE(target - slot, slot);
        }
      });
      return at;
    }
    if (type === "string") {
      if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
      const text = Buffer.from(value, "utf8");
      const at = this.reserve(4 + text.length + 1, 4);
      this.bytes.writeUInt32LE(text.length, at);
      text.copy(this.bytes, at + 4);
      return at;
    }
    return this.table(type, value, label);
  }

  private table(type: string, value: unknown, label: string): number {
    const data = record(value, label);
    const fields = SCHEMA[type];
    if (!fields) throw new Error(`Unknown universe table ${type}`);
    const allowed = new Set(fields.map((field) => field.name));
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not a schema-14 field`);
    }
    let objectSize = 4;
    let objectAlignment = 4;
    const slots = fields.map((field) => {
      if (data[field.name] === undefined || data[field.name] === null) return 0;
      const layout = INLINE[field.type] || OFFSET;
      objectAlignment = Math.max(objectAlignment, layout.align);
      const slot = aligned(objectSize, layout.align);
      objectSize = slot + layout.size;
      return slot;
    });
    objectSize = aligned(objectSize, objectAlignment);
    const vtableSize = 4 + fields.length * 2;
    const vtable = this.reserve(vtableSize, 2);
    const at = this.reserve(objectSize, objectAlignment);
    this.bytes.writeUInt16LE(vtableSize, vtable);
    this.bytes.writeUInt16LE(objectSize, vtable + 2);
    this.bytes.writeInt32LE(at - vtable, at);
    fields.forEach((field, i) => {
      this.bytes.writeUInt16LE(slots[i], vtable + 4 + i * 2);
      if (!slots[i]) return;
      const slot = at + slots[i];
      const fieldLabel = `${label}.${field.name}`;
      if (INLINE[field.type]) this.inline(field.type, data[field.name], slot, fieldLabel);
      else {
        const target = this.indirect(field.type, data[field.name], fieldLabel);
        this.bytes.writeUInt32LE(target - slot, slot);
      }
    });
    return at;
  }

  finish(value: Record<string, unknown>): Buffer {
    const root = this.table("UniverseDelta", value, "UniverseDelta");
    this.bytes.writeUInt32LE(root, 0);
    return Buffer.from(this.bytes.subarray(0, this.cursor));
  }
}

function sortedRecords(values: readonly UniverseRecord[] | undefined, label: string): UniverseRecord[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const keyed = values.map((value, index) => ({
    value,
    id: uint64(record(value, `${label}[${index}]`).id, `${label}[${index}].id`),
  }));
  keyed.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let i = 1; i < keyed.length; i += 1) {
    if (keyed[i - 1].id === keyed[i].id) throw new TypeError(`${label} contains duplicate ID ${keyed[i].id}`);
  }
  return keyed.map((entry) => entry.value);
}

/** Encode a schema-14 delta without mutating source records or rounding uint64 IDs. */
export function encodeUniverseDelta(input: UniverseDeltaInput): Buffer {
  record(input, "UniverseDelta");
  if (input.schemaVersion !== undefined && input.schemaVersion !== EXPLORATION_SCHEMA_VERSION) {
    throw new RangeError("Only exploration schema version 14 is supported");
  }
  if (typeof input.bundleVersion !== "string" || !input.bundleVersion.length) {
    throw new TypeError("UniverseDelta.bundleVersion must be a nonempty string");
  }
  return new UniverseBufferWriter().finish({
    ...input,
    schemaVersion: EXPLORATION_SCHEMA_VERSION,
    complete: input.complete ?? false,
    sequence: input.sequence ?? 0,
    regions: sortedRecords(input.regions, "regions"),
    constellations: sortedRecords(input.constellations, "constellations"),
    systems: sortedRecords(input.systems, "systems"),
  });
}
