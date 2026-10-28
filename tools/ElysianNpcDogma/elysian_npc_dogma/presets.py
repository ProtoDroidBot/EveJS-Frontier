from __future__ import annotations


CORE_ATTRIBUTE_NAMES = (
    "fuelCapacity",
    "hiSlots",
    "medSlots",
    "lowSlots",
    "engineSlots",
    "rigSlots",
    "powerOutput",
    "cpuOutput",
    "launcherSlotsLeft",
    "turretSlotsLeft",
    "upgradeCapacity",
    "upgradeSlotsLeft",
)

ATTRIBUTE_PRESETS = {
    "Core fitting": CORE_ATTRIBUTE_NAMES,
    "Durability": (
        "hp",
        "shieldCapacity",
        "armorHP",
        "shieldRechargeRate",
        "shieldEmDamageResonance",
        "shieldThermalDamageResonance",
        "shieldKineticDamageResonance",
        "shieldExplosiveDamageResonance",
        "armorEmDamageResonance",
        "armorThermalDamageResonance",
        "armorKineticDamageResonance",
        "armorExplosiveDamageResonance",
        "emDamageResonance",
        "thermalDamageResonance",
        "kineticDamageResonance",
        "explosiveDamageResonance",
    ),
    "Capacitor": ("capacitorCapacity", "rechargeRate"),
    "Navigation": (
        "mass",
        "agility",
        "maxVelocity",
        "signatureRadius",
        "warpSpeedMultiplier",
    ),
    "Targeting": (
        "maxTargetRange",
        "maxLockedTargets",
        "scanResolution",
        "scanRadarStrength",
        "scanLadarStrength",
        "scanMagnetometricStrength",
        "scanGravimetricStrength",
    ),
    "Drone and fighter": (
        "droneCapacity",
        "droneBandwidth",
        "fighterCapacity",
        "fighterTubes",
        "fighterLightSlots",
        "fighterSupportSlots",
        "fighterHeavySlots",
    ),
}

INTEGER_ATTRIBUTE_NAMES = frozenset(
    {
        "hiSlots",
        "medSlots",
        "lowSlots",
        "engineSlots",
        "rigSlots",
        "launcherSlotsLeft",
        "turretSlotsLeft",
        "upgradeSlotsLeft",
        "maxLockedTargets",
        "fighterTubes",
        "fighterLightSlots",
        "fighterSupportSlots",
        "fighterHeavySlots",
    }
)

NON_NEGATIVE_ATTRIBUTE_NAMES = frozenset(
    name for names in ATTRIBUTE_PRESETS.values() for name in names
)


EFFECT_ATTRIBUTE_FIELDS = (
    "dischargeAttributeID",
    "durationAttributeID",
    "rangeAttributeID",
    "falloffAttributeID",
    "trackingSpeedAttributeID",
    "resistanceAttributeID",
    "fittingUsageChanceAttributeID",
    "npcUsageChanceAttributeID",
    "npcActivationChanceAttributeID",
)
