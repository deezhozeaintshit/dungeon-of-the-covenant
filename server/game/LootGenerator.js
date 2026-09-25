// LootGenerator.js - Dynamic Procedural RPG Item & Affix Engine
// Generates Diablo/PoE-style randomized weapons, armor, and relics with prefix/suffix affixes

const RARITIES = [
  { id: 'common', name: 'Common', color: '#c0c6d4', weight: 42, mult: 1.0 },
  { id: 'uncommon', name: 'Uncommon', color: '#2ecc71', weight: 28, mult: 1.35 },
  { id: 'rare', name: 'Rare', color: '#3ba4ff', weight: 16, mult: 1.75 },
  { id: 'epic', name: 'Epic', color: '#b845ff', weight: 9, mult: 2.35 },
  { id: 'legendary', name: 'Legendary', color: '#ff8c1a', weight: 4, mult: 3.2 },
  { id: 'mythic', name: 'Mythic Covenant', color: '#ff2a55', weight: 1, mult: 4.5 }
];

const RARITY_IDS = new Set(RARITIES.map(r => r.id));

// ---------------------------------------------------------------------------
// BIOME DROP TABLES
// Keyed by the REAL biome ids from ProceduralLevelGenerator (ossuary_crypt,
// glacial_sanctum, blood_citadel, void_nexus, blight_catacombs). Each table
// carries per-tier drop chances (trash/elite/boss), a rarity bonus folded
// into rollRarity, and affixBias: stats this biome's loot favors.
// Legacy aliases (crypt/cavern/forge/throne_room) resolve to real ids.
// ---------------------------------------------------------------------------
const BIOME_LOOT = {
  ossuary_crypt:   { dropChance: { trash: 0.45, elite: 1.0, boss: 1.0 }, rarityBonus: 0, affixBias: ['damageBuff', 'critChance'], flavor: 'bone-forged' },
  glacial_sanctum: { dropChance: { trash: 0.40, elite: 1.0, boss: 1.0 }, rarityBonus: 2, affixBias: ['armor', 'resistAll'], flavor: 'rime-warded' },
  blood_citadel:   { dropChance: { trash: 0.45, elite: 1.0, boss: 1.0 }, rarityBonus: 4, affixBias: ['lifesteal', 'maxHp'], flavor: 'blood-drunk' },
  void_nexus:      { dropChance: { trash: 0.38, elite: 1.0, boss: 1.0 }, rarityBonus: 6, affixBias: ['cooldownHaste', 'damageBuff'], flavor: 'void-touched' },
  blight_catacombs:{ dropChance: { trash: 0.42, elite: 1.0, boss: 1.0 }, rarityBonus: 3, affixBias: ['maxHp', 'resistAll'], flavor: 'plague-bloomed' }
};

const BIOME_ALIASES = {
  crypt: 'ossuary_crypt',
  cavern: 'glacial_sanctum',
  forge: 'blood_citadel',
  throne_room: 'void_nexus'
};

const DEFAULT_BIOME = 'ossuary_crypt';

function _resolveBiome(biomeId) {
  if (BIOME_LOOT[biomeId]) return biomeId;
  if (biomeId && BIOME_ALIASES[biomeId]) return BIOME_ALIASES[biomeId];
  return DEFAULT_BIOME;
}

const BASE_ITEMS = [
  { slot: 'weapon', name: 'Obsidian Greatsword', baseDmg: 0.14, baseCrit: 0.03 },
  { slot: 'weapon', name: 'Soul-Reaver Scythe', baseDmg: 0.16, baseLifesteal: 0.04 },
  { slot: 'weapon', name: 'Astral Sun-Staff', baseDmg: 0.13, baseHaste: 0.08 },
  { slot: 'weapon', name: 'Twin Shadow Daggers', baseDmg: 0.12, baseCrit: 0.07 },
  { slot: 'armor', name: 'Catacomb Dreadplate', baseHp: 110, baseDmg: 0.04 },
  { slot: 'armor', name: 'Vestments of the Sovereign', baseHp: 85, baseHaste: 0.07 },
  { slot: 'relic', name: 'Crimson Signet Ring', baseDmg: 0.10, baseLifesteal: 0.05 },
  { slot: 'relic', name: 'Chalice of Eternal Embers', baseHp: 95, baseCrit: 0.05 },
  { slot: 'relic', name: 'Crown of Dimensional Echoes', baseDmg: 0.12, baseHaste: 0.09 }
];

const PREFIXES = [
  { name: 'Vampiric', stat: 'lifesteal', val: 0.05, desc: '+5% Lifesteal' },
  { name: 'Hellforged', stat: 'damageBuff', val: 0.15, desc: '+15% Attack Power' },
  { name: 'Chronos-Touched', stat: 'cooldownHaste', val: 0.10, desc: '+10% Cooldown Haste' },
  { name: 'Immortal', stat: 'maxHp', val: 120, desc: '+120 Max HP' },
  { name: 'Executioner\'s', stat: 'critChance', val: 0.06, desc: '+6% Crit Chance' },
  { name: 'Void-Infused', stat: 'damageBuff', val: 0.18, desc: '+18% Void Damage' },
  { name: 'Aegis-Bound', stat: 'armor', val: 14, desc: '+14 Armor' },
  { name: 'Ward-Sigil', stat: 'resistAll', val: 0.04, desc: '+4% All Resists' }
];

const SUFFIXES = [
  { name: 'of the Covenant', stat: 'damageBuff', val: 0.12, desc: '+12% Covenant Might' },
  { name: 'of Soul Overdrive', stat: 'critChance', val: 0.05, desc: '+5% Crit Chance' },
  { name: 'of Undying Vitality', stat: 'maxHp', val: 140, desc: '+140 Max HP' },
  { name: 'of Blood Siphon', stat: 'lifesteal', val: 0.06, desc: '+6% Lifesteal' },
  { name: 'of Temporal Mastery', stat: 'cooldownHaste', val: 0.12, desc: '+12% Skill Haste' },
  { name: 'of the Iron Bastion', stat: 'armor', val: 16, desc: '+16 Armor' },
  { name: 'of Null-Warding', stat: 'resistAll', val: 0.05, desc: '+5% All Resists' }
];

class LootGenerator {
  // bonus: flat rarity-bonus points (biome tables feed this in).
  static rollRarity(floor = 1, sourceType = 'mob', bonus = 0) {
    let b = (floor - 1) * 4 + bonus;
    if (sourceType === 'elite') b += 18;
    if (sourceType === 'chest') b += 14;
    if (sourceType === 'boss') b += 40;

    const roll = Math.random() * 100;
    if (roll < Math.min(25, 1 + b * 0.35)) return RARITIES[5]; // Mythic
    if (roll < Math.min(50, 5 + b * 0.7)) return RARITIES[4];  // Legendary
    if (roll < Math.min(75, 15 + b * 1.1)) return RARITIES[3]; // Epic
    if (roll < Math.min(90, 32 + b * 1.2)) return RARITIES[2]; // Rare
    if (roll < 65) return RARITIES[1];                             // Uncommon
    return RARITIES[0];                                            // Common
  }

  // Server-side drop roll: does this kill produce a gear drop at all?
  // tier: 'trash' | 'elite' | 'boss'. biomeId resolved (with legacy aliases).
  static rollDropChance(tier = 'trash', biomeId = DEFAULT_BIOME) {
    const table = BIOME_LOOT[_resolveBiome(biomeId)];
    const chance = table.dropChance[tier] ?? table.dropChance.trash;
    return Math.random() < chance;
  }

  static biomeInfo(biomeId = DEFAULT_BIOME) {
    const id = _resolveBiome(biomeId);
    return { id, ...BIOME_LOOT[id] };
  }

  static isValidRarity(rarityId) {
    return RARITY_IDS.has(rarityId);
  }

  // Canonical gear-score formula — shared with systems/Gear.js so forged
  // client-sent gearScore values can never be trusted.
  static gearScoreFor(stats = {}) {
    return Math.round(
      ((stats.damageBuff || 0) * 450) +
      ((stats.maxHp || 0) * 1.2) +
      ((stats.critChance || 0) * 600) +
      ((stats.lifesteal || 0) * 650) +
      ((stats.cooldownHaste || 0) * 500) +
      ((stats.armor || 0) * 4) +
      ((stats.resistAll || 0) * 900)
    );
  }

  static generateItem(floor = 1, sourceType = 'mob', biomeId = DEFAULT_BIOME) {
    const resolvedBiome = _resolveBiome(biomeId);
    const table = BIOME_LOOT[resolvedBiome];
    const rarity = this.rollRarity(floor, sourceType, table.rarityBonus);
    const base = BASE_ITEMS[Math.floor(Math.random() * BASE_ITEMS.length)];

    // Biome affix bias: 55% chance each affix slot rolls from a bias-matching
    // affix instead of the full pool.
    const pickAffix = (pool) => {
      if (Math.random() < 0.55) {
        const biased = pool.filter(a => table.affixBias.includes(a.stat));
        if (biased.length) return biased[Math.floor(Math.random() * biased.length)];
      }
      return pool[Math.floor(Math.random() * pool.length)];
    };
    const prefix = pickAffix(PREFIXES);
    const suffix = pickAffix(SUFFIXES);

    const scale = rarity.mult * (1 + (floor - 1) * 0.18);
    const addAffix = (baseVal, affix, stat) => baseVal + (affix.stat === stat ? affix.val : 0);
    const stats = {
      damageBuff: +((addAffix(base.baseDmg || 0, prefix, 'damageBuff') + (suffix.stat === 'damageBuff' ? suffix.val : 0)) * scale).toFixed(2),
      maxHp: Math.round((addAffix(base.baseHp || 0, prefix, 'maxHp') + (suffix.stat === 'maxHp' ? suffix.val : 0)) * scale),
      critChance: +((addAffix(base.baseCrit || 0, prefix, 'critChance') + (suffix.stat === 'critChance' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2),
      lifesteal: +((addAffix(base.baseLifesteal || 0, prefix, 'lifesteal') + (suffix.stat === 'lifesteal' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2),
      cooldownHaste: +((addAffix(base.baseHaste || 0, prefix, 'cooldownHaste') + (suffix.stat === 'cooldownHaste' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2),
      armor: Math.round(((prefix.stat === 'armor' ? prefix.val : 0) + (suffix.stat === 'armor' ? suffix.val : 0)) * scale),
      resistAll: +(((prefix.stat === 'resistAll' ? prefix.val : 0) + (suffix.stat === 'resistAll' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2)
    };

    const gearScore = this.gearScoreFor(stats);

    const fullName = rarity.id === 'common'
      ? base.name
      : `${prefix.name} ${base.name} ${suffix.name}`;

    const summaryParts = [];
    if (stats.damageBuff > 0) summaryParts.push(`+${Math.round(stats.damageBuff * 100)}% DMG`);
    if (stats.maxHp > 0) summaryParts.push(`+${stats.maxHp} HP`);
    if (stats.critChance > 0) summaryParts.push(`+${Math.round(stats.critChance * 100)}% CRIT`);
    if (stats.lifesteal > 0) summaryParts.push(`+${Math.round(stats.lifesteal * 100)}% LEECH`);
    if (stats.cooldownHaste > 0) summaryParts.push(`+${Math.round(stats.cooldownHaste * 100)}% HASTE`);
    if (stats.armor > 0) summaryParts.push(`+${stats.armor} ARMOR`);
    if (stats.resistAll > 0) summaryParts.push(`+${Math.round(stats.resistAll * 100)}% ALL RESIST`);

    return {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: fullName,
      slot: base.slot,
      rarity: rarity.id,
      rarityName: rarity.name,
      color: rarity.color,
      floor,
      biome: resolvedBiome,
      gearScore,
      stats,
      summary: summaryParts.join(' · ')
    };
  }
}

module.exports = LootGenerator;
