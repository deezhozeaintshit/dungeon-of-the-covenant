// ============================================================
// VOID WALKER - Main Game Class (FIXED PATHS)
// ============================================================

/**
 * Core game class that integrates all systems
 * Fixed: Uses dynamic path resolution for better compatibility
 */

const path = require('path');
const fs = require('fs');

// Dynamic path resolution - find modules regardless of where script is run from
function resolveModule(modulePath) {
  const possiblePaths = [
    modulePath,                              // Original path
    './' + modulePath,                       // Relative to current file
    '../' + modulePath,                      // One level up
    '../../' + modulePath,                   // Two levels up
    path.join(__dirname, modulePath),        // Absolute path from __dirname
    path.join(__dirname, '..', modulePath),  // From parent
  ];

  for (const p of possiblePaths) {
    try {
      return require(p);
    } catch (e) {
      // Try next path
    }
  }

  throw new Error(`Cannot find module: ${modulePath}. Searched: ${possiblePaths.join(', ')}`);
}

// Load modules with fallback
let AbilitySystem, LootSystem, AIFactory, LevelGenerator, StripePaymentSystem;

try {
  const abilitiesModule = resolveModule('./core/abilities');
  AbilitySystem = abilitiesModule.AbilitySystem || abilitiesModule.default;
} catch (e) {
  console.warn('Warning: Could not load AbilitySystem. Abilities will be disabled.');
  AbilitySystem = class {
    constructor() {}
    castAbility() { return { success: false, error: 'AbilitySystem not loaded' }; }
    getAllAbilities() { return []; }
  };
}

try {
  const lootModule = resolveModule('./core/loot');
  LootSystem = lootModule.LootSystem || lootModule.default;
} catch (e) {
  console.warn('Warning: Could not load LootSystem. Loot will be disabled.');
  LootSystem = class {
    constructor() {}
    generateLoot() { return []; }
  };
}

try {
  const aiModule = resolveModule('./core/enemy_ai');
  AIFactory = aiModule.AIFactory || aiModule.default;
} catch (e) {
  console.warn('Warning: Could not load AIFactory. AI will be disabled.');
  AIFactory = { create: () => ({ update: () => {} }) };
}

try {
  const levelModule = resolveModule('./core/level_generator');
  LevelGenerator = levelModule.LevelGenerator || levelModule.default;
} catch (e) {
  console.warn('Warning: Could not load LevelGenerator. Random levels will be disabled.');
  LevelGenerator = class {
    constructor() {}
    generate() { return { rooms: [], corridors: [], enemies: [], loot: [], exit: null }; }
  };
}

try {
  const paymentModule = resolveModule('./payments/stripe');
  StripePaymentSystem = paymentModule.StripePaymentSystem || paymentModule.default;
} catch (e) {
  console.warn('Warning: Could not load StripePaymentSystem. Payments will be disabled.');
  StripePaymentSystem = class {
    constructor() {}
    createCheckoutSession() { return { url: '', sessionId: '' }; }
  };
}

class Game {
  constructor(config = {}) {
    this.width = config.width || 1920;
    this.height = config.height || 1080;
    this.seed = config.seed || Date.now();

    // Game state
    this.state = 'menu'; // menu, playing, paused, gameover
    this.currentLevel = null;
    this.levelIndex = 0;

    // Systems
    this.player = null;
    this.abilitySystem = null;
    this.lootSystem = null;
    this.aiSystem = null;
    this.levelGenerator = null;
    this.paymentSystem = null;

    // Assets
    this.assets = new Map();
    this.sounds = new Map();

    // Initialize
    this.initialize(config);
  }

  initialize(config) {
    // Initialize player
    this.player = new Player({
      x: 100,
      y: 100,
      health: 100,
      maxHealth: 100,
      mana: 100,
      maxMana: 100,
      attackDamage: 10,
      speed: 5
    });

    // Initialize systems
    try {
      this.abilitySystem = new AbilitySystem(this.player);
    } catch (e) {
      console.error('Failed to initialize AbilitySystem:', e.message);
      this.abilitySystem = { castAbility: async () => ({ success: false }) };
    }

    try {
      this.lootSystem = new LootSystem();
    } catch (e) {
      console.error('Failed to initialize LootSystem:', e.message);
      this.lootSystem = { generateLoot: () => [] };
    }

    try {
      this.levelGenerator = new LevelGenerator(this.seed);
    } catch (e) {
      console.error('Failed to initialize LevelGenerator:', e.message);
      this.levelGenerator = { generate: () => ({ rooms: [], corridors: [], enemies: [], loot: [], exit: null }) };
    }

    try {
      this.paymentSystem = new StripePaymentSystem(config.stripeApiKey);
    } catch (e) {
      console.error('Failed to initialize PaymentSystem:', e.message);
      this.paymentSystem = { createCheckoutSession: async () => ({ url: '', sessionId: '' }) };
    }

    // Load initial level
    this.loadLevel('void_hollow');
  }

  // Load a level
  loadLevel(biome) {
    try {
      const levelData = this.levelGenerator.generate(2000, 2000, 15, biome);

      this.currentLevel = {
        biome,
        ...levelData,
        startTime: Date.now()
      };

      // Spawn enemies
      this.currentLevel.enemies = levelData.enemies.map(e => ({
        ...e,
        type: e.type,
        health: this.getEnemyHealth(e.type),
        maxHealth: this.getEnemyHealth(e.type),
        attackDamage: this.getEnemyDamage(e.type),
        speed: this.getEnemySpeed(e.type),
        x: e.x,
        y: e.y,
        direction: { x: 0, y: 0 }
      }));

      // Initialize AI for each enemy
      for (const enemy of this.currentLevel.enemies) {
        try {
          enemy.ai = AIFactory.create(enemy, this);
        } catch (e) {
          enemy.ai = { update: () => {} };
        }
      }

      this.state = 'playing';
      console.log(`Loaded level: ${biome} with ${this.currentLevel.enemies.length} enemies`);
    } catch (e) {
      console.error('Error loading level:', e.message);
    }
  }

  // Get enemy stats
  getEnemyHealth(type) {
    const healths = { void_minion: 50, void_serpent: 40, shadow_knight: 150, corpse_guard: 300, void_lord: 10000 };
    return healths[type] || 50;
  }

  getEnemyDamage(type) {
    const damages = { void_minion: 10, void_serpent: 15, shadow_knight: 25, corpse_guard: 35, void_lord: 100 };
    return damages[type] || 10;
  }

  getEnemySpeed(type) {
    const speeds = { void_minion: 3, void_serpent: 4, shadow_knight: 2, corpse_guard: 1.5, void_lord: 2.5 };
    return speeds[type] || 2;
  }

  // Main game loop
  update(dt) {
    if (this.state !== 'playing') return;

    // Update player
    this.player.update(dt);

    // Update abilities
    if (this.abilitySystem && this.abilitySystem.update) {
      this.abilitySystem.update(dt);
    }

    // Update enemies
    if (this.currentLevel && this.currentLevel.enemies) {
      for (const enemy of this.currentLevel.enemies) {
        if (enemy.health > 0 && enemy.ai && enemy.ai.update) {
          enemy.ai.update(dt);
        }
      }
    }

    // Check level completion
    this.checkLevelCompletion();
  }

  // Check if level is complete
  checkLevelCompletion() {
    if (!this.currentLevel) return;

    const aliveEnemies = this.currentLevel.enemies ? this.currentLevel.enemies.filter(e => e.health > 0) : [];
    if (aliveEnemies.length === 0 && this.currentLevel.exit) {
      const distToExit = Math.hypot(this.player.x - this.currentLevel.exit.x, this.player.y - this.currentLevel.exit.y);
      if (distToExit < 5) {
        this.completeLevel();
      }
    }
  }

  // Complete level
  completeLevel() {
    this.state = 'level_complete';
    const rewards = this.lootSystem.generateLoot ? this.lootSystem.generateLoot('void_lord', this.player.level) : [];
    for (const item of rewards) {
      this.player.inventory.addItem(item);
    }
    console.log(`Level complete! Earned ${rewards.length} items.`);
  }

  // Cast ability
  async castAbility(abilityId, target) {
    if (this.state !== 'playing') return;
    if (!this.abilitySystem) return;
    return await this.abilitySystem.castAbility(abilityId, target);
  }

  // Open chest
  openChest(chestIndex) {
    if (!this.currentLevel || !this.currentLevel.loot) return null;
    const chest = this.currentLevel.loot[chestIndex];
    if (!chest) return null;

    const loot = this.lootSystem.generateChestLoot ? this.lootSystem.generateChestLoot(chest.type || 'wooden') : [];
    chest.loot = loot;
    this.currentLevel.loot[chestIndex] = chest;
    return loot;
  }

  // Process payment
  async processPayment(productId) {
    if (!this.paymentSystem) return { url: '', sessionId: '' };
    return await this.paymentSystem.createCheckoutSession(productId, this.player.userId);
  }

  // Render
  render(ctx) {
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.state === 'menu') this.renderMenu(ctx);
    else if (this.state === 'playing') this.renderGame(ctx);
    else if (this.state === 'level_complete') this.renderLevelComplete(ctx);
  }

  renderMenu(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '48px Cinzel';
    ctx.textAlign = 'center';
    ctx.fillText('VOID WALKER', this.width / 2, this.height / 2 - 100);
    ctx.font = '24px Inter';
    ctx.fillText('Press ENTER to Start', this.width / 2, this.height / 2);
  }

  renderGame(ctx) {
    this.renderLevel(ctx);
    this.renderPlayer(ctx);
    this.renderEnemies(ctx);
    this.renderHUD(ctx);
  }

  renderLevel(ctx) {
    if (!this.currentLevel || !this.currentLevel.rooms) return;
    ctx.fillStyle = '#2D2D44';
    for (const room of this.currentLevel.rooms) {
      ctx.fillRect(room.x, room.y, room.w, room.h);
    }
    ctx.strokeStyle = '#2D2D44';
    ctx.lineWidth = 2;
    if (this.currentLevel.corridors) {
      for (const corridor of this.currentLevel.corridors) {
        ctx.beginPath();
        ctx.moveTo(corridor.x1, corridor.y1);
        ctx.lineTo(corridor.x2, corridor.y2);
        ctx.stroke();
      }
    }
    if (this.currentLevel.exit) {
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath();
      ctx.arc(this.currentLevel.exit.x, this.currentLevel.exit.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderPlayer(ctx) {
    ctx.fillStyle = '#9C27B0';
    ctx.beginPath();
    ctx.arc(this.player.x, this.player.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E040FB';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.player.x, this.player.y);
    ctx.lineTo(this.player.x + (this.player.direction?.x || 0) * 20, this.player.y + (this.player.direction?.y || 0) * 20);
    ctx.stroke();
  }

  renderEnemies(ctx) {
    if (!this.currentLevel || !this.currentLevel.enemies) return;
    const colors = { void_minion: '#F44336', void_serpent: '#9C27B0', shadow_knight: '#607D8B', corpse_guard: '#4CAF50', void_lord: '#FF5722' };
    for (const enemy of this.currentLevel.enemies) {
      if (enemy.health <= 0) continue;
      ctx.fillStyle = colors[enemy.type] || '#FFFFFF';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, 8, 0, Math.PI * 2);
      ctx.fill();
      const healthPercent = enemy.health / enemy.maxHealth;
      ctx.fillStyle = '#333';
      ctx.fillRect(enemy.x - 10, enemy.y - 15, 20, 4);
      ctx.fillStyle = healthPercent > 0.5 ? '#4CAF50' : healthPercent > 0.25 ? '#FF9800' : '#F44336';
      ctx.fillRect(enemy.x - 10, enemy.y - 15, 20 * healthPercent, 4);
    }
  }

  renderHUD(ctx) {
    const healthPercent = this.player.health / this.player.maxHealth;
    ctx.fillStyle = '#333';
    ctx.fillRect(20, 20, 200, 20);
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(20, 20, 200 * healthPercent, 20);
    ctx.fillStyle = '#FFF';
    ctx.font = '14px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(`HP: ${Math.ceil(this.player.health)}/${this.player.maxHealth}`, 25, 34);

    const manaPercent = this.player.mana / this.player.maxMana;
    ctx.fillStyle = '#333';
    ctx.fillRect(20, 50, 200, 20);
    ctx.fillStyle = '#2196F3';
    ctx.fillRect(20, 50, 200 * manaPercent, 20);
    ctx.fillStyle = '#FFF';
    ctx.fillText(`MP: ${Math.ceil(this.player.mana)}/${this.player.maxMana}`, 25, 64);
  }

  renderLevelComplete(ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '48px Cinzel';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL COMPLETE!', this.width / 2, this.height / 2 - 50);
    ctx.font = '24px Inter';
    ctx.fillText('Press ENTER for next level', this.width / 2, this.height / 2 + 20);
  }
}

// Player class
class Player {
  constructor(config) {
    this.x = config.x || 100;
    this.y = config.y || 100;
    this.health = config.health || 100;
    this.maxHealth = config.maxHealth || 100;
    this.mana = config.mana || 100;
    this.maxMana = config.maxMana || 100;
    this.attackDamage = config.attackDamage || 10;
    this.speed = config.speed || 5;
    this.direction = config.direction || { x: 0, y: -1 };
    this.level = config.level || 1;
    this.inventory = new Inventory();
    this.buffs = new Map();
    this.debuffs = new Map();
    this.userId = config.userId || 'player_001';
  }

  update(dt) {
    for (const [id, buff] of this.buffs) {
      buff.duration -= dt;
      if (buff.duration <= 0) this.buffs.delete(id);
    }
    for (const [id, debuff] of this.debuffs) {
      debuff.duration -= dt;
      if (debuff.duration <= 0) this.debuffs.delete(id);
    }
  }

  takeDamage(amount) {
    const finalDamage = Math.max(1, amount - this.getArmor());
    this.health = Math.max(0, this.health - finalDamage);
    if (this.health <= 0) this.die();
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  applyBuff(id, duration) {
    this.buffs.set(id, { id, duration, maxDuration: duration });
  }

  applyDebuff(id, duration) {
    this.debuffs.set(id, { id, duration, maxDuration: duration });
  }

  getArmor() { return 0; }

  die() {
    console.log('Player died!');
  }
}

// Inventory class
class Inventory {
  constructor() {
    this.items = [];
    this.maxSlots = 40;
  }

  addItem(item) {
    if (this.items.length >= this.maxSlots) {
      console.log('Inventory full!');
      return false;
    }
    this.items.push(item);
    return true;
  }

  removeItem(itemId) {
    const index = this.items.findIndex(i => i.id === itemId);
    if (index >= 0) return this.items.splice(index, 1)[0];
    return null;
  }

  hasItem(itemId) {
    return this.items.some(i => i.id === itemId);
  }

  getCount(itemId) {
    return this.items.filter(i => i.id === itemId).length;
  }
}

// Export for testing
module.exports = { Game, Player, Inventory };

// Simple test
if (require.main === module) {
  console.log('Void Walker - Starting game...');
  console.log('Current directory:', process.cwd());
  console.log('Module path:', __filename);
  const game = new Game({
    width: 1920,
    height: 1080,
    stripeApiKey: process.env.STRIPE_API_KEY || 'sk_test_placeholder'
  });
  console.log('Game initialized! State:', game.state);
}
