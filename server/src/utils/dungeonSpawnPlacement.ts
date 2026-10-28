const DEFAULT_DUNGEON_SPAWN_SEPARATION_METERS = 6_000;
const DEFAULT_DUNGEON_SPAWN_SEARCH_SLOTS = 16;
const DEFAULT_DUNGEON_SPAWN_SEARCH_RINGS = 64;

function toFiniteNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function clonePosition(value, fallback: Record<string, any> = {}) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toFiniteNumber(source && source.x, 0),
    y: toFiniteNumber(source && source.y, 0),
    z: toFiniteNumber(source && source.z, 0),
  };
}

function hashText(value) {
  const text = String(value == null ? "" : value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizeOccupiedPosition(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const position = value.position && typeof value.position === "object"
    ? value.position
    : value;
  return {
    position: clonePosition(position),
    radius: Math.max(
      0,
      toFiniteNumber(value.radius ?? value.collisionRadius, 0),
    ),
  };
}

function positionsAreSeparated(candidate, occupiedPositions, options: Record<string, any> = {}) {
  const candidatePosition = clonePosition(candidate);
  const minimumSeparationMeters = Math.max(
    1,
    toFiniteNumber(
      options.minimumSeparationMeters,
      DEFAULT_DUNGEON_SPAWN_SEPARATION_METERS,
    ),
  );
  const candidateRadius = Math.max(0, toFiniteNumber(options.candidateRadius, 0));
  for (const rawOccupied of Array.isArray(occupiedPositions) ? occupiedPositions : []) {
    const occupied = normalizeOccupiedPosition(rawOccupied);
    if (!occupied) {
      continue;
    }
    const requiredDistance = minimumSeparationMeters + candidateRadius + occupied.radius;
    const dx = candidatePosition.x - occupied.position.x;
    const dy = candidatePosition.y - occupied.position.y;
    const dz = candidatePosition.z - occupied.position.z;
    if ((dx * dx) + (dy * dy) + (dz * dz) < requiredDistance * requiredDistance) {
      return false;
    }
  }
  return true;
}

function buildSeparatedSpawnPosition(desiredPosition, occupiedPositions, options: Record<string, any> = {}) {
  const desired = clonePosition(desiredPosition);
  if (positionsAreSeparated(desired, occupiedPositions, options)) {
    return desired;
  }

  const minimumSeparationMeters = Math.max(
    1,
    toFiniteNumber(
      options.minimumSeparationMeters,
      DEFAULT_DUNGEON_SPAWN_SEPARATION_METERS,
    ),
  );
  const slotsPerRing = Math.max(
    4,
    Math.trunc(toFiniteNumber(options.slotsPerRing, DEFAULT_DUNGEON_SPAWN_SEARCH_SLOTS)),
  );
  const maxRings = Math.max(
    1,
    Math.trunc(toFiniteNumber(options.maxRings, DEFAULT_DUNGEON_SPAWN_SEARCH_RINGS)),
  );
  const phase = (hashText(options.seed) / 0x1_0000_0000) * Math.PI * 2;
  for (let ring = 1; ring <= maxRings; ring += 1) {
    const radius = minimumSeparationMeters * ring;
    for (let slot = 0; slot < slotsPerRing; slot += 1) {
      const angle = phase + ((Math.PI * 2 * slot) / slotsPerRing);
      const verticalBand = ((slot + ring) % 3) - 1;
      const candidate = {
        x: desired.x + (Math.cos(angle) * radius),
        y: desired.y + (verticalBand * minimumSeparationMeters * 0.35),
        z: desired.z + (Math.sin(angle) * radius),
      };
      if (positionsAreSeparated(candidate, occupiedPositions, options)) {
        return candidate;
      }
    }
  }

  // The bounded search is deliberately deterministic. If every nearby slot
  // is occupied, move beyond the union of all occupied clearance spheres.
  // The triangle inequality makes this terminal position collision-safe even
  // for unusually large authored structures or asteroid props.
  const candidateRadius = Math.max(0, toFiniteNumber(options.candidateRadius, 0));
  let terminalDistance = minimumSeparationMeters * (maxRings + 1);
  for (const rawOccupied of Array.isArray(occupiedPositions) ? occupiedPositions : []) {
    const occupied = normalizeOccupiedPosition(rawOccupied);
    if (!occupied) {
      continue;
    }
    const dx = desired.x - occupied.position.x;
    const dy = desired.y - occupied.position.y;
    const dz = desired.z - occupied.position.z;
    terminalDistance = Math.max(
      terminalDistance,
      Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)) +
        minimumSeparationMeters + candidateRadius + occupied.radius + 1,
    );
  }
  return {
    x: desired.x + terminalDistance,
    y: desired.y,
    z: desired.z,
  };
}

module.exports = {
  DEFAULT_DUNGEON_SPAWN_SEPARATION_METERS,
  buildSeparatedSpawnPosition,
  clonePosition,
  positionsAreSeparated,
};
