"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { encodeUniverseDelta } = require("../src/services/frontier/explorationUniverseEncoder");

// Independent reader: the test uses fixed field numbers checked against the
// build-3640684 generated getters, never the encoder's schema or write helpers.
class WireTable {
  constructor(readonly bytes: Buffer, readonly at = bytes.readUInt32LE(0)) {}

  field(slot: number, size = 4): number {
    const vtable = this.at - this.bytes.readInt32LE(this.at);
    const vtableSize = this.bytes.readUInt16LE(vtable);
    if (4 + slot * 2 >= vtableSize) return 0;
    const relative = this.bytes.readUInt16LE(vtable + 4 + slot * 2);
    if (!relative) return 0;
    assert.ok(relative >= 4 && relative + size <= this.bytes.readUInt16LE(vtable + 2));
    return this.at + relative;
  }

  u64(slot: number): bigint {
    const at = this.field(slot, 8);
    if (!at) return 0n;
    assert.equal(at % 8, 0);
    return this.bytes.readBigUInt64LE(at);
  }

  u32(slot: number): number { const at = this.field(slot); return at ? this.bytes.readUInt32LE(at) : 0; }
  u16(slot: number): number { const at = this.field(slot, 2); return at ? this.bytes.readUInt16LE(at) : 0; }
  u8(slot: number): number { const at = this.field(slot, 1); return at ? this.bytes.readUInt8(at) : 0; }
  f64(slot: number): number {
    const at = this.field(slot, 8);
    if (!at) return 0;
    assert.equal(at % 8, 0);
    return this.bytes.readDoubleLE(at);
  }
  f32(slot: number): number { const at = this.field(slot); return at ? this.bytes.readFloatLE(at) : 0; }

  target(slot: number): number {
    const at = this.field(slot);
    return at ? at + this.bytes.readUInt32LE(at) : 0;
  }

  string(slot: number): string | null {
    const at = this.target(slot);
    if (!at) return null;
    const size = this.bytes.readUInt32LE(at);
    assert.equal(this.bytes[at + 4 + size], 0);
    return this.bytes.toString("utf8", at + 4, at + 4 + size);
  }

  vec3(slot: number): number[] | null {
    const at = this.field(slot, 24);
    if (!at) return null;
    assert.equal(at % 8, 0);
    return [0, 8, 16].map((offset) => this.bytes.readDoubleLE(at + offset));
  }

  child(slot: number): WireTable | null {
    const at = this.target(slot);
    return at ? new WireTable(this.bytes, at) : null;
  }

  tables(slot: number): WireTable[] {
    const at = this.target(slot);
    if (!at) return [];
    return Array.from({ length: this.bytes.readUInt32LE(at) }, (_, i) => {
      const pointer = at + 4 + i * 4;
      return new WireTable(this.bytes, pointer + this.bytes.readUInt32LE(pointer));
    });
  }

  ids(slot: number): bigint[] {
    const at = this.target(slot);
    if (!at) return [];
    assert.equal((at + 4) % 8, 0);
    return Array.from({ length: this.bytes.readUInt32LE(at) }, (_, i) => this.bytes.readBigUInt64LE(at + 4 + i * 8));
  }
}

test("schema14 galaxy records retain uint64 identity, Float64 centers, hierarchy and UTF8 names", () => {
  const center = { x: 9.4607304725808e18, y: -7.123456789012345e17, z: 0.125 };
  const source = {
    bundleVersion: "1.0.0-legacy.3502403",
    complete: true,
    sequence: "18446744073709551615",
    regions: [{ id: 10000001, center, name: "Région 🪐", nebulaId: 123 }],
    constellations: [{ id: 20000001, regionId: 10000001, center, nameId: 456 }],
    systems: [
      { id: "9007199254740993", name: "High ID", center, regionId: 10000001, constellationId: 20000001 },
      { id: 30000001, name: "Alpha", center, security: 0.625, radiusM: 123.456789012345,
        neighbours: ["9007199254740993", "18446744073709551615"], signalThermalW: 1e22, emRung: 7, sunTemperatureK: 4800 },
    ],
  };
  const before = structuredClone(source);
  const root = new WireTable(encodeUniverseDelta(source));
  assert.equal(root.u16(0), 14);
  assert.equal(root.string(1), source.bundleVersion);
  assert.equal(root.u8(2), 1);
  assert.equal(root.u64(3), 18446744073709551615n);
  const region = root.tables(4)[0];
  assert.equal(region.u64(0), 10000001n);
  assert.deepEqual(region.vec3(1), Object.values(center));
  assert.equal(region.u32(3), 123);
  assert.equal(region.string(6), "Région 🪐");
  const constellation = root.tables(5)[0];
  assert.equal(constellation.u64(1), 10000001n);
  assert.deepEqual(constellation.vec3(2), Object.values(center));
  assert.equal(constellation.u32(3), 456);
  const [alpha, high] = root.tables(6);
  assert.equal(alpha.u64(0), 30000001n);
  assert.equal(alpha.string(40), "Alpha");
  assert.equal(alpha.f32(5), 0.625);
  assert.equal(alpha.f64(7), 123.456789012345);
  assert.deepEqual(alpha.ids(35), [9007199254740993n, 18446744073709551615n]);
  assert.equal(alpha.f64(42), 1e22);
  assert.equal(alpha.u8(45), 7);
  assert.equal(alpha.f64(46), 4800);
  assert.equal(high.u64(0), 9007199254740993n);
  assert.equal(high.u64(2), 10000001n);
  assert.equal(high.u64(3), 20000001n);
  assert.deepEqual(high.vec3(4), Object.values(center));
  assert.deepEqual(source, before, "sorting must not mutate the authority's input");
});

test("schema14 local objects use table offsets and inline structs at the client slots", () => {
  const root = new WireTable(encodeUniverseDelta({
    bundleVersion: "1.0.0",
    systems: [{
      id: 30000001, revealLevel: 1, celestialScopeFull: true, lagrangeScopeFull: true, oreScopeFull: false,
      exploredCelestialIds: [40000002], exploredLagrangeIds: [50000001], exploredOreSiteIds: [],
      sun: { id: 40000001, typeId: 8, position: [100, 200, 300], radiusM: 990, kind: "main" },
      secondarySun: { id: 40000007, companionIndex: 1 },
      companionSuns: [{ id: 40000008, companionIndex: 2 }],
      planets: [{ id: 40000002, position: [1e12, -2e12, 3e12], hostCelestialId: 40000001, name: "Planet",
        orbitSemiMajor: [4e12, 0, 0], orbitClockwise: true, population: false,
        moons: [{ id: 40000003, position: [11, 22, 33], miningBeacon: [44, 55, 66], name: "Moon", orbitIndex: 2 }],
        lagrangePoints: [{ id: 50000001, position: [77, 88, 99], pointIndex: 4, name: "L4" }],
        trojans: [{ id: 60000001, controlPoints: [[1, 2, 3], [4, 5, 6]], midPoint: [7, 8, 9],
          sites: [{ id: 70000001, typeId: 37, position: [3, 2, 1], ecosystemId: 42 }] }],
      }],
      stargates: [{ id: 80000001, typeId: 90, position: [101, 202, 303], destinationGateId: 80000002,
        destinationSystemId: 30000002, planetId: 40000002, lagrangePointId: 50000001 }],
      gabrielNeighbours: [{ id: "18446744073709551615", distanceM: 9.87654321012345e18 }],
      asteroidBelts: [{ id: 90000001, centerCelestialId: 40000001, minorRadiusVerticalM: 1234,
        clusters: [{ id: 90000002, arcMin: -0.25, arcMax: 0.75, sites: [{ id: 90000003, ecosystemId: 12 }] }] }],
      stellarObjects: [{ id: 40000001, kind: "star", mass: 2e30, companionIndex: 1234 }],
    }],
  }));
  const system = root.tables(6)[0];
  assert.equal(system.u8(8), 1);
  assert.equal(system.u8(29), 1);
  assert.equal(system.u8(30), 1);
  assert.equal(system.u8(31), 0);
  assert.deepEqual(system.ids(32), [40000002n]);
  assert.deepEqual(system.ids(33), [50000001n]);
  assert.deepEqual(system.ids(34), []);
  assert.equal(system.child(9).u64(0), 40000001n);
  assert.deepEqual(system.child(9).vec3(6), [100, 200, 300]);
  assert.equal(system.child(9).string(8), "main");
  assert.equal(system.child(28).u8(10), 1);
  assert.equal(system.tables(41)[0].u8(10), 2);
  const planet = system.tables(10)[0];
  assert.deepEqual(planet.vec3(2), [1e12, -2e12, 3e12]);
  assert.deepEqual(planet.vec3(13), [4e12, 0, 0]);
  assert.equal(planet.u8(11), 1);
  assert.equal(planet.u8(21), 0);
  assert.equal(planet.u64(23), 40000001n);
  assert.equal(planet.string(24), "Planet");
  const moon = planet.tables(5)[0];
  assert.deepEqual(moon.vec3(12), [44, 55, 66]);
  assert.equal(moon.string(20), "Moon");
  assert.equal(moon.u8(21), 2);
  const lagrange = planet.tables(6)[0];
  assert.deepEqual(lagrange.vec3(2), [77, 88, 99]);
  assert.equal(lagrange.u8(3), 4);
  assert.equal(lagrange.string(4), "L4");
  const trojan = planet.tables(7)[0];
  const controls = trojan.target(4);
  assert.equal((controls + 4) % 8, 0);
  assert.equal(trojan.bytes.readUInt32LE(controls), 2);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => trojan.bytes.readDoubleLE(controls + 4 + i * 8)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(trojan.vec3(5), [7, 8, 9]);
  assert.equal(trojan.tables(6)[0].u32(3), 42);
  const gate = system.tables(36)[0];
  assert.deepEqual(gate.vec3(2), [101, 202, 303]);
  assert.equal(gate.u64(3), 80000002n);
  assert.equal(gate.u64(4), 30000002n);
  const gabriel = system.target(37);
  assert.equal((gabriel + 4) % 8, 0);
  assert.equal(system.bytes.readBigUInt64LE(gabriel + 4), 18446744073709551615n);
  assert.equal(system.bytes.readDoubleLE(gabriel + 12), 9.87654321012345e18);
  const belt = system.tables(11)[0];
  assert.equal(belt.f64(10), 1234);
  assert.equal(belt.u64(11), 40000001n);
  assert.equal(belt.tables(8)[0].f64(3), -0.25);
  assert.equal(belt.tables(8)[0].tables(5)[0].u32(3), 12);
  assert.equal(system.tables(38)[0].f64(3), 2e30);
  assert.equal(system.tables(38)[0].u32(7), 1234);
});

test("absent fields use FlatBuffer defaults and buffers grow without corrupting references", () => {
  const empty = new WireTable(encodeUniverseDelta({ bundleVersion: "1.0.0" }));
  assert.equal(empty.u8(2), 0);
  assert.equal(empty.u64(3), 0n);
  assert.deepEqual(empty.tables(6), []);
  const name = "世界".repeat(700);
  const root = new WireTable(encodeUniverseDelta({
    bundleVersion: "1.0.0", systems: Array.from({ length: 25 }, (_, i) => ({ id: 30000025 - i, name })),
  }));
  const systems = root.tables(6);
  assert.equal(systems.length, 25);
  systems.forEach((system, i) => {
    assert.equal(system.u64(0), BigInt(30000001 + i));
    assert.equal(system.string(40), name);
    assert.equal(system.vec3(4), null);
    assert.equal(system.u8(8), 0);
  });
});

test("rejects lossy identities, duplicate IDs, invalid numeric fields and unsupported field names", () => {
  const encodeSystem = (system) => encodeUniverseDelta({ bundleVersion: "1.0.0", systems: [system] });
  for (const id of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, "18446744073709551616", "1e3", null]) {
    assert.throws(() => encodeSystem({ id }), /uint64|safe integer/);
  }
  assert.throws(() => encodeUniverseDelta({ bundleVersion: "1.0.0", systems: [{ id: 1 }, { id: "1" }] }), /duplicate ID/);
  assert.throws(() => encodeUniverseDelta({ bundleVersion: "1.0.0", schemaVersion: 13 }), /version 14/);
  assert.throws(() => encodeSystem({ id: 1, center: [1, NaN, 3] }), /finite number/);
  assert.throws(() => encodeSystem({ id: 1, center: [1, 2] }), /three components/);
  assert.throws(() => encodeSystem({ id: 1, security: 1e99 }), /Float32/);
  assert.throws(() => encodeSystem({ id: 1, revealLevel: 256 }), /u8/);
  assert.throws(() => encodeSystem({ id: 1, sunTypeId: 2 ** 32 }), /u32/);
  assert.throws(() => encodeSystem({ id: 1, celestialScopeFull: 1 }), /boolean/);
  assert.throws(() => encodeSystem({ id: 1, solarSystemID: 1 }), /schema-14 field/);
  assert.throws(() => encodeSystem({ id: 1, planets: [{ id: 2, moons: [{ id: 3, nameID: 7 }] }] }), /nameID/);
});
