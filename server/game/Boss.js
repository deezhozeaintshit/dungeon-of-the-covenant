// Boss.js - Malakor the Soul-Forge Warden AI & Mechanics
const ComboEngine = require('./Combos');

class MalakorBoss {
  constructor(x = 0, z = -75) {
    this.id = 'boss_malakor';
    this.name = 'Malakor, Soul-Forge Warden';
    this.title = 'Lord of the Smoldering Crypt';
    this.x = x;
    this.y = 0;
    this.z = z;
    this.radius = 2.2;
    this.rotation = 0;

    this.maxHp = 6500;
    this.hp = this.maxHp;
    this.phase = 1;
    this.state = 'idle'; // idle, windup, attacking, leaping, recovering, dead
    this.targetPlayerId = null;

    // Speeds & timings
    this.moveSpeed = 3.6;
    this.cooldowns = {
      cleave: 6.0,
      quake: 11.0,
      summon: 18.0,
      leap: 10.0,
      basic: 2.0
    };
    this.timers = {
      cleave: 4.0,
      quake: 8.0,
      summon: 12.0,
      leap: 7.0,
      basic: 1.0,
      enrageTimer: 120 // seconds in phase 2
    };

    // Active telegraph attack in progress
    this.activeTelegraph = null; // { type: 'cleave'|'quake'|'leap', startTime, duration, data }

    this.statuses = {};
    this.isEnraged = false;
    this.isDead = false;
    this.isAwake = false;
  }

  // Adjust boss health based on party size
  scaleForParty(playerCount) {
    const scale = Math.max(1, playerCount);
    this.maxHp = Math.round(4000 + (scale - 1) * 2200);
    this.hp = this.maxHp;
  }

  update(dt, players, spawnAddsCallback, broadcastCallback) {
    if (this.isDead) return;

    // Boss remains dormant on his throne until players reach the Boss Sanctum (z <= -54.0)
    if (!this.isAwake) {
      const anyInChamber = Object.values(players).some(p => !p.isDead && !p.isDowned && p.z <= -54.0);
      if (anyInChamber) {
        this.isAwake = true;
        broadcastCallback({
          type: 'boss_awakened',
          bossId: this.id,
          bossName: this.name,
          bossTitle: this.title
        });
        broadcastCallback({
          type: 'narrator_announcement',
          text: 'MALAKOR AWAKENS! The Soul-Forge Warden rises from his molten throne!',
          tone: 'danger'
        });
      } else {
        return; // Stay dormant, do not move or attack
      }
    }

    // Update combo statuses
    ComboEngine.tickStatuses(this, dt);

    // If frozen, boss cannot act or move
    if (ComboEngine.hasStatus(this, 'frozen')) {
      return;
    }

    // Check phase transition
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.moveSpeed = 4.4;
      broadcastCallback({
        type: 'narrator_announcement',
        text: 'Malakor roars as the ancient Soul-Forge ignites! The chamber grows scorching hot!',
        tone: 'danger'
      });
      broadcastCallback({
        type: 'boss_phase_change',
        phase: 2,
        bossId: this.id
      });
    }

    // Phase 2 enrage countdown
    if (this.phase === 2 && !this.isEnraged) {
      this.timers.enrageTimer -= dt;
      if (this.timers.enrageTimer <= 0) {
        this.isEnraged = true;
        this.moveSpeed = 5.8;
        broadcastCallback({
          type: 'narrator_announcement',
          text: 'MALAKOR HAS ENRAGED! The flames burn beyond mortal endurance!',
          tone: 'warning'
        });
      }
    }

    // Decrement timers
    for (const key of Object.keys(this.timers)) {
      if (key !== 'enrageTimer') this.timers[key] = Math.max(0, this.timers[key] - dt);
    }

    // Filter alive players
    const alivePlayers = Object.values(players).filter(p => !p.isDowned && !p.isDead);
    if (alivePlayers.length === 0) {
      this.state = 'idle';
      return;
    }

    // Pick target: closest player or taunter
    let target = null;
    const tauntPlayer = alivePlayers.find(p => p.hasTaunted);
    if (tauntPlayer) {
      target = tauntPlayer;
    } else {
      let closestDist = Infinity;
      for (const p of alivePlayers) {
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < closestDist) {
          closestDist = d;
          target = p;
        }
      }
    }

    if (!target) return;
    this.targetPlayerId = target.id;

    // Face the target
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const distToTarget = Math.hypot(dx, dz);
    this.rotation = Math.atan2(dx, dz);

    // If currently executing a telegraph
    if (this.activeTelegraph) {
      this.activeTelegraph.elapsed += dt;
      if (this.activeTelegraph.elapsed >= this.activeTelegraph.duration) {
        // Telegraph resolves! Deliver hit!
        this.resolveTelegraph(players, broadcastCallback);
        this.activeTelegraph = null;
      }
      return; // Do not move during telegraph windup
    }

    // PHASE 2: Check Molten Leap (if player is far away and leap is ready)
    if (this.phase === 2 && this.timers.leap <= 0 && distToTarget > 6.0) {
      this.timers.leap = this.cooldowns.leap;
      this.activeTelegraph = {
        type: 'leap',
        duration: 1.8,
        elapsed: 0,
        targetX: target.x,
        targetZ: target.z,
        radius: 4.5
      };
      broadcastCallback({
        type: 'telegraph_start',
        telegraph: {
          id: `tel_${Date.now()}`,
          shape: 'circle',
          x: target.x,
          z: target.z,
          radius: 4.5,
          duration: 1.8,
          color: 0xff3300
        }
      });
      return;
    }

    // Ability: Seismic Quake (AoE concentric ring)
    if (this.timers.quake <= 0 && distToTarget < 8.0) {
      this.timers.quake = this.cooldowns.quake;
      this.activeTelegraph = {
        type: 'quake',
        duration: 2.0,
        elapsed: 0,
        x: this.x,
        z: this.z,
        radius: 6.5
      };
      broadcastCallback({
        type: 'telegraph_start',
        telegraph: {
          id: `tel_${Date.now()}`,
          shape: 'circle',
          x: this.x,
          z: this.z,
          radius: 6.5,
          duration: 2.0,
          color: 0xff4411
        }
      });
      return;
    }

    // Ability: Hammer Cleave (120-degree cone)
    if (this.timers.cleave <= 0 && distToTarget < 5.0) {
      this.timers.cleave = this.cooldowns.cleave;
      this.activeTelegraph = {
        type: 'cleave',
        duration: 1.5,
        elapsed: 0,
        x: this.x,
        z: this.z,
        angle: this.rotation,
        coneAngle: Math.PI * 0.66,
        radius: 5.5
      };
      broadcastCallback({
        type: 'telegraph_start',
        telegraph: {
          id: `tel_${Date.now()}`,
          shape: 'cone',
          x: this.x,
          z: this.z,
          angle: this.rotation,
          coneAngle: Math.PI * 0.66,
          radius: 5.5,
          duration: 1.5,
          color: 0xff1122
        }
      });
      return;
    }

    // Ability: Summon Cinder Thralls
    if (this.timers.summon <= 0 && this.hp < this.maxHp * 0.85) {
      this.timers.summon = this.cooldowns.summon;
      spawnAddsCallback(this.x, this.z, 3);
      broadcastCallback({
        type: 'narrator_announcement',
        text: 'Malakor strikes the anvil of souls! Cinder Thralls crawl from the slag!',
        tone: 'danger'
      });
      return;
    }

    // Basic Melee attack
    if (distToTarget <= 3.2) {
      if (this.timers.basic <= 0) {
        this.timers.basic = this.cooldowns.basic;
        // Swing at target
        if (typeof target.takeDamage === 'function') {
          target.takeDamage(this.isEnraged ? 65 : 38, 'physical', 'Malakor');
        }
        broadcastCallback({
          type: 'boss_attack_anim',
          attack: 'swing',
          bossId: this.id
        });
      }
    } else {
      // Walk toward target
      const step = (this.moveSpeed * dt) / distToTarget;
      this.x += dx * step;
      this.z += dz * step;

      // Keep Malakor inside the Boss Chamber
      this.x = Math.max(-21, Math.min(21, this.x));
      this.z = Math.max(-88, Math.min(-57, this.z));
    }
  }

  resolveTelegraph(players, broadcastCallback) {
    if (!this.activeTelegraph) return;
    const tel = this.activeTelegraph;

    broadcastCallback({
      type: 'screen_shake',
      magnitude: 0.65,
      duration: 0.4
    });

    if (tel.type === 'cleave') {
      // Check all players in cone
      for (const p of Object.values(players)) {
        if (p.isDowned || p.isDead) continue;
        const dx = p.x - tel.x;
        const dz = p.z - tel.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= tel.radius) {
          const angleToP = Math.atan2(dx, dz);
          let diff = Math.abs(angleToP - tel.angle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff <= tel.coneAngle / 2 && typeof p.takeDamage === 'function') {
            p.takeDamage(this.isEnraged ? 120 : 65, 'fire', 'Malakor Hammer Cleave');
          }
        }
      }
    } else if (tel.type === 'quake') {
      for (const p of Object.values(players)) {
        if (p.isDowned || p.isDead) continue;
        const dist = Math.hypot(p.x - tel.x, p.z - tel.z);
        if (dist <= tel.radius && typeof p.takeDamage === 'function') {
          p.takeDamage(this.isEnraged ? 140 : 75, 'blunt', 'Seismic Quake');
          p.stunDuration = 1.2;
        }
      }
    } else if (tel.type === 'leap') {
      this.x = tel.targetX;
      this.z = tel.targetZ;
      for (const p of Object.values(players)) {
        if (p.isDowned || p.isDead) continue;
        const dist = Math.hypot(p.x - tel.targetX, p.z - tel.targetZ);
        if (dist <= tel.radius && typeof p.takeDamage === 'function') {
          p.takeDamage(this.isEnraged ? 160 : 90, 'fire', 'Molten Leap Impact');
        }
      }
    }
  }

  takeDamage(amount, damageType, attacker) {
    if (this.isDead) return { damageDealt: 0, isDead: false };

    const seals = this.sealsRemaining !== undefined ? this.sealsRemaining : 0;
    const wardMult = seals === 2 ? 0.50 : (seals === 1 ? 0.75 : 1.20);
    const wardedAmount = Math.max(1, Math.round(amount * wardMult));

    // Process Combos via ComboEngine
    const combo = ComboEngine.processHit(attacker, this, damageType, wardedAmount);
    const totalDmg = wardedAmount + combo.bonusDamage;

    this.hp = Math.max(0, this.hp - totalDmg);

    if (this.hp <= 0 && !this.isDead) {
      this.isDead = true;
      return {
        damageDealt: totalDmg,
        combo,
        isDead: true,
        killer: attacker
      };
    }

    return {
      damageDealt: totalDmg,
      combo,
      isDead: false
    };
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      z: this.z,
      hp: this.hp,
      maxHp: this.maxHp,
      phase: this.phase,
      rotation: this.rotation,
      isEnraged: this.isEnraged,
      isAwake: this.isAwake,
      isDead: this.isDead,
      sealsRemaining: this.sealsRemaining ?? 2,
      statuses: this.statuses,
      activeTelegraph: this.activeTelegraph ? {
        type: this.activeTelegraph.type,
        x: this.activeTelegraph.targetX ?? this.activeTelegraph.x,
        z: this.activeTelegraph.targetZ ?? this.activeTelegraph.z,
        radius: this.activeTelegraph.radius,
        progress: this.activeTelegraph.elapsed / this.activeTelegraph.duration
      } : null
    };
  }
}

module.exports = MalakorBoss;
