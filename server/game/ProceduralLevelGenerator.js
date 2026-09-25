// server/game/ProceduralLevelGenerator.js - Procedural Dungeon Floor, Biome, RPG-Generator Hex Anomaly & 3D Blender GLB Prop Generator
const LootGenerator = require('./LootGenerator');

const BIOMES = [
  {
    id: 'ossuary_crypt',
    name: 'Sunken Ossuary of Malakor',
    subtitle: 'Ancient Bone Catacombs & Molten Soul-Forges',
    wallTint: 0x2d253b,
    floorTint: 0x3a3447,
    trimTint: 0x6c5a85,
    fogColor: 0x0a0712,
    lightColor: 0xff7722,
    hazardType: 'lava_vent'
  },
  {
    id: 'glacial_sanctum',
    name: 'Frost-Bitten Reliquary',
    subtitle: 'Crystalline Ice Halls & Subzero Rime Winds',
    wallTint: 0x1a2f4a,
    floorTint: 0x243b55,
    trimTint: 0x4da6ff,
    fogColor: 0x071324,
    lightColor: 0x33ccff,
    hazardType: 'frost_geyser'
  },
  {
    id: 'blood_citadel',
    name: 'The Crimson Slaughter-Vault',
    subtitle: 'Sanguine Altars & Cursed Execution Chambers',
    wallTint: 0x3d141e,
    floorTint: 0x2e1118,
    trimTint: 0xff2255,
    fogColor: 0x18050a,
    lightColor: 0xff2244,
    hazardType: 'blood_pool'
  },
  {
    id: 'void_nexus',
    name: 'Astral Rift of the Covenant',
    subtitle: 'Dimensional Echoes & Gravity-Warped Monoliths',
    wallTint: 0x1c1136,
    floorTint: 0x150d2a,
    trimTint: 0xaa33ff,
    fogColor: 0x090414,
    lightColor: 0xb544ff,
    hazardType: 'void_rift'
  },
  {
    id: 'blight_catacombs',
    name: 'Plague-Weep Necropolis',
    subtitle: 'Venomous Spores & Reanimated Abominations',
    wallTint: 0x193320,
    floorTint: 0x14281a,
    trimTint: 0x22ee66,
    fogColor: 0x06140a,
    lightColor: 0x33ff77,
    hazardType: 'poison_mire'
  }
];

// Powered by rpg-generator MCP (ttrgp_hex_elements & ttrgp_campaign_elements)
const HEX_ANOMALIES = [
  {
    id: 'dimensional_echoes',
    name: 'Dimensional Echoes',
    desc: 'Rifts in reality echo every spell cast (+25% Cooldown Haste & +15% Ability Damage).',
    playerHasteBonus: 0.25,
    playerDamageBonus: 0.15,
    mobSpeedMult: 1.05
  },
  {
    id: 'awoken_land',
    name: 'Awoken Land',
    desc: 'The ancient stone chambers pulse with sentience (+30% Max HP to all Heroes & +25% Elite Loot Drops).',
    playerHpBonus: 0.30,
    lootDropBonus: 0.25,
    mobHpMult: 1.15
  },
  {
    id: 'conjuration_backwash',
    name: 'Conjuration Backwash',
    desc: 'Unstable summoning energy floods the crypt (+20% Move Speed & Volatile Void Orbs spawn on kill).',
    playerSpeedBonus: 2.0,
    volatileKills: true,
    mobDamageMult: 1.10
  },
  {
    id: 'blood_moon_surge',
    name: 'Blood Moon Surge',
    desc: 'Frenzied bloodlust empowers all combatants (+35% Attack Power & +15% Lifesteal for all Heroes).',
    playerDamageBonus: 0.35,
    playerLifestealBonus: 0.15,
    mobSpeedMult: 1.12
  },
  {
    id: 'monastic_retreat',
    name: 'Fallen Covenant Monastery',
    desc: 'Ancient martial shrines bless the party (+25% Critical Strike Chance & Sacred Reliquaries spawn).',
    playerCritBonus: 0.25,
    playerDamageBonus: 0.20,
    mobHpMult: 1.10
  },
  {
    id: 'hive_network',
    name: 'Brood-Hive Catacomb Tunnels',
    desc: 'Coordinated tunnel ambushes increase enemy pack density (+40% Bonus XP & Guaranteed Epic Gear Drop).',
    playerHasteBonus: 0.15,
    lootDropBonus: 0.40,
    mobSpeedMult: 1.10
  }
];

const BOSS_VARIANTS = [
  {
    name: 'MALAKOR, THE ASHEN SOVEREIGN',
    title: 'Lord of the Molten Soul-Forge',
    element: 'infernal',
    tint: 0xff4400
  },
  {
    name: 'VAELGOR, THE FROST-CROWNED',
    title: 'Arch-Monarch of the Rime Abyss',
    element: 'frost',
    tint: 0x00ccff
  },
  {
    name: "XAL'KORITH, VOID-WEAVER PRIME",
    title: 'Harbinger of Dimensional Echoes',
    element: 'void',
    tint: 0xaa22ff
  },
  {
    name: 'MORVATH, THE PLAGUE ARCHON',
    title: 'High Hierophant of the Blighted Crypt',
    element: 'blight',
    tint: 0x22ff66
  }
];

const LEVEL_PROP_TYPES = [
  { type: 'covenant_obelisk', modelUrl: '/assets/models/covenant_obelisk.glb', baseScale: 1.15 },
  { type: 'mythic_chest', modelUrl: '/assets/models/mythic_chest.glb', baseScale: 1.25 },
  { type: 'soul_altar', modelUrl: '/assets/models/soul_altar.glb', baseScale: 1.30 },
  { type: 'gothic_pillar_brazier', modelUrl: '/assets/models/gothic_pillar_brazier.glb', baseScale: 1.05 },
  { type: 'arcane_portal_gate', modelUrl: '/assets/models/arcane_portal_gate.glb', baseScale: 1.15 },
  { type: 'bone_reliquary_throne', modelUrl: '/assets/models/bone_reliquary_throne.glb', baseScale: 1.20 },
  { type: 'cursed_sarcophagus', modelUrl: '/assets/models/cursed_sarcophagus.glb', baseScale: 1.20 }
];

class ProceduralLevelGenerator {
  static generate(floorNumber = 1, customSeed = null) {
    return this.generateFloor(floorNumber, customSeed);
  }

  static generateFloor(floorNumber = 1, customSeed = null) {
    const seed = customSeed || Math.floor(100000 + Math.random() * 900000);
    const biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];
    const hexAnomaly = HEX_ANOMALIES[Math.floor(Math.random() * HEX_ANOMALIES.length)];
    const bossVariant = BOSS_VARIANTS[(floorNumber - 1 + Math.floor(Math.random() * BOSS_VARIANTS.length)) % BOSS_VARIANTS.length];

    const scaleMult = 1 + (floorNumber - 1) * 0.28;

    // 1. Generate Procedural Enemy Encounters across all 7 Citadel Wings
    const mobSpawns = [];
    const wingZones = [
      { name: 'Narthex Vanguard', minX: -10, maxX: 10, minZ: 4, maxZ: 12, count: 4 },
      { name: 'Grand Crossroads', minX: -15, maxX: 15, minZ: -22, maxZ: -5, count: 8 },
      { name: 'West Blood Reliquary', minX: -50, maxX: -32, minZ: -24, maxZ: -4, count: 6 },
      { name: 'East Alchemist Vault', minX: 32, maxX: 50, minZ: -24, maxZ: -4, count: 6 },
      { name: 'Antechamber of Chains', minX: -13, maxX: 13, minZ: -54, maxZ: -44, count: 6 }
    ];

    const mobPool = ['skeleton_warrior', 'cultist_archer', 'void_assassin', 'blight_necrolyte'];
    wingZones.forEach((zone) => {
      const total = zone.count + Math.min(4, Math.floor(floorNumber / 2));
      for (let i = 0; i < total; i++) {
        const type = mobPool[Math.floor(Math.random() * mobPool.length)];
        const x = Number((zone.minX + Math.random() * (zone.maxX - zone.minX)).toFixed(1));
        const z = Number((zone.minZ + Math.random() * (zone.maxZ - zone.minZ)).toFixed(1));
        mobSpawns.push({ type, x, z, scaleMult });
      }
    });

    // Always place the two Wing Seal Guardians + bonus procedural Elites on deeper floors
    mobSpawns.push({ type: 'elite_executioner', x: -42, z: -14, scaleMult });
    mobSpawns.push({ type: 'elite_lich', x: 42, z: -14, scaleMult });
    if (floorNumber >= 2) {
      mobSpawns.push({ type: 'elite_executioner', x: -9, z: -49, scaleMult });
      mobSpawns.push({ type: 'elite_lich', x: 9, z: -49, scaleMult });
    }

    // 2. Generate 3D Blender GLB Level Design Props across the map
    const propAnchorSpots = [
      { x: -9, z: 16 },
      { x: 9, z: 16 },
      { x: -12, z: -8 },
      { x: 12, z: -8 },
      { x: 0, z: -14 },
      { x: -12, z: -20 },
      { x: 12, z: -20 },
      { x: -36, z: -8 },
      { x: -48, z: -22 },
      { x: -42, z: -25 },
      { x: 36, z: -8 },
      { x: 48, z: -22 },
      { x: 42, z: -25 },
      { x: -11, z: -48 },
      { x: 11, z: -48 },
      { x: -14, z: -68 },
      { x: 14, z: -68 },
      { x: -14, z: -82 },
      { x: 14, z: -82 },
      { x: 0, z: -86 }
    ];

    const props = propAnchorSpots.map((spot, idx) => {
      const chosen = LEVEL_PROP_TYPES[(idx + Math.floor(Math.random() * LEVEL_PROP_TYPES.length)) % LEVEL_PROP_TYPES.length];
      return {
        id: `proc_prop_${floorNumber}_${idx}`,
        type: chosen.type,
        modelUrl: chosen.modelUrl,
        x: spot.x + Number(((Math.random() - 0.5) * 1.6).toFixed(2)),
        y: 0,
        z: spot.z + Number(((Math.random() - 0.5) * 1.6).toFixed(2)),
        rotY: Number((Math.random() * Math.PI * 2).toFixed(2)),
        scale: Number((chosen.baseScale * (0.9 + Math.random() * 0.25)).toFixed(2))
      };
    });

    // 3. Generate Procedural Floor Loot & Guaranteed Dynamic Gear Drops
    const initialGearDrops = [
      { x: -5, z: 15, item: LootGenerator.generateItem(floorNumber, 'Rare') },
      { x: 5, z: 15, item: LootGenerator.generateItem(floorNumber, 'Epic') },
      { x: -38, z: -18, item: LootGenerator.generateItem(floorNumber + 1, 'Legendary') },
      { x: 38, z: -18, item: LootGenerator.generateItem(floorNumber + 1, 'Legendary') }
    ];

    // 4. Generate Environmental Hazards
    const hazards = [
      { x: -6, z: -12, radius: 3.2, type: biome.hazardType },
      { x: 6, z: -18, radius: 3.2, type: biome.hazardType },
      { x: -36, z: -12, radius: 3.0, type: biome.hazardType },
      { x: 36, z: -12, radius: 3.0, type: biome.hazardType },
      { x: 0, z: -48, radius: 3.4, type: biome.hazardType }
    ];

    return {
      floorNumber,
      floorScale: scaleMult,
      scaleMult,
      seed,
      biome,
      anomaly: hexAnomaly,
      hexAnomaly,
      bossVariant: {
        ...bossVariant,
        maxHp: Math.round(4800 * scaleMult),
        attackDamage: Math.round(45 * scaleMult)
      },
      mobs: mobSpawns,
      mobSpawns,
      props,
      initialGearDrops,
      hazards
    };
  }
}

module.exports = ProceduralLevelGenerator;
