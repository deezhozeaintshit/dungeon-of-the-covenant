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
  { name: 'Void-Infused', stat: 'damageBuff', val: 0.18, desc: '+18% Void Damage' }
];

const SUFFIXES = [
  { name: 'of the Covenant', stat: 'damageBuff', val: 0.12, desc: '+12% Covenant Might' },
  { name: 'of Soul Overdrive', stat: 'critChance', val: 0.05, desc: '+5% Crit Chance' },
  { name: 'of Undying Vitality', stat: 'maxHp', val: 140, desc: '+140 Max HP' },
  { name: 'of Blood Siphon', stat: 'lifesteal', val: 0.06, desc: '+6% Lifesteal' },
  { name: 'of Temporal Mastery', stat: 'cooldownHaste', val: 0.12, desc: '+12% Skill Haste' }
];

class LootGenerator {
  static rollRarity(floor = 1, sourceType = 'mob') {
    let bonus = (floor - 1) * 4;
    if (sourceType === 'elite') bonus += 18;
    if (sourceType === 'chest') bonus += 14;
    if (sourceType === 'boss') bonus += 40;

    const roll = Math.random() * 100;
    if (roll < Math.min(25, 1 + bonus * 0.35)) return RARITIES[5]; // Mythic
    if (roll < Math.min(50, 5 + bonus * 0.7)) return RARITIES[4];  // Legendary
    if (roll < Math.min(75, 15 + bonus * 1.1)) return RARITIES[3]; // Epic
    if (roll < Math.min(90, 32 + bonus * 1.2)) return RARITIES[2]; // Rare
    if (roll < 65) return RARITIES[1];                             // Uncommon
    return RARITIES[0];                                            // Common
  }

  static generateItem(floor = 1, sourceType = 'mob') {
    const rarity = this.rollRarity(floor, sourceType);
    const base = BASE_ITEMS[Math.floor(Math.random() * BASE_ITEMS.length)];
    const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];

    const scale = rarity.mult * (1 + (floor - 1) * 0.18);
    const stats = {
      damageBuff: +(((base.baseDmg || 0) + (prefix.stat === 'damageBuff' ? prefix.val : 0) + (suffix.stat === 'damageBuff' ? suffix.val : 0)) * scale).toFixed(2),
      maxHp: Math.round(((base.baseHp || 0) + (prefix.stat === 'maxHp' ? prefix.val : 0) + (suffix.stat === 'maxHp' ? suffix.val : 0)) * scale),
      critChance: +(((base.baseCrit || 0) + (prefix.stat === 'critChance' ? prefix.val : 0) + (suffix.stat === 'critChance' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2),
      lifesteal: +(((base.baseLifesteal || 0) + (prefix.stat === 'lifesteal' ? prefix.val : 0) + (suffix.stat === 'lifesteal' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2),
      cooldownHaste: +(((base.baseHaste || 0) + (prefix.stat === 'cooldownHaste' ? prefix.val : 0) + (suffix.stat === 'cooldownHaste' ? suffix.val : 0)) * Math.sqrt(scale)).toFixed(2)
    };

    const gearScore = Math.round(
      (stats.damageBuff * 450) +
      (stats.maxHp * 1.2) +
      (stats.critChance * 600) +
      (stats.lifesteal * 650) +
      (stats.cooldownHaste * 500)
    );

    const fullName = rarity.id === 'common'
      ? base.name
      : `${prefix.name} ${base.name} ${suffix.name}`;

    const summaryParts = [];
    if (stats.damageBuff > 0) summaryParts.push(`+${Math.round(stats.damageBuff * 100)}% DMG`);
    if (stats.maxHp > 0) summaryParts.push(`+${stats.maxHp} HP`);
    if (stats.critChance > 0) summaryParts.push(`+${Math.round(stats.critChance * 100)}% CRIT`);
    if (stats.lifesteal > 0) summaryParts.push(`+${Math.round(stats.lifesteal * 100)}% LEECH`);
    if (stats.cooldownHaste > 0) summaryParts.push(`+${Math.round(stats.cooldownHaste * 100)}% HASTE`);

    return {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: fullName,
      slot: base.slot,
      rarity: rarity.id,
      rarityName: rarity.name,
      color: rarity.color,
      floor,
      gearScore,
      stats,
      summary: summaryParts.join(' · ')
    };
  }
}

module.exports = LootGenerator;
