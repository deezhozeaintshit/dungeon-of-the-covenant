// biomes.js - Themed biome room templates for Dungeon of the Covenant.
//
// Pure data + seeded assignment logic (no THREE dependency), so the level
// generator and the client prop placer share one source of truth for the
// four biome languages: CRYPT, CAVERN, FORGE, THRONE_ROOM.
//
// Each template defines:
//   - geometry set (prop placement rules)
//   - material palette key (floorStyle, used by the canvas texture painter)
//   - lighting mood (ambient/hemisphere/accent colors)
//   - fog color + density (THREE.FogExp2)
//   - particle language (dust / embers / ash / motes)
//   - torch flame language
//
// No two biomes share a prop or material language.

// ---------------------------------------------------------------- seeded RNG
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- templates
export const BIOME_TEMPLATES = {
  crypt: {
    id: 'crypt',
    name: 'The Sunken Crypt',
    subtitle: 'Bone vaults & cold blue mist',
    floorStyle: 'crypt',
    fog: { color: 0x0a1626, density: 0.030 },
    mood: {
      ambient: 0x33465e, ambientIntensity: 0.55,
      hemiSky: 0x5a7a9a, hemiGround: 0x0b0906, hemiIntensity: 0.4,
      accent: 0x77ccff, torchLight: 0x66aaff
    },
    particles: { kind: 'dust', color: 0x9fc8ee, count: 150, size: 0.13, speed: 0.35, rise: false },
    torch: { flame: 0x88ccff, light: 0x77bbff },
    props: [
      { type: 'sarcophagus', min: 2, max: 4, placement: 'perimeter', radius: 1.8 },
      { type: 'bone_pile', min: 2, max: 5, placement: 'scatter', radius: 1.0 },
      { type: 'crypt_pillar', min: 2, max: 4, placement: 'corners', radius: 1.1 },
      { type: 'torch', min: 3, max: 5, placement: 'wall', radius: 0.5 },
      { type: 'altar', min: 0, max: 1, placement: 'center', radius: 1.6 },
      { type: 'rubble', min: 2, max: 4, placement: 'scatter', radius: 0.9 }
    ]
  },

  cavern: {
    id: 'cavern',
    name: 'The Ember Cavern',
    subtitle: 'Rough rock & ember-orange underlight',
    floorStyle: 'cavern',
    fog: { color: 0x160d05, density: 0.034 },
    mood: {
      ambient: 0x5e3a22, ambientIntensity: 0.5,
      hemiSky: 0x8a5a2a, hemiGround: 0x0d0805, hemiIntensity: 0.4,
      accent: 0xff8833, torchLight: 0xff9540
    },
    particles: { kind: 'ash', color: 0xd88a4a, count: 170, size: 0.15, speed: 0.5, rise: true },
    torch: { flame: 0xffaa44, light: 0xff9540 },
    props: [
      { type: 'stalagmite', min: 3, max: 6, placement: 'scatter', radius: 1.0 },
      { type: 'stalactite_cluster', min: 2, max: 4, placement: 'ceiling', radius: 1.2 },
      { type: 'rock_spire', min: 1, max: 3, placement: 'corners', radius: 1.3 },
      { type: 'ember_vent', min: 2, max: 4, placement: 'scatter', radius: 1.1 },
      { type: 'torch', min: 2, max: 4, placement: 'wall', radius: 0.5 },
      { type: 'rubble', min: 3, max: 6, placement: 'scatter', radius: 0.9 }
    ]
  },

  forge: {
    id: 'forge',
    name: 'The Soul-Forge',
    subtitle: 'Anvils, lava channels & hanging chains',
    floorStyle: 'forge',
    fog: { color: 0x1a0a04, density: 0.030 },
    mood: {
      ambient: 0x6e3418, ambientIntensity: 0.55,
      hemiSky: 0x9a5a22, hemiGround: 0x100603, hemiIntensity: 0.42,
      accent: 0xff6622, torchLight: 0xff7722
    },
    particles: { kind: 'embers', color: 0xff8844, count: 190, size: 0.12, speed: 1.1, rise: true },
    torch: { flame: 0xff8822, light: 0xff7722 },
    props: [
      { type: 'anvil', min: 1, max: 3, placement: 'scatter', radius: 1.2 },
      { type: 'lava_channel', min: 2, max: 3, placement: 'floor_strip', radius: 2.6 },
      { type: 'hanging_chain', min: 3, max: 6, placement: 'ceiling', radius: 0.5 },
      { type: 'crucible', min: 1, max: 2, placement: 'perimeter', radius: 1.2 },
      { type: 'torch', min: 2, max: 4, placement: 'wall', radius: 0.5 },
      { type: 'rubble', min: 2, max: 4, placement: 'scatter', radius: 0.9 }
    ]
  },

  throne_room: {
    id: 'throne_room',
    name: 'The Covenant Throne Room',
    subtitle: 'Grand pillars, banners & braziers',
    floorStyle: 'throne',
    fog: { color: 0x0d0a16, density: 0.022 },
    mood: {
      ambient: 0x4a3d5e, ambientIntensity: 0.6,
      hemiSky: 0x8a76aa, hemiGround: 0x0d0a08, hemiIntensity: 0.42,
      accent: 0xd4af37, torchLight: 0xffcc66
    },
    particles: { kind: 'motes', color: 0xd4b86a, count: 130, size: 0.11, speed: 0.3, rise: false },
    torch: { flame: 0xffcc55, light: 0xffcc66 },
    props: [
      { type: 'throne', min: 0, max: 1, placement: 'far_wall', radius: 2.2 },
      { type: 'grand_pillar', min: 2, max: 4, placement: 'aisle', radius: 1.2 },
      { type: 'banner', min: 2, max: 4, placement: 'wall', radius: 0.6 },
      { type: 'brazier', min: 2, max: 4, placement: 'perimeter', radius: 0.9 },
      { type: 'chest', min: 0, max: 1, placement: 'corners', radius: 1.0 },
      { type: 'torch', min: 2, max: 4, placement: 'wall', radius: 0.5 }
    ]
  }
};

export const BIOME_IDS = Object.keys(BIOME_TEMPLATES);

// Legacy server biome ids (server/game/ProceduralLevelGenerator.js, do not touch)
// mapped onto the new template languages.
export const LEGACY_BIOME_MAP = {
  ossuary_crypt: 'crypt',
  glacial_sanctum: 'cavern',
  blood_citadel: 'forge',
  void_nexus: 'throne_room',
  blight_catacombs: 'cavern'
};

export function resolveBiomeTemplate(id) {
  if (BIOME_TEMPLATES[id]) return BIOME_TEMPLATES[id];
  const mapped = LEGACY_BIOME_MAP[id] || 'crypt';
  return BIOME_TEMPLATES[mapped];
}

// ---------------------------------------------------------------- citadel zones
// Fixed citadel rooms from DungeonBuilder.buildDungeon(), treated as the
// procedural "room graph" leaves. Coordinates match buildDungeon() exactly.
export const ZONE_DEFS = [
  {
    key: 'atrium', name: 'Covenant Atrium', role: 'spawn',
    bounds: { minX: -14, maxX: 14, minZ: 10, maxZ: 28 },
    preferred: ['throne_room', 'crypt'],
    neighbors: ['narthex']
  },
  {
    key: 'narthex', name: 'Narthex Passage', role: 'corridor',
    bounds: { minX: -5, maxX: 5, minZ: -2, maxZ: 10 },
    preferred: ['cavern', 'crypt'],
    neighbors: ['atrium', 'crossroads']
  },
  {
    key: 'crossroads', name: 'Grand Crossroads', role: 'hub',
    bounds: { minX: -18, maxX: 18, minZ: -26, maxZ: -2 },
    preferred: BIOME_IDS,
    neighbors: ['narthex', 'west', 'east', 'bridge']
  },
  {
    key: 'west', name: 'West Wing', role: 'wing',
    bounds: { minX: -54, maxX: -30, minZ: -28, maxZ: 0 },
    preferred: BIOME_IDS,
    neighbors: ['crossroads']
  },
  {
    key: 'east', name: 'East Wing', role: 'wing',
    bounds: { minX: 30, maxX: 54, minZ: -28, maxZ: 0 },
    preferred: BIOME_IDS,
    neighbors: ['crossroads']
  },
  {
    key: 'bridge', name: 'Abyssal Bridge', role: 'corridor',
    bounds: { minX: -6, maxX: 6, minZ: -42, maxZ: -26 },
    preferred: ['forge', 'cavern'],
    neighbors: ['crossroads', 'antechamber']
  },
  {
    key: 'antechamber', name: 'Antechamber of Chains', role: 'wing',
    bounds: { minX: -16, maxX: 16, minZ: -56, maxZ: -42 },
    preferred: BIOME_IDS,
    neighbors: ['bridge', 'sanctum']
  },
  {
    key: 'sanctum', name: 'Soul-Forge Sanctum', role: 'boss',
    bounds: { minX: -24, maxX: 24, minZ: -92, maxZ: -56 },
    preferred: ['forge', 'throne_room'],
    neighbors: ['antechamber']
  }
];

// Global keep-out spots: {x, z, r} circles and {x1,z1,x2,z2} rects.
// Pillars (must match server/game/Collision.js 1-to-1), rune circles,
// fountains, GLB prop anchors, doorways, lava rivers. Props never spawn here.
export const KEEP_OUTS = [
  // Pillars
  ...[
    [-7, 19], [7, 19],
    [-9, -8], [9, -8], [-9, -20], [9, -20],
    [-38, -7], [-38, -21],
    [38, -7], [38, -21],
    [-9, -49], [9, -49],
    [-14, -64], [14, -64], [-14, -84], [14, -84]
  ].map(([x, z]) => ({ x, z, r: 1.9 })),
  // Rune circles / mosaics / summoning circle
  { x: 0, z: 16, r: 4.8 }, { x: 0, z: -14, r: 6.4 },
  { x: -49, z: -14, r: 3.8 }, { x: 49, z: -14, r: 3.8 },
  { x: 0, z: -75, r: 9.2 },
  // Fountains / restoration wells
  { x: 0, z: 23.5, r: 2.6 }, { x: -11, z: -49, r: 2.6 }, { x: 11, z: -49, r: 2.6 },
  // Fixed citadel set dressing
  { x: -36, z: -25.5, r: 2.2 }, { x: -44, z: -25.5, r: 2.2 },
  { x: -36, z: -2.5, r: 2.2 }, { x: -44, z: -2.5, r: 2.2 },
  { x: 36, z: -25.5, r: 2.2 }, { x: 44, z: -25.5, r: 2.2 },
  { x: 36, z: -2.5, r: 2.2 }, { x: 44, z: -2.5, r: 2.2 },
  // GLB prop anchors (loadDefaultBlenderProps / server propAnchorSpots)
  { x: -8, z: 16, r: 2.0 }, { x: 8, z: 16, r: 2.0 },
  { x: 0, z: 24, r: 2.6 }, { x: 0, z: -14, r: 2.6 },
  { x: -12, z: -8, r: 2.0 }, { x: 12, z: -8, r: 2.0 },
  { x: -46, z: -14, r: 3.0 }, { x: -38, z: -8, r: 2.0 },
  { x: -42, z: -25, r: 2.6 }, { x: 42, z: -25, r: 2.6 },
  { x: 46, z: -14, r: 2.6 },
  { x: -12, z: -72, r: 2.0 }, { x: 12, z: -72, r: 2.0 },
  { x: 0, z: -84, r: 3.0 }, { x: 0, z: -86, r: 2.0 },
  // Doorways (walkable, keep clear)
  ...[
    [0, 10], [0, -2], [0, -26], [-18, -14], [18, -14],
    [-30, -14], [30, -14], [0, -42], [0, -56]
  ].map(([x, z]) => ({ x, z, r: 3.0 })),
  // Sanctum lava rivers (rects)
  { x1: -23.5, z1: -90, x2: -20.5, z2: -58 },
  { x1: 20.5, z1: -90, x2: 23.5, z2: -58 },
  { x1: -22, z1: -91, x2: 22, z2: -88 },
  // Bridge lava chasms (rects)
  { x1: -25, z1: -41.5, x2: -7, z2: -26.5 },
  { x1: 7, z1: -41.5, x2: 25, z2: -26.5 }
];

// Seeded per-zone biome assignment. Adjacent zones never share a biome,
// spawn/boss zones honor their preferred lists, and the result varies
// per floor seed while staying deterministic for a given seed.
// themeId (optional): the floor's mapped server biome template id. Zones that
// list it as preferred adopt it ~55% of the time, so the server biome reads
// as the floor's visual theme without making every zone identical.
export function assignZoneBiomes(seed, themeId = null) {
  const rng = mulberry32(hashSeed(seed));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const assigned = new Map(); // zoneKey -> templateId

  const neighborBiome = (zone) => {
    for (const n of zone.neighbors) {
      if (assigned.has(n)) return assigned.get(n);
    }
    return null;
  };

  // Assign in dependency order: spawn first, then outward, boss last.
  const order = ['atrium', 'narthex', 'crossroads', 'west', 'east', 'bridge', 'antechamber', 'sanctum'];
  for (const key of order) {
    const zone = ZONE_DEFS.find((z) => z.key === key);
    const banned = neighborBiome(zone);
    // Theme bias: the floor's mapped server biome wins where it fits (~55%),
    // so the server biome reads as the floor's visual theme.
    if (themeId && BIOME_TEMPLATES[themeId] && zone.preferred.includes(themeId) && themeId !== banned && rng() < 0.55) {
      assigned.set(key, themeId);
      continue;
    }
    const candidates = zone.preferred.filter((b) => b !== banned);
    const pool = candidates.length > 0 ? candidates : zone.preferred.filter((b) => b !== banned);
    const finalPool = pool.length > 0 ? pool : BIOME_IDS.filter((b) => b !== banned);
    assigned.set(key, pick(finalPool.length > 0 ? finalPool : BIOME_IDS));
  }

  return ZONE_DEFS.map((zone) => ({
    zone,
    template: BIOME_TEMPLATES[assigned.get(zone.key)]
  }));
}

// Dominant template across zones (for global fog/mood): the biome that
// owns the most floor area wins; ties break toward the boss sanctum.
export function dominantTemplate(assignments) {
  const area = {};
  for (const a of assignments) {
    const b = a.zone.bounds;
    const id = a.template.id;
    area[id] = (area[id] || 0) + (b.maxX - b.minX) * (b.maxZ - b.minZ);
  }
  let best = assignments[assignments.length - 1].template;
  let bestArea = -1;
  for (const id of Object.keys(area)) {
    if (area[id] > bestArea) {
      bestArea = area[id];
      best = BIOME_TEMPLATES[id];
    }
  }
  return best;
}
