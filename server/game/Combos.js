// Combos.js - Cross-Player Synergy & Reaction System
class ComboEngine {
  constructor() {
    this.comboEvents = [];
  }

  // Apply a status effect to an entity (boss, mob, or player)
  static applyStatus(entity, statusName, durationSec, potency = 1, sourcePlayerId = null) {
    if (!entity.statuses) entity.statuses = {};
    entity.statuses[statusName] = {
      duration: durationSec,
      maxDuration: durationSec,
      potency,
      sourcePlayerId,
      appliedAt: Date.now()
    };
  }

  // Check if entity has a status active
  static hasStatus(entity, statusName) {
    return !!(entity.statuses && entity.statuses[statusName] && entity.statuses[statusName].duration > 0);
  }

  // Process hit for combos
  // Returns: { comboTriggered: null | string, bonusDamage: number, extraEffects: [] }
  static processHit(attacker, target, damageType, baseDamage) {
    const result = {
      comboTriggered: null,
      comboName: null,
      bonusDamage: 0,
      extraEffects: [],
      announcement: null
    };

    if (!target.statuses) return result;

    // 1. OIL & SPARK: Tar + Fire = Infernal Conflagration
    if (this.hasStatus(target, 'tar') && damageType === 'fire') {
      result.comboTriggered = 'infernal_conflagration';
      result.comboName = 'INFERNAL CONFLAGRATION!';
      result.bonusDamage = Math.round(baseDamage * 1.5 + 45);
      result.announcement = `${attacker.name || 'Hero'} ignited the tar slick! Roaring hellfire erupts!`;
      result.extraEffects.push({
        type: 'fire_pool',
        x: target.x,
        z: target.z,
        radius: 4.5,
        duration: 6
      });
      // Consume tar, apply burning
      delete target.statuses['tar'];
      this.applyStatus(target, 'burning', 6, 2, attacker.id);
    }

    // 2. DEEP FREEZE & SHATTER: Frozen + Heavy / Physical / Arrow = Glacial Shatter
    else if (this.hasStatus(target, 'frozen') && (damageType === 'physical' || damageType === 'shatter' || damageType === 'projectile')) {
      result.comboTriggered = 'glacial_shatter';
      result.comboName = 'GLACIAL SHATTER!';
      result.bonusDamage = Math.round(baseDamage * 2.2 + 80);
      result.announcement = `${attacker.name || 'Hero'} shattered the frozen foe into razor-sharp icicles!`;
      result.extraEffects.push({
        type: 'ice_shrapnel',
        x: target.x,
        z: target.z,
        radius: 5.0,
        damage: Math.round(baseDamage * 1.0)
      });
      delete target.statuses['frozen'];
    }

    // 3. RADIANT BATTERY: Judgement Brand + Any Hit = Radiant Splash & Heal
    else if (this.hasStatus(target, 'branded')) {
      const brand = target.statuses['branded'];
      result.comboTriggered = 'radiant_cascade';
      result.comboName = 'RADIANT BURST!';
      result.bonusDamage = 35;
      result.extraEffects.push({
        type: 'radiant_burst',
        x: target.x,
        z: target.z,
        radius: 3.5,
        healAllyAmount: 18,
        sourcePlayerId: brand.sourcePlayerId
      });
    }

    // 4. EVISCERATE EXPLOIT: Vulnerable / Bleeding + Rogue Execute
    else if (damageType === 'execute' && (this.hasStatus(target, 'bleeding') || this.hasStatus(target, 'burning'))) {
      result.comboTriggered = 'visceral_execute';
      result.comboName = 'VISCERAL EXECUTE!';
      result.bonusDamage = Math.round(baseDamage * 2.0);
      result.announcement = `${attacker.name || 'Rogue'} tore through vulnerable wounds!`;
    }

    return result;
  }

  // Update statuses each tick (dt in seconds)
  static tickStatuses(entity, dt) {
    if (!entity.statuses) return;
    for (const key of Object.keys(entity.statuses)) {
      entity.statuses[key].duration -= dt;
      if (entity.statuses[key].duration <= 0) {
        delete entity.statuses[key];
      }
    }
  }
}

module.exports = ComboEngine;
