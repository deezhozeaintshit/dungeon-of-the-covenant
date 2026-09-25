// ============================================================
// VOID WALKER - Dynamic Loot System
// ============================================================

/**
 * Loot System with dynamic drops, quality tiers, and affix generation
 */

class LootSystem {
  constructor() {
    this.lootTables = new Map();
    this.qualitySystem = new QualitySystem();
    this.affixSystem = new AffixSystem();
    this.initializeTables();
  }

  initializeTables() {
    // Enemy-specific loot tables
    this.lootTables.set('void_minion', {
      drops: [
        { item: 'void_shard', chance: 0.3, min: 1, max: 3 },
        { item: 'health_potion_small', chance: 0.5, min: 1, max: 1 },
        { item: 'gold', chance: 1.0, min: 5, max: 15 },
        { item: 'basic_weapon', chance: 0.05, min: 1, max: 1 }
      ]
    });

    this.lootTables.set('shadow_knight', {
      drops: [
        { item: 'knight_sword', chance: 0.1, quality: 'rare' },
        { item: 'knight_shield', chance: 0.08, quality: 'rare' },
        { item: 'void_shard', chance: 0.5, min: 2, max: 5 },
        { item: 'health_potion_large', chance: 0.3, min: 1, max: 1 },
        { item: 'gold', chance: 1.0, min: 20, max: 50 }
      ]
    });

    this.lootTables.set('corpse_guard', {
      drops: [
        { item: 'guard_armor', chance: 0.08, quality: 'epic' },
        { item: 'void_shard', chance: 0.6, min: 3, max: 8 },
        { item: 'health_potion_large', chance: 0.4, min: 1, max: 2 },
        { item: 'gold', chance: 1.0, min: 30, max: 60 }
      ]
    });

    this.lootTables.set('void_lord', {
      drops: [
        { item: 'void_crown', chance: 1.0, quality: 'legendary' },
        { item: 'ether_blade', chance: 0.5, quality: 'epic' },
        { item: 'void_shard', chance: 1.0, min: 10, max: 20 },
        { item: 'health_potion_large', chance: 1.0, min: 2, max: 3 },
        { item: 'gold', chance: 1.0, min: 100, max: 200 }
      ]
    });

    // Chest loot tables
    this.lootTables.set('chest_wooden', {
      drops: [
        { item: 'gold', chance: 1.0, min: 10, max: 30 },
        { item: 'health_potion_small', chance: 0.5, min: 1, max: 2 },
        { item: 'mana_potion_small', chance: 0.4, min: 1, max: 1 },
        { item: 'bomb', chance: 0.2, min: 1, max: 2 }
      ]
    });

    this.lootTables.set('chest_crystal', {
      drops: [
        { item: 'void_shard', chance: 0.8, min: 2, max: 5 },
        { item: 'upgrade_stone', chance: 0.15, min: 1, max: 1 },
        { item: 'health_potion_large', chance: 0.6, min: 1, max: 2 },
        { item: 'mana_potion_large', chance: 0.5, min: 1, max: 1 },
        { item: 'gold', chance: 1.0, min: 50, max: 100 }
      ]
    });
  }

  // Generate loot from defeated enemy
  generateLoot(enemyType, playerLevel) {
    const table = this.lootTables.get(enemyType);
    if (!table) return [];

    const drops = [];
    for (const drop of table.drops) {
      if (Math.random() < drop.chance) {
        const quantity = randomRange(drop.min, drop.max);
        const quality = drop.quality || this.determineQuality(playerLevel);
        const item = this.createItem(drop.item, quality, quantity);
        drops.push(item);
      }
    }
    return drops;
  }

  // Generate loot from chest
  generateChestLoot(chestType) {
    const table = this.lootTables.get(`chest_${chestType}`);
    if (!table) return [];
    return this.generateLootFromTable(table);
  }

  // Create item with affixes
  createItem(itemId, quality, quantity) {
    const baseItem = this.getBaseItem(itemId);
    if (!baseItem) return null;

    const item = {
      ...baseItem,
      id: generateUUID(),
      quality,
      quantity,
      affixes: []
    };

    // Generate affixes based on quality
    const affixCount = this.qualitySystem.getAffixCount(quality);
    for (let i = 0; i < affixCount; i++) {
      const affix = this.affixSystem.generateAffix(itemId, quality);
      if (affix) item.affixes.push(affix);
    }

    return item;
  }

  // Get base item definition
  getBaseItem(itemId) {
    const items = {
      'void_shard': { name: 'Void Shard', type: 'material', value: 1 },
      'health_potion_small': { name: 'Small Health Potion', type: 'consumable', value: 25 },
      'health_potion_large': { name: 'Large Health Potion', type: 'consumable', value: 100 },
      'mana_potion_small': { name: 'Small Mana Potion', type: 'consumable', value: 20 },
      'mana_potion_large': { name: 'Large Mana Potion', type: 'consumable', value: 80 },
      'bomb': { name: 'Bomb', type: 'consumable', value: 10 },
      'smoke_bomb': { name: 'Smoke Bomb', type: 'consumable', value: 5 },
      'upgrade_stone': { name: 'Upgrade Stone', type: 'material', value: 50 },
      'basic_weapon': { name: 'Basic Sword', type: 'weapon', value: 100 },
      'knight_sword': { name: 'Knight\'s Sword', type: 'weapon', value: 250 },
      'knight_shield': { name: 'Knight\'s Shield', type: 'armor', value: 200 },
      'guard_armor': { name: 'Guard Armor', type: 'armor', value: 300 },
      'void_crown': { name: 'Void Crown', type: 'armor', value: 1000 },
      'ether_blade': { name: 'Ether Blade', type: 'weapon', value: 800 },
      'gold': { name: 'Gold', type: 'currency', value: 1 }
    };
    return items[itemId] || null;
  }

  // Determine quality based on player level and enemy difficulty
  determineQuality(playerLevel) {
    const rand = Math.random();
    const levelFactor = Math.min(playerLevel / 10, 1);

    if (rand < 0.5 - levelFactor * 0.2) return 'common';
    if (rand < 0.75 - levelFactor * 0.1) return 'uncommon';
    if (rand < 0.9) return 'rare';
    if (rand < 0.97) return 'epic';
    return 'legendary';
  }

  // Helper: random range
  getAffixCount(quality) {
    const counts = {
      'common': 0,
      'uncommon': 1,
      'rare': 2,
      'epic': 3,
      'legendary': 5
    };
    return counts[quality] || 0;
  }
}

// Quality System
class QualitySystem {
  constructor() {
    this.qualities = {
      common: { color: '#9D9D9D', multiplier: 1, suffix: '' },
      uncommon: { color: '#1EFF0E', multiplier: 1.5, suffix: ' of the Bear' },
      rare: { color: '#0070DD', multiplier: 2, suffix: ' of the Tiger' },
      epic: { color: '#A335EE', multiplier: 3, suffix: ' of the Dragon' },
      legendary: { color: '#FF8000', multiplier: 5, suffix: ' of the Gods' }
    };
  }

  getQuality(name, quality) {
    const q = this.qualities[quality];
    return `${name}${q.suffix}`;
  }

  getColor(quality) {
    return this.qualities[quality]?.color || '#FFFFFF';
  }

  getMultiplier(quality) {
    return this.qualities[quality]?.multiplier || 1;
  }

  getAffixCount(quality) {
    const counts = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 5 };
    return counts[quality] || 0;
  }
}

// Affix System
class AffixSystem {
  constructor() {
    this.affixes = [
      { id: 'strength', name: 'Strength', min: 1, max: 10, type: 'stat' },
      { id: 'critical_chance', name: 'Critical Chance', min: 5, max: 20, type: 'stat' },
      { id: 'attack_speed', name: 'Attack Speed', min: 5, max: 25, type: 'stat' },
      { id: 'fire_damage', name: 'Fire Damage', min: 5, max: 30, type: 'elemental' },
      { id: 'ice_damage', name: 'Ice Damage', min: 5, max: 30, type: 'elemental' },
      { id: 'lightning_damage', name: 'Lightning Damage', min: 5, max: 30, type: 'elemental' },
      { id: 'health', name: 'Health', min: 10, max: 100, type: 'stat' },
      { id: 'mana', name: 'Mana', min: 10, max: 80, type: 'stat' },
      { id: 'armor', name: 'Armor', min: 5, max: 30, type: 'defense' },
      { id: 'lifesteal', name: 'Life Steal', min: 1, max: 5, type: 'special' }
    ];
  }

  generateAffix(itemId, quality) {
    const affix = this.affixes[Math.floor(Math.random() * this.affixes.length)];
    const multiplier = quality === 'legendary' ? 2 : quality === 'epic' ? 1.5 : 1;

    return {
      id: affix.id,
      name: affix.name,
      value: Math.floor(randomRange(affix.min, affix.max) * multiplier),
      type: affix.type
    };
  }
}

// Helper functions
function randomRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

module.exports = { LootSystem, QualitySystem, AffixSystem };
