// ============================================================
// Dungeon of the Covenant — Phase 2
// server/game/enemies/Archetypes.js
// Data-driven enemy type table + per-biome variants + floor scaling.
//
// SERVER-AUTHORITATIVE: every number the brain and damage pipeline
// use comes from buildMobStats(). The client only renders.
// ============================================================

'use strict';

// ----------------------------------------------------------------
// Biome normalization
// Server legacy biome ids (ProceduralLevelGenerator.js) map onto the
// four Phase-1 biome languages (client/js/biomes.js LEGACY_BIOME_MAP).
// ----------------------------------------------------------------
const BIOME_IDS = ['crypt', 'cavern', 'forge', 'throne_room'];

const LEGACY_BIOME_MAP = {
  ossuary_crypt: 'crypt',
  glacial_sanctum: 'cavern',
  blood_citadel: 'forge',
  void_nexus: 'throne_room',
  blight_catacombs: 'cavern'
};

function normalizeBiome(biomeId) {
  if (!biomeId) return 'crypt';
  if (BIOME_IDS.includes(biomeId)) return biomeId;
  return LEGACY_BIOME_MAP[biomeId] || 'crypt';
}

// ----------------------------------------------------------------
// Floor-depth scaling (multiplicative, applied after biome mods)
// Floor 1 = baseline. Tuned so a floor-5 pack hits ~1.9x HP / 1.6x DMG.
// ----------------------------------------------------------------
function floorHpScale(floor) {
  const f = Math.max(1, Math.floor(floor || 1));
  return 1 + 0.22 * (f - 1);
}

function floorDmgScale(floor) {
  const f = Math.max(1, Math.floor(floor || 1));
  return 1 + 0.14 * (f - 1);
}

function floorSpeedScale(floor) {
  const f = Math.max(1, Math.floor(floor || 1));
  return Math.min(1.12, 1 + 0.02 * (f - 1));
}

// ----------------------------------------------------------------
// Per-biome variants. prefix -> display name, stat multipliers,
// damage type override and a client reskin tint hint.
// ----------------------------------------------------------------
const BIOME_VARIANTS = {
  crypt: {
    prefix: 'Skeletal',
    tint: 0x9fc8ee,
    damageType: 'cold',
    hpMult: 1.10,
    dmgMult: 1.00,
    speedMult: 1.00,
    flavor: 'Risen from the bone vaults; brittle but relentless.'
  },
  cavern: {
    prefix: 'Crystalline',
    tint: 0x66ddff,
    damageType: 'cold',
    hpMult: 1.00,
    dmgMult: 1.05,
    speedMult: 1.10,
    flavor: 'Shard-infused; strikes fast across the ice.'
  },
  forge: {
    prefix: 'Ember-Infused',
    tint: 0xff7722,
    damageType: 'fire',
    hpMult: 1.05,
    dmgMult: 1.15,
    speedMult: 1.00,
    flavor: 'Superheated in the soul-forges; hits burn.'
  },
  throne_room: {
    prefix: 'Void-Touched',
    tint: 0xaa33ff,
    damageType: 'dark',
    hpMult: 1.15,
    dmgMult: 1.10,
    speedMult: 1.00,
    flavor: 'Whispers of the Covenant cling to it; hardier and crueler.'
  }
};

// ----------------------------------------------------------------
// Archetype table.
// Fields:
//   role          - melee | ranged | swarm | caster | assassin | elite
//   name          - base display name (biome prefix prepended)
//   model         - GLB under client/assets/models/
//   modelScale    - world scale multiplier for the model
//   hp, damage, damageType, speed
//   aggroRange    - acquire target within this radius (m)
//   attackRange   - start windup within this radius (m)
//   desiredRange  - ranged/caster kiters hold this distance (m)
//   attackCooldown- seconds between attacks
//   telegraphMs   - windup time before damage lands (ms)
//   targetPolicy  - nearest | lowest_hp | highest_threat
//   canFlee       - retreat at low HP while still casting
//   stealth       - starts encounters stealthed (assassin)
//   pounce        - blink-strike special (assassin)
//   healAlly      - support heal (caster)
//   burnOnHit     - { duration, dps } ignite rider on melee hits (elite)
// ----------------------------------------------------------------
const ARCHETYPES = {
  skel_warrior: {
    role: 'melee',
    name: 'Skeleton Warrior',
    model: 'enemy_skeleton_warrior.glb',
    modelScale: 1.0,
    hp: 230, damage: 24, damageType: 'physical', speed: 3.4,
    aggroRange: 16, attackRange: 2.2, desiredRange: 1.9,
    attackCooldown: 1.7, telegraphMs: 600,
    targetPolicy: 'highest_threat',
    canFlee: false, stealth: false, pounce: false, healAlly: false
  },
  cultist_archer: {
    role: 'ranged',
    name: 'Cultist Archer',
    model: 'enemy_cultist_archer.glb',
    modelScale: 1.0,
    hp: 150, damage: 26, damageType: 'toxic', speed: 3.0,
    aggroRange: 20, attackRange: 13, desiredRange: 9.0,
    attackCooldown: 2.3, telegraphMs: 700,
    targetPolicy: 'lowest_hp',
    canFlee: false, stealth: false, pounce: false, healAlly: false,
    projectile: { speed: 11.5, radius: 0.38, life: 2.0, color: 0x44ff66 }
  },
  rot_hound: {
    role: 'swarm',
    name: 'Rot Hound',
    model: 'enemy_skeleton_warrior.glb', // pack re-skin of the warrior rig
    modelScale: 0.72,
    hp: 90, damage: 15, damageType: 'physical', speed: 5.2,
    aggroRange: 15, attackRange: 1.8, desiredRange: 1.6,
    attackCooldown: 1.1, telegraphMs: 400,
    targetPolicy: 'nearest',
    canFlee: false, stealth: false, pounce: false, healAlly: false
  },
  blight_necrolyte: {
    role: 'caster',
    name: 'Blight Necrolyte',
    model: 'enemy_blight_necrolyte.glb',
    modelScale: 1.0,
    hp: 175, damage: 30, damageType: 'dark', speed: 3.0,
    aggroRange: 18, attackRange: 11, desiredRange: 8.5,
    attackCooldown: 2.4, telegraphMs: 900,
    targetPolicy: 'nearest',
    canFlee: true, stealth: false, pounce: false, healAlly: true,
    healAmount: 55, healRange: 12.0, healCooldown: 5.2,
    projectile: { speed: 10.5, radius: 0.40, life: 2.2, color: 0xb845ff }
  },
  void_assassin: {
    role: 'assassin',
    name: 'Void Assassin',
    model: 'enemy_void_assassin.glb',
    modelScale: 1.0,
    hp: 195, damage: 34, damageType: 'dark', speed: 5.0,
    aggroRange: 17, attackRange: 2.0, desiredRange: 1.8,
    attackCooldown: 1.9, telegraphMs: 500,
    targetPolicy: 'lowest_hp',
    canFlee: false, stealth: true, pounce: true, healAlly: false,
    pounceRange: 14.0, pounceCooldown: 4.8, pounceCritMult: 1.6,
    stealthBreakRange: 6.0
  },
  elite_executioner: {
    role: 'elite',
    name: 'Elite Executioner',
    model: 'enemy_elite_executioner.glb',
    modelScale: 1.25,
    hp: 950, damage: 42, damageType: 'physical', speed: 3.5,
    aggroRange: 18, attackRange: 2.6, desiredRange: 2.2,
    attackCooldown: 2.2, telegraphMs: 900,
    targetPolicy: 'highest_threat',
    canFlee: false, stealth: false, pounce: false, healAlly: false,
    slamAttack: { radius: 3.8, damageMult: 1.25, cooldown: 6.0, color: 0xff1133 }
  },
  elite_lich: {
    role: 'elite',
    name: 'Elite Lich',
    model: 'enemy_elite_lich.glb',
    modelScale: 1.25,
    hp: 850, damage: 38, damageType: 'cold', speed: 3.1,
    aggroRange: 20, attackRange: 12, desiredRange: 10.0,
    attackCooldown: 2.6, telegraphMs: 1000,
    targetPolicy: 'lowest_hp',
    canFlee: false, stealth: false, pounce: false, healAlly: false,
    volley: { bolts: 3, spread: 0.24, speed: 10.5, radius: 0.42, color: 0x00ddff }
  },
  cinder_thrall: {
    role: 'elite',
    name: 'Cinder Thrall',
    model: 'cinder_thrall.glb',
    modelScale: 1.25,
    hp: 1100, damage: 46, damageType: 'fire', speed: 2.7,
    aggroRange: 18, attackRange: 2.8, desiredRange: 2.4,
    attackCooldown: 2.6, telegraphMs: 1100,
    targetPolicy: 'highest_threat',
    canFlee: false, stealth: false, pounce: false, healAlly: false,
    // Forge burn rider: heavy melee hits ignite the player. duration = how
    // long the burn lasts (s); dps = damage dealt each second while burning.
    // Applied in Room.damagePlayer; ticked in the Room player loop.
    burnOnHit: { duration: 5, dps: 7 }
  }
};

// Legacy mob type ids still emitted by Room.spawnMob today.
// The coordinator migrates spawnMob() onto buildMobStats(); this map
// keeps old ids resolving to the right archetype in the meantime.
// (cinder_thrall used to alias rot_hound; it is now a canonical elite
// archetype, so it resolves from ARCHETYPES directly.)
const LEGACY_TYPE_MAP = {
  crypt_ghoul: 'rot_hound',
  bone_archer: 'cultist_archer',
  void_assassin: 'void_assassin',
  blight_necrolyte: 'blight_necrolyte',
  elite_executioner: 'elite_executioner',
  elite_lich: 'elite_lich'
};

function resolveType(type) {
  if (ARCHETYPES[type]) return type;
  return LEGACY_TYPE_MAP[type] || 'skel_warrior';
}

// ----------------------------------------------------------------
// buildMobStats(type, biomeId, floor) -> fully-scaled stat block.
// This is the single source of truth for spawning.
// ----------------------------------------------------------------
function buildMobStats(type, biomeId, floor) {
  const canonical = resolveType(type);
  const base = ARCHETYPES[canonical];
  const biome = normalizeBiome(biomeId);
  const variant = BIOME_VARIANTS[biome];

  const hp = Math.round(base.hp * variant.hpMult * floorHpScale(floor));
  const damage = Math.round(base.damage * variant.dmgMult * floorDmgScale(floor));
  const speed = +(base.speed * variant.speedMult * floorSpeedScale(floor)).toFixed(2);

  return {
    type: canonical,
    role: base.role,
    name: `${variant.prefix} ${base.name}`,
    baseName: base.name,
    biome,
    biomePrefix: variant.prefix,
    biomeTint: variant.tint,
    model: base.model,
    modelScale: base.modelScale,
    hp,
    maxHp: hp,
    damage,
    damageType: variant.damageType,
    speed,
    aggroRange: base.aggroRange,
    attackRange: base.attackRange,
    desiredRange: base.desiredRange,
    attackCooldown: base.attackCooldown,
    telegraphMs: base.telegraphMs,
    targetPolicy: base.targetPolicy,
    canFlee: base.canFlee,
    stealth: base.stealth,
    pounce: base.pounce,
    healAlly: base.healAlly,
    healAmount: base.healAmount || 0,
    healRange: base.healRange || 0,
    healCooldown: base.healCooldown || 0,
    pounceRange: base.pounceRange || 0,
    pounceCooldown: base.pounceCooldown || 0,
    pounceCritMult: base.pounceCritMult || 1,
    stealthBreakRange: base.stealthBreakRange || 0,
    slamAttack: base.slamAttack ? { ...base.slamAttack } : null,
    volley: base.volley ? { ...base.volley } : null,
    projectile: base.projectile ? { ...base.projectile } : null,
    burnOnHit: base.burnOnHit ? { ...base.burnOnHit } : null,
    floor: Math.max(1, Math.floor(floor || 1))
  };
}

module.exports = {
  BIOME_IDS,
  LEGACY_BIOME_MAP,
  normalizeBiome,
  BIOME_VARIANTS,
  ARCHETYPES,
  LEGACY_TYPE_MAP,
  resolveType,
  floorHpScale,
  floorDmgScale,
  floorSpeedScale,
  buildMobStats
};
