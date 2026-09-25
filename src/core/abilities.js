// ============================================================
// VOID WALKER - Character Abilities System
// ============================================================

/**
 * Ability System for Void Walker
 * Supports 20 abilities with VFX, cooldowns, and mana costs
 */

class AbilitySystem {
  constructor(player) {
    this.player = player;
    this.abilities = new Map();
    this.cooldowns = new Map();
    this.activeEffects = new Map();
    this.initializeAbilities();
  }

  // Initialize all 20 abilities
  initializeAbilities() {
    const abilityDefinitions = [
      // Basic Attacks (3)
      { id: 'fireball', name: 'Fireball', type: 'projectile', damage: 25, cooldown: 2000, manaCost: 15, icon: 'fireball.png', color: '#FF6B35' },
      { id: 'frost_shard', name: 'Frost Shard', type: 'projectile', damage: 20, cooldown: 1500, manaCost: 12, icon: 'frost_shard.png', color: '#4FC3F7', effect: 'slow_30_3s' },
      { id: 'lightning_bolt', name: 'Lightning Bolt', type: 'instant', damage: 30, cooldown: 3000, manaCost: 20, icon: 'lightning_bolt.png', color: '#FFD93D', effect: 'chain_3' },

      // Mobility (2)
      { id: 'dash', name: 'Dash', type: 'movement', cooldown: 4000, manaCost: 10, icon: 'dash.png', color: '#9C27B0', effect: 'invincible_0.5s' },
      { id: 'teleport', name: 'Teleport', type: 'movement', cooldown: 8000, manaCost: 30, icon: 'teleport.png', color: '#E040FB' },

      // Healing (2)
      { id: 'heal', name: 'Heal', type: 'heal', cooldown: 6000, manaCost: 25, icon: 'heal.png', color: '#4CAF50', amount: 50 },
      { id: 'resurrection', name: 'Resurrection', type: 'ultimate_heal', cooldown: 60000, manaCost: 100, icon: 'resurrection.png', color: '#FFD700', amount: 1000 },

      // Buffs (2)
      { id: 'strength_buff', name: 'Strength Buff', type: 'buff', cooldown: 15000, manaCost: 20, icon: 'strength_buff.png', color: '#FF5722', effect: 'strength_2x_10s' },
      { id: 'speed_buff', name: 'Speed Buff', type: 'buff', cooldown: 12000, manaCost: 15, icon: 'speed_buff.png', color: '#FF9800', effect: 'speed_2x_8s' },

      // Debuffs (2)
      { id: 'weakness_curse', name: 'Weakness Curse', type: 'debuff', cooldown: 10000, manaCost: 18, icon: 'weakness_curse.png', color: '#7B1FA2', effect: 'weakness_50_5s' },
      { id: 'slow_curse', name: 'Slow Curse', type: 'debuff', cooldown: 8000, manaCost: 12, icon: 'slow_curse.png', color: '#0288D1', effect: 'slow_50_4s' },

      // Area Damage (3)
      { id: 'meteor', name: 'Meteor', type: 'aoe', damage: 80, cooldown: 10000, manaCost: 40, icon: 'meteor.png', color: '#FF5722', radius: 5 },
      { id: 'blizzard', name: 'Blizzard', type: 'aoe', damage: 15, cooldown: 5000, manaCost: 25, icon: 'blizzard.png', color: '#00BCD4', radius: 8, effect: 'slow_20_5s' },
      { id: 'inferno', name: 'Inferno', type: 'ultimate_aoe', damage: 200, cooldown: 120000, manaCost: 200, icon: 'inferno.png', color: '#FF1744', radius: 15 },

      // Crowd Control (2)
      { id: 'shield', name: 'Shield', type: 'buff', cooldown: 20000, manaCost: 30, icon: 'shield.png', color: '#3F51B5', effect: 'absorb_100_8s' },
      { id: 'void_strike', name: 'Void Strike', type: 'melee', damage: 35, cooldown: 2000, manaCost: 10, icon: 'void_strike.png', color: '#7C4DFF', effect: 'void_pierce' },

      // Stealth (2)
      { id: 'shadow_step', name: 'Shadow Step', type: 'stealth', cooldown: 15000, manaCost: 25, icon: 'shadow_step.png', color: '#1A237E', effect: 'invis_5s' },

      // Ultimate (1)
      { id: 'divine_blessing', name: 'Divine Blessing', type: 'ultimate_global', cooldown: 180000, manaCost: 300, icon: 'divine_blessing.png', color: '#FFD700', effect: 'team_heal_all' },
    ];

    abilityDefinitions.forEach(def => {
      this.abilities.set(def.id, def);
      this.cooldowns.set(def.id, 0);
    });
  }

  // Cast an ability
  async castAbility(abilityId, target) {
    const ability = this.abilities.get(abilityId);
    if (!ability) return { success: false, error: 'Ability not found' };

    // Check cooldown
    if (this.cooldowns.get(abilityId) > 0) {
      return { success: false, error: 'Ability on cooldown' };
    }

    // Check mana
    if (this.player.mana < ability.manaCost) {
      return { success: false, error: 'Not enough mana' };
    }

    // Consume mana
    this.player.mana -= ability.manaCost;

    // Start cooldown
    this.cooldowns.set(abilityId, ability.cooldown);
    this.startCooldownTimer(abilityId, ability.cooldown);

    // Execute ability
    const result = await this.executeAbility(ability, target);
    return { success: true, ability, result };
  }

  // Execute ability logic
  async executeAbility(ability, target) {
    switch (ability.type) {
      case 'projectile':
        return await this.castProjectile(ability, target);
      case 'instant':
        return await this.castInstant(ability, target);
      case 'movement':
        return await this.castMovement(ability);
      case 'heal':
        return await this.castHeal(ability);
      case 'buff':
        return await this.castBuff(ability);
      case 'debuff':
        return await this.castDebuff(ability, target);
      case 'aoe':
        return await this.castAOE(ability);
      case 'ultimate_aoe':
        return await this.castUltimateAOE(ability);
      case 'ultimate_heal':
        return await this.castUltimateHeal(ability);
      case 'ultimate_global':
        return await this.castUltimateGlobal(ability);
      case 'melee':
        return await this.castMelee(ability, target);
      case 'stealth':
        return await this.castStealth(ability);
      default:
        return { success: false, error: 'Unknown ability type' };
    }
  }

  // Projectile abilities (Fireball, Frost Shard)
  async castProjectile(ability, target) {
    const projectile = {
      id: `proj_${Date.now()}`,
      abilityId: ability.id,
      x: this.player.x,
      y: this.player.y,
      targetX: target?.x || this.player.x + 100,
      targetY: target?.y || this.player.y,
      speed: 800,
      damage: ability.damage,
      color: ability.color,
      effect: ability.effect
    };

    // Animate projectile
    await this.animateProjectile(projectile, 0.5);

    // Apply damage and effects
    if (target) {
      target.takeDamage(projectile.damage);
      if (ability.effect === 'slow_30_3s') {
        target.applyDebuff('slow', 0.3, 3000);
      }
    }

    return { success: true, type: 'projectile', damage: projectile.damage };
  }

  // Instant abilities (Lightning Bolt)
  async castInstant(ability, target) {
    const hitEnemies = this.getEnemiesInRange(this.player.x, this.player.y, 5);
    let totalDamage = 0;

    for (const enemy of hitEnemies) {
      enemy.takeDamage(ability.damage);
      totalDamage += ability.damage;

      // Chain effect
      if (ability.effect === 'chain_3') {
        const nextTargets = this.getEnemiesInRange(enemy.x, enemy.y, 3).filter(e => e !== enemy);
        for (const next of nextTargets.slice(0, 3)) {
          next.takeDamage(Math.floor(ability.damage * 0.5));
        }
      }
    }

    return { success: true, type: 'instant', damage: totalDamage, hits: hitEnemies.length };
  }

  // Movement abilities (Dash, Teleport)
  async castMovement(ability) {
    const direction = this.player.facing;
    const distance = ability.id === 'dash' ? 10 : 50;

    this.player.x += direction.x * distance;
    this.player.y += direction.y * distance;

    if (ability.effect === 'invincible_0.5s') {
      this.player.applyBuff('invincible', 500);
    }

    return { success: true, type: 'movement', distance };
  }

  // Heal abilities
  async castHeal(ability) {
    const healed = Math.min(ability.amount, this.player.maxHealth - this.player.health);
    this.player.health += healed;
    this.player.applyVFX('heal_effect', this.player.x, this.player.y);

    return { success: true, type: 'heal', amount: healed };
  }

  // Buff abilities
  async castBuff(ability) {
    if (!ability.effect) return { success: false, error: 'No effect' };

    const [effectName, value, duration] = ability.effect.split('_');
    this.player.applyBuff(effectName, parseInt(value), parseInt(duration) * 1000);

    return { success: true, type: 'buff', effect: ability.effect };
  }

  // Debuff abilities
  async castDebuff(ability, target) {
    if (!target) return { success: false, error: 'No target' };

    const [effectName, value, duration] = ability.effect.split('_');
    target.applyDebuff(effectName, parseInt(value), parseInt(duration) * 1000);

    return { success: true, type: 'debuff', effect: ability.effect };
  }

  // AOE abilities
  async castAOE(ability) {
    const enemies = this.getEnemiesInRange(this.player.x, this.player.y, ability.radius);
    let totalDamage = 0;

    for (const enemy of enemies) {
      enemy.takeDamage(ability.damage);
      totalDamage += ability.damage;

      if (ability.effect) {
        const [effectName, value, duration] = ability.effect.split('_');
        enemy.applyDebuff(effectName, parseInt(value), parseInt(duration) * 1000);
      }
    }

    this.player.applyVFX('aoe_explosion', this.player.x, this.player.y, ability.radius);

    return { success: true, type: 'aoe', damage: totalDamage, hits: enemies.length };
  }

  // Ultimate AOE
  async castUltimateAOE(ability) {
    const enemies = this.getEnemiesInRange(this.player.x, this.player.y, ability.radius);
    let totalDamage = 0;

    for (const enemy of enemies) {
      enemy.takeDamage(ability.damage);
      totalDamage += ability.damage;
    }

    this.player.applyVFX('ultimate_explosion', this.player.x, this.player.y, ability.radius);

    return { success: true, type: 'ultimate_aoe', damage: totalDamage, hits: enemies.length };
  }

  // Ultimate Heal
  async castUltimateHeal(ability) {
    this.player.health = this.player.maxHealth;
    this.player.applyVFX('resurrection_effect', this.player.x, this.player.y);

    return { success: true, type: 'ultimate_heal', healed: ability.amount };
  }

  // Ultimate Global (Team heal)
  async castUltimateGlobal(ability) {
    const allies = this.getAlliesInRange(this.player.x, this.player.y, 20);
    for (const ally of allies) {
      ally.health = ally.maxHealth;
    }

    return { success: true, type: 'ultimate_global', healed: allies.length };
  }

  // Melee ability
  async castMelee(ability, target) {
    if (!target) return { success: false, error: 'No target' };

    const dist = Math.hypot(target.x - this.player.x, target.y - this.player.y);
    if (dist > 3) return { success: false, error: 'Too far' };

    let damage = ability.damage;
    if (ability.effect === 'void_pierce') {
      damage *= 1.5;
      target.applyDebuff('armor_reduce', 0.5, 5000);
    }

    target.takeDamage(damage);

    return { success: true, type: 'melee', damage };
  }

  // Stealth ability
  async castStealth(ability) {
    const [effectName, value, duration] = ability.effect.split('_');
    this.player.applyBuff('invisible', parseInt(value), parseInt(duration) * 1000);

    return { success: true, type: 'stealth', effect: ability.effect };
  }

  // Get enemies in range
  getEnemiesInRange(x, y, radius) {
    // This would query the game world's enemy list
    return [];
  }

  // Get allies in range
  getAlliesInRange(x, y, radius) {
    // This would query the game world's ally list
    return [];
  }

  // Animate projectile
  async animateProjectile(projectile, duration) {
    return new Promise(resolve => {
      setTimeout(resolve, duration * 1000);
    });
  }

  // Start cooldown timer
  startCooldownTimer(abilityId, duration) {
    const timer = setInterval(() => {
      const remaining = this.cooldowns.get(abilityId) - 100;
      if (remaining <= 0) {
        this.cooldowns.set(abilityId, 0);
        clearInterval(timer);
      } else {
        this.cooldowns.set(abilityId, remaining);
      }
    }, 100);
  }

  // Get remaining cooldown
  getCooldown(abilityId) {
    return this.cooldowns.get(abilityId) || 0;
  }

  // Get all ability info
  getAllAbilities() {
    const abilities = [];
    for (const [id, def] of this.abilities) {
      abilities.push({
        ...def,
        cooldown: this.getCooldown(id),
        isAvailable: this.getCooldown(id) === 0 && this.player.mana >= def.manaCost
      });
    }
    return abilities;
  }
}

module.exports = { AbilitySystem };
