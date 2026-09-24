"use strict";

const REFERENCE_MASS_KG = 1_000_000;
const MAX_COLLISION_MASS_KG = 1e15;
const REFERENCE_SPEED_METERS_PER_SECOND = 100;
const DAMAGE_SPEED_FRACTION = 0.5;
const DAMAGE_AT_REFERENCE = positiveNumber(
  process.env.EVEJS_COLLISION_DAMAGE_AT_REFERENCE,
) || 100;
const MAX_DAMAGE_PER_CONTACT = positiveNumber(
  process.env.EVEJS_COLLISION_MAX_DAMAGE_PER_CONTACT,
) || 1_000_000;
const MAX_PUSH_DELTA_SPEED_METERS_PER_SECOND = positiveNumber(
  process.env.EVEJS_COLLISION_MAX_PUSH_DELTA_SPEED,
) || 250;
const CONTACT_REENTRY_COOLDOWN_MS = 750;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function collisionMass(value) {
  const mass = positiveNumber(value);
  return mass !== null && mass < MAX_COLLISION_MASS_KG ? mass : null;
}

function nonnegativeNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function vector(value) {
  return {
    x: Number.isFinite(Number(value && value.x)) ? Number(value.x) : 0,
    y: Number.isFinite(Number(value && value.y)) ? Number(value.y) : 0,
    z: Number.isFinite(Number(value && value.z)) ? Number(value.z) : 0,
  };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function scale(value, amount) {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function add(left, right) {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function collisionPairKey(left, right) {
  const first = String((left && left.itemID) ?? "");
  const second = String((right && right.itemID) ?? "");
  if (!first || !second || first === second) return null;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function calculateCollisionDamage(collision, movingSafeSpeed, candidateSafeSpeed) {
  const impact = collision && collision.impact;
  const movingMass = collisionMass(impact && impact.movingMassKg);
  const candidateImmovable = impact && impact.candidateImmovable === true;
  const candidateMass = candidateImmovable
    ? null
    : collisionMass(impact && impact.candidateMassKg);
  const movingSafe = nonnegativeNumber(movingSafeSpeed);
  const candidateSafe = nonnegativeNumber(candidateSafeSpeed);
  if (
    !impact || collision.startedOverlapping === true ||
    !movingMass || (!candidateImmovable && !candidateMass) ||
    movingSafe === null || candidateSafe === null
  ) {
    return null;
  }
  const normal = vector(collision.normal);
  const normalLength = magnitude(normal);
  if (normalLength <= 0) return null;
  const unitNormal = scale(normal, 1 / normalLength);
  const closingSpeed = Math.max(0, Number(impact.closingSpeedMetersPerSecond) || 0);
  const movingApproachSpeed = Math.max(0,
    -dot(vector(impact.movingVelocity), unitNormal));
  const candidateApproachSpeed = candidateImmovable ? 0 : Math.max(0,
    dot(vector(impact.candidateVelocity), unitNormal));
  // A stationary body contributes no allowance. Each approaching body uses up
  // to half its own stable speed, while retreating motion reduces the actual
  // closing speed before damage is calculated.
  const movingAllowance = Math.min(
    movingApproachSpeed, movingSafe * DAMAGE_SPEED_FRACTION);
  const candidateAllowance = Math.min(
    candidateApproachSpeed, candidateSafe * DAMAGE_SPEED_FRACTION);
  const excessSpeed = Math.max(0,
    closingSpeed - movingAllowance - candidateAllowance);
  if (excessSpeed <= 0) return null;

  const reducedMass = candidateImmovable
    ? movingMass
    : movingMass * candidateMass / (movingMass + candidateMass);
  const total = Math.min(
    MAX_DAMAGE_PER_CONTACT,
    DAMAGE_AT_REFERENCE * (reducedMass / REFERENCE_MASS_KG) *
      (excessSpeed / REFERENCE_SPEED_METERS_PER_SECOND) ** 2,
  );
  if (!Number.isFinite(total) || total <= 0) return null;
  const movingShare = candidateImmovable
    ? total
    : total * candidateMass / (movingMass + candidateMass);
  return {
    total,
    moving: movingShare,
    candidate: candidateImmovable ? 0 : total - movingShare,
    closingSpeed,
    excessSpeed,
    reducedMassKg: reducedMass,
  };
}

function addPushContribution(pushes, recipient, pusher, direction, speed, mass) {
  if (!recipient || !pusher || !collisionMass(mass) || speed <= 0) return;
  const recipientID = String(recipient.itemID ?? "");
  const pusherID = String(pusher.itemID ?? "");
  if (!recipientID || !pusherID || recipientID === pusherID) return;
  let group = pushes.get(recipientID);
  if (!group) {
    group = { recipient, contributors: new Map() };
    pushes.set(recipientID, group);
  }
  const current = group.contributors.get(pusherID);
  if (!current || speed > current.speed) {
    group.contributors.set(pusherID, { pusher, direction, speed, mass });
  }
}

function processCollisionContacts(scene, events, options: Record<string, any> = {}) {
  if (!scene || !Array.isArray(events)) {
    return { damaged: 0, pushed: 0 };
  }
  const tickSequence = Number(options.tickSequence) || 0;
  const nowMs = Number(options.nowMs) || 0;
  const contacts = new Map();
  for (const event of events) {
    const key = collisionPairKey(event && event.mover, event && event.candidate);
    if (!key || !event.collision || !event.collision.impact) continue;
    const existing = contacts.get(key);
    if (!existing ||
        Number(event.collision.impact.closingSpeedMetersPerSecond) >
          Number(existing.collision.impact.closingSpeedMetersPerSecond)) {
      contacts.set(key, event);
    }
  }

  const state = scene._collisionImpactContactState instanceof Map
    ? scene._collisionImpactContactState
    : new Map();
  scene._collisionImpactContactState = state;
  const pushes = new Map();
  let damaged = 0;

  for (const [key, event] of [...contacts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { mover, candidate, collision } = event;
    const impact = collision.impact;
    const normal = vector(collision.normal);
    const normalLength = magnitude(normal);
    if (normalLength <= 0) continue;
    const unitNormal = scale(normal, 1 / normalLength);
    const previous = state.get(key);
    const continuous = previous && previous.lastSeenTick >= tickSequence - 1;
    const cooled = !previous || nowMs - previous.lastDamageAtMs >= CONTACT_REENTRY_COOLDOWN_MS;
    state.set(key, {
      lastSeenTick: tickSequence,
      lastDamageAtMs: previous ? previous.lastDamageAtMs : -Infinity,
    });

    if (!continuous && cooled && typeof options.applyDamage === "function") {
      const movingSafe = options.safeSpeedFor ? options.safeSpeedFor(mover) : 0;
      const candidateSafe = options.safeSpeedFor ? options.safeSpeedFor(candidate) : 0;
      const damage = calculateCollisionDamage(collision, movingSafe, candidateSafe);
      if (damage) {
        if (damage.moving > 0 && options.applyDamage(mover, candidate, damage.moving, event) !== false) {
          damaged += 1;
        }
        if (damage.candidate > 0 && options.applyDamage(candidate, mover, damage.candidate, event) !== false) {
          damaged += 1;
        }
        state.get(key).lastDamageAtMs = nowMs;
      }
    }

    if (collisionMass(impact.movingMassKg) && collisionMass(impact.candidateMassKg) &&
        impact.candidateImmovable !== true &&
        Number(impact.closingSpeedMetersPerSecond) > 0) {
      const movingDirection = scale(unitNormal, -1);
      const movingSpeed = Math.max(0, dot(vector(impact.movingVelocity), movingDirection));
      const candidateSpeed = Math.max(0, dot(vector(impact.candidateVelocity), unitNormal));
      addPushContribution(pushes, candidate, mover, movingDirection,
        movingSpeed, impact.movingMassKg);
      addPushContribution(pushes, mover, candidate, unitNormal,
        candidateSpeed, impact.candidateMassKg);
    }
  }

  let pushed = 0;
  for (const group of pushes.values()) {
    const recipientMass = collisionMass(group.recipient && group.recipient.mass);
    if (!recipientMass || typeof options.applyPush !== "function") continue;
    let massVector = { x: 0, y: 0, z: 0 };
    let momentumVector = { x: 0, y: 0, z: 0 };
    for (const contribution of group.contributors.values()) {
      massVector = add(massVector, scale(contribution.direction, contribution.mass));
      momentumVector = add(momentumVector,
        scale(contribution.direction, contribution.mass * contribution.speed));
    }
    if (magnitude(massVector) + 1e-9 < recipientMass) continue;
    const pushDirection = scale(massVector, 1 / magnitude(massVector));
    const forwardMomentum = Math.max(0, dot(momentumVector, pushDirection));
    const deltaSpeed = Math.min(
      MAX_PUSH_DELTA_SPEED_METERS_PER_SECOND,
      forwardMomentum / recipientMass,
    );
    if (deltaSpeed <= 0) continue;
    if (options.applyPush(group.recipient, scale(pushDirection, deltaSpeed), group) !== false) {
      pushed += 1;
    }
  }

  for (const [key, record] of state) {
    if (record.lastSeenTick < tickSequence - 20) state.delete(key);
  }
  return { damaged, pushed };
}

module.exports = {
  calculateCollisionDamage,
  processCollisionContacts,
};
