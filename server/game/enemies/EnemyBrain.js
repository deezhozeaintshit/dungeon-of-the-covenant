// ============================================================
// Dungeon of the Covenant — Phase 2
// server/game/enemies/EnemyBrain.js
// SERVER-side enemy state machine. Supersedes src/core/enemy_ai.js
// (single-player, client-ish) for all Phase-2 server mobs.
//
// States: patrol (waypoints) / chase / attack (windup -> resolve) /
//         flee (low-HP casters) / search (lost player)
//
// Multiplayer: target selection supports nearest / lowest-hp /
// highest-threat policies per archetype, plus taunt override.
// All damage is computed server-side and applied through
// ctx.damagePlayer / ctx.spawnProjectile — the brain never trusts
// the client.
//
// Tick: coordinator calls brain.update(dt, ctx) once per mob per
// server tick (dt in SECONDS). The brain is also safe to drive from
// a Room.updateMobs replacement loop.
// ============================================================

'use strict';

// ----------------------------------------------------------------
// ctx contract (provided by the coordinator / Room):
// {
//   players:        { [socketId]: player }  player: {id,x,z,hp,maxHp,
//                    isDowned,isDead,rotation,hasTaunted,stats?}
//   mobs:           Array<mob>              (for caster heals + separation)
//   broadcast:      (msg) => void
//   damagePlayer:   (player, amount, damageType, sourceName) => void
//   healMob:        (mob, amount) => void            (optional)
//   spawnProjectile:(opts) => void                  (optional; ranged/caster)
//   moveEntity:     (mob, dirX, dirZ, speed, dt) => {x,z} (optional;
//                    falls back to direct position integration)
//   hasLineOfSight: (x1,z1,x2,z2) => bool           (optional; default true)
//   nextTelegraphId:() => string                    (optional)
//   time:           number (seconds, optional; Date fallback)
// }
// ----------------------------------------------------------------

const STATES = ['patrol', 'chase', 'attack', 'flee', 'search'];

const SEARCH_LOOK_TIME = 3.0;   // s spent looking at last-known pos
const SEARCH_GIVEUP_TIME = 6.0; // s before returning to patrol
const FLEE_HP_FRACTION = 0.30;  // casters flee below this
const FLEE_DURATION = 3.0;       // s of fleeing before re-engaging
const THREAT_DECAY_PER_SEC = 0.05;
const SEPARATION_RADIUS = 1.6;

class EnemyBrain {
  constructor(mob) {
    this.mob = mob;
    // AI scratch state lives on the mob so it survives room serialization
    // boundaries and so the coordinator can inspect it.
    if (!mob._ai) {
      mob._ai = {
        state: 'patrol',
        stateTime: 0,
        targetId: null,
        lastKnownX: mob.x,
        lastKnownZ: mob.z,
        waypointX: mob.x + (Math.random() - 0.5) * 8,
        waypointZ: mob.z + (Math.random() - 0.5) * 8,
        waypointWait: 0,
        spawnX: mob.x,
        spawnZ: mob.z,
        threat: {},          // playerId -> threat value
        windup: null,        // active attack windup or null
        fleeUntil: 0,
        pounceTimer: 0,
        healTimer: 0,
        slamTimer: 0,
        lostSightTime: 0,
        searchLooked: false,
        stealthed: !!mob.stealth
      };
      mob.stealthed = !!mob.stealth;
    }
    this.ai = mob._ai;
  }

  get state() { return this.ai.state; }

  // -- threat -------------------------------------------------------
  // Coordinator calls this whenever a player damages this mob so the
  // highest_threat policy has real data. Safe to call with any ids.
  registerThreat(playerId, amount) {
    if (!playerId) return;
    this.ai.threat[playerId] = (this.ai.threat[playerId] || 0) + Math.max(0, amount);
  }

  // -- main tick ----------------------------------------------------
  update(dt, ctx) {
    const mob = this.mob;
    if (!mob || mob.isDead) return;
    if (mob.statuses && mob.statuses.frozen) return; // frozen: no act
    dt = Math.max(0, Math.min(dt, 0.25)); // clamp runaway ticks

    this.ai.stateTime += dt;
    this._decayThreat(dt);

    // Resolve an in-progress windup first (telegraphs resolve even if the
    // target moved — the hit test happens at resolve time).
    if (this.ai.windup) {
      this._tickWindup(dt, ctx);
      return;
    }

    const target = this._selectTarget(ctx);

    switch (this.ai.state) {
      case 'patrol': this._tickPatrol(dt, ctx, target); break;
      case 'chase':  this._tickChase(dt, ctx, target); break;
      case 'attack': this._tickAttack(dt, ctx, target); break;
      case 'flee':   this._tickFlee(dt, ctx, target); break;
      case 'search': this._tickSearch(dt, ctx, target); break;
      default: this._setState('patrol');
    }
  }

  // -- target selection ---------------------------------------------
  _alivePlayers(ctx) {
    return Object.values(ctx.players || {}).filter(p => p && !p.isDowned && !p.isDead);
  }

  _distTo(mob, p) {
    return Math.hypot(p.x - mob.x, p.z - mob.z);
  }

  _selectTarget(ctx) {
    const mob = this.mob;
    const players = this._alivePlayers(ctx);
    if (players.length === 0) { this.ai.targetId = null; return null; }

    const inAggro = players.filter(p => this._distTo(mob, p) <= mob.aggroRange);
    if (inAggro.length === 0) { this.ai.targetId = null; return null; }

    // Taunt always wins.
    const taunter = inAggro.find(p => p.hasTaunted);
    if (taunter) { this.ai.targetId = taunter.id; return taunter; }

    // Keep current target while valid (no flapping between frames).
    const current = inAggro.find(p => p.id === this.ai.targetId);
    if (current && this._distTo(mob, current) <= mob.aggroRange * 1.25) return current;

    let pick = null;
    const policy = mob.targetPolicy || 'nearest';
    if (policy === 'lowest_hp') {
      pick = inAggro.reduce((a, b) => (b.hp / b.maxHp) < (a.hp / a.maxHp) ? b : a);
    } else if (policy === 'highest_threat') {
      let best = -1;
      for (const p of inAggro) {
        const t = (this.ai.threat[p.id] || 0) - this._distTo(mob, p) * 2; // distance penalty
        if (t > best) { best = t; pick = p; }
      }
      if (!pick) pick = inAggro.reduce((a, b) => this._distTo(mob, a) < this._distTo(mob, b) ? a : b);
    } else {
      pick = inAggro.reduce((a, b) => this._distTo(mob, a) < this._distTo(mob, b) ? a : b);
    }

    this.ai.targetId = pick.id;
    return pick;
  }

  // -- state ticks ----------------------------------------------------
  _tickPatrol(dt, ctx, target) {
    const mob = this.mob;
    if (target) { this._setState('chase'); this.ai.lostSightTime = 0; return; }

    // Stealth resets out of combat for assassins.
    if (mob.stealth && !this.ai.stealthed) {
      this.ai.stealthed = true;
      mob.stealthed = true;
    }

    if (this.ai.waypointWait > 0) {
      this.ai.waypointWait -= dt;
    } else {
      const dx = this.ai.waypointX - mob.x;
      const dz = this.ai.waypointZ - mob.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        this.ai.waypointWait = 1.0 + Math.random() * 2.0;
        this.ai.waypointX = this.ai.spawnX + (Math.random() - 0.5) * 10;
        this.ai.waypointZ = this.ai.spawnZ + (Math.random() - 0.5) * 10;
      } else {
        this._move(mob, dx / d, dz / d, mob.speed * 0.35, dt, ctx);
        mob.rotation = Math.atan2(dx, dz);
      }
    }
  }

  _tickChase(dt, ctx, target) {
    const mob = this.mob;
    if (!target) { this._setState('search'); return; }

    const d = this._distTo(mob, target);
    const seen = this._canSee(ctx, mob, target);
    if (!seen) {
      this.ai.lostSightTime += dt;
      if (this.ai.lostSightTime > 4.0) { this._setState('search'); return; }
    } else {
      this.ai.lostSightTime = 0;
      this.ai.lastKnownX = target.x;
      this.ai.lastKnownZ = target.z;
    }

    // Assassin stealth breaks when close.
    if (mob.stealth && this.ai.stealthed && d <= (mob.stealthBreakRange || 6)) {
      this.ai.stealthed = false;
      mob.stealthed = false;
    }

    // Low-HP casters break off to flee.
    if (mob.canFlee && mob.hp <= mob.maxHp * FLEE_HP_FRACTION) {
      this._setState('flee');
      this.ai.fleeUntil = this.ai.stateTime + FLEE_DURATION;
      return;
    }

    // Assassin pounce: blink behind the target, next hit crits.
    if (mob.pounce) {
      this.ai.pounceTimer -= dt;
      if (this.ai.pounceTimer <= 0 && d > 2.5 && d <= (mob.pounceRange || 14)) {
        this.ai.pounceTimer = mob.pounceCooldown || 4.8;
        const behindX = target.x - Math.sin(target.rotation || 0) * 1.4;
        const behindZ = target.z - Math.cos(target.rotation || 0) * 1.4;
        mob.x = behindX;
        mob.z = behindZ;
        mob._pounceCrit = true;
        this.ai.stealthed = false;
        mob.stealthed = false;
        ctx.broadcast({
          type: 'floating_text',
          text: 'SHADOW AMBUSH!',
          x: mob.x, z: mob.z,
          style: 'crit'
        });
        this._beginWindup(ctx, target, { forceMelee: true });
        return;
      }
    }

    // Elite slam: telegraphed AoE when the pack is close.
    if (mob.slamAttack) {
      this.ai.slamTimer -= dt;
      if (this.ai.slamTimer <= 0 && d <= mob.slamAttack.radius + 2.5) {
        this.ai.slamTimer = mob.slamAttack.cooldown;
        this._beginWindup(ctx, target, { slam: true });
        return;
      }
    }

    if (d <= mob.attackRange) {
      this._setState('attack');
      return;
    }

    // Ranged/caster kiters hold their desired range.
    let mx = (target.x - mob.x) / (d || 1);
    let mz = (target.z - mob.z) / (d || 1);
    if (mob.desiredRange && d < mob.desiredRange * 0.7 && (mob.role === 'ranged' || mob.role === 'caster' || mob.role === 'elite')) {
      mx = -mx; mz = -mz; // back off
    }
    const slowed = this._isSlowed(mob) ? 0.4 : 1.0;
    this._move(mob, mx, mz, mob.speed * slowed, dt, ctx);
    mob.rotation = Math.atan2(target.x - mob.x, target.z - mob.z);
    this._separate(mob, ctx, dt);
  }

  _tickAttack(dt, ctx, target) {
    const mob = this.mob;
    if (!target) { this._setState('search'); return; }
    const d = this._distTo(mob, target);
    // Drift out of attack if the target escaped well beyond range.
    if (d > mob.attackRange * 1.6 && mob.role !== 'ranged' && mob.role !== 'caster') {
      this._setState('chase');
      return;
    }
    mob.rotation = Math.atan2(target.x - mob.x, target.z - mob.z);
    mob.attackTimer = (mob.attackTimer || 0) - dt;
    if (mob.attackTimer <= 0) {
      mob.attackTimer = mob.attackCooldown;
      this._beginWindup(ctx, target, {});
    }
  }

  _tickFlee(dt, ctx, target) {
    const mob = this.mob;
    // Keep casting while fleeing, at a slower cadence.
    mob.attackTimer = (mob.attackTimer || 0) - dt;
    if (target && mob.attackTimer <= 0 && this._distTo(mob, target) <= mob.attackRange) {
      mob.attackTimer = mob.attackCooldown * 1.5;
      this._beginWindup(ctx, target, {});
    }
    if (this.ai.stateTime >= this.ai.fleeUntil || mob.hp > mob.maxHp * FLEE_HP_FRACTION * 1.5) {
      this._setState(target ? 'chase' : 'search');
      return;
    }
    if (target) {
      const d = this._distTo(mob, target) || 1;
      this._move(mob, (mob.x - target.x) / d, (mob.z - target.z) / d, mob.speed * 0.9, dt, ctx);
    }
  }

  _tickSearch(dt, ctx, target) {
    const mob = this.mob;
    if (target) { this._setState('chase'); this.ai.lostSightTime = 0; return; }
    if (this.ai.stateTime > SEARCH_GIVEUP_TIME) {
      this.ai.targetId = null;
      this._setState('patrol');
      return;
    }
    const dx = this.ai.lastKnownX - mob.x;
    const dz = this.ai.lastKnownZ - mob.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.0) {
      this._move(mob, dx / d, dz / d, mob.speed * 0.7, dt, ctx);
    } else if (!this.ai.searchLooked && this.ai.stateTime > SEARCH_LOOK_TIME) {
      this.ai.searchLooked = true;
      mob.rotation = (mob.rotation || 0) + Math.PI; // look around
    }
  }

  // -- windup / telegraph ---------------------------------------------
  // Every attack announces itself first: the server broadcasts an
  // enemy_telegraph, waits telegraphMs, then resolves damage
  // server-side. Nothing about the hit is decided on the client.
  _beginWindup(ctx, target, opts) {
    const mob = this.mob;
    const telId = ctx.nextTelegraphId ? ctx.nextTelegraphId() : `etel_${mob.id}_${Date.now()}`;

    let shape = 'circle';
    let tx = mob.x, tz = mob.z;
    let radius = 2.3;
    let color = 0xff2222;
    let kind = 'melee';

    if (opts.slam && mob.slamAttack) {
      kind = 'slam';
      tx = target.x; tz = target.z;
      radius = mob.slamAttack.radius;
      color = mob.slamAttack.color || 0xff1133;
    } else if (mob.role === 'ranged' || mob.role === 'caster' || (mob.role === 'elite' && mob.volley)) {
      kind = 'ranged';
      shape = 'point';
      radius = 0.9;
      color = mob.role === 'caster' ? 0xb845ff : 0x44ff66;
    } else if (mob.role === 'assassin' && opts.forceMelee) {
      kind = 'pounce';
      tx = target.x; tz = target.z;
      radius = 2.0;
      color = 0xaa33ff;
    }

    const windupMs = mob.telegraphMs || 600;
    this.ai.windup = {
      id: telId,
      kind,
      targetId: target ? target.id : null,
      x: tx, z: tz,
      radius,
      elapsedMs: 0,
      windupMs,
      crit: !!mob._pounceCrit
    };
    mob._pounceCrit = false;

    ctx.broadcast({
      type: 'enemy_telegraph',
      enemyId: mob.id,
      telegraph: {
        id: telId,
        shape,
        x: +tx.toFixed(2),
        z: +tz.toFixed(2),
        radius,
        angle: +(mob.rotation || 0).toFixed(3),
        duration: +(windupMs / 1000).toFixed(3),
        color
      },
      windupMs,
      kind
    });

    this._setState('attack');
  }

  _tickWindup(dt, ctx) {
    const mob = this.mob;
    const w = this.ai.windup;
    w.elapsedMs += dt * 1000;
    if (w.elapsedMs < w.windupMs) return;

    // Windup complete: resolve server-side.
    this.ai.windup = null;
    const target = w.targetId ? (ctx.players || {})[w.targetId] : null;
    const alive = target && !target.isDowned && !target.isDead;

    if (w.kind === 'ranged') {
      if (alive && ctx.spawnProjectile && mob.projectile) {
        const dx = target.x - mob.x;
        const dz = target.z - mob.z;
        const d = Math.hypot(dx, dz) || 1;
        const proj = mob.projectile;
        if (mob.volley) {
          const baseAngle = Math.atan2(dx, dz);
          for (const off of [-mob.volley.spread, 0, mob.volley.spread]) {
            const ang = baseAngle + off;
            ctx.spawnProjectile({
              isEnemy: true, sourceName: mob.name,
              x: mob.x + Math.sin(ang) * 0.9, y: 1.2, z: mob.z + Math.cos(ang) * 0.9,
              vx: Math.sin(ang) * mob.volley.speed, vz: Math.cos(ang) * mob.volley.speed,
              radius: mob.volley.radius, damage: mob.damage,
              damageType: mob.damageType, color: mob.volley.color, life: 2.2
            });
          }
        } else {
          ctx.spawnProjectile({
            isEnemy: true, sourceName: mob.name,
            x: mob.x + (dx / d) * 0.8, y: 1.1, z: mob.z + (dz / d) * 0.8,
            vx: (dx / d) * proj.speed, vz: (dz / d) * proj.speed,
            radius: proj.radius, damage: mob.damage,
            damageType: mob.damageType, color: proj.color, life: proj.life
          });
        }
      }
    } else {
      // Melee / slam / pounce: radial hit test at resolve time.
      const cx = w.kind === 'melee' ? mob.x : w.x;
      const cz = w.kind === 'melee' ? mob.z : w.z;
      let dmg = mob.damage;
      if (w.kind === 'slam' && mob.slamAttack) dmg = Math.round(mob.damage * mob.slamAttack.damageMult);
      if (w.crit) dmg = Math.round(dmg * (mob.pounceCritMult || 1.5));
      for (const p of this._alivePlayers(ctx)) {
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d <= w.radius + 0.4) {
          // Phase 2: pass mob as 5th arg so Room.damagePlayer can apply
          // oath thorns reflect + nemesis grudge modifiers.
          ctx.damagePlayer(p, dmg, mob.damageType, mob.name, mob);
          if (w.crit) {
            ctx.broadcast({ type: 'floating_text', text: `CRIT -${dmg}`, x: p.x, z: p.z, style: 'crit' });
          }
        }
      }
      if (w.kind === 'slam') {
        ctx.broadcast({ type: 'screen_shake', magnitude: 0.35, duration: 0.3 });
      }
    }

    // Re-acquire after the swing.
    const next = this._selectTarget(ctx);
    this._setState(next ? 'chase' : 'search');
  }

  // -- helpers ---------------------------------------------------------
  _setState(s) {
    if (!STATES.includes(s)) s = 'patrol';
    this.ai.state = s;
    this.ai.stateTime = 0;
    this.ai.searchLooked = false;
    if (s === 'chase') this.ai.lostSightTime = 0;
  }

  _canSee(ctx, mob, target) {
    if (typeof ctx.hasLineOfSight === 'function') {
      return ctx.hasLineOfSight(mob.x, mob.z, target.x, target.z);
    }
    return true;
  }

  _isSlowed(mob) {
    return !!(mob.statuses && (mob.statuses.tar || mob.statuses.slow));
  }

  _move(mob, dirX, dirZ, speed, dt, ctx) {
    if (typeof ctx.moveEntity === 'function') {
      const np = ctx.moveEntity(mob, dirX, dirZ, speed, dt);
      if (np) { mob.x = np.x; mob.z = np.z; }
      return;
    }
    mob.x += dirX * speed * dt;
    mob.z += dirZ * speed * dt;
  }

  _separate(mob, ctx, dt) {
    if (!Array.isArray(ctx.mobs)) return;
    for (const other of ctx.mobs) {
      if (other === mob || other.isDead) continue;
      const dx = mob.x - other.x;
      const dz = mob.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < SEPARATION_RADIUS) {
        const push = (SEPARATION_RADIUS - d) * 2.0 * dt;
        mob.x += (dx / d) * push;
        mob.z += (dz / d) * push;
      }
    }
  }

  _decayThreat(dt) {
    const mult = Math.max(0, 1 - THREAT_DECAY_PER_SEC * dt);
    for (const k of Object.keys(this.ai.threat)) {
      this.ai.threat[k] *= mult;
      if (this.ai.threat[k] < 1) delete this.ai.threat[k];
    }
  }

  // Snapshot for debugging / admin tooling.
  getDebug() {
    return {
      id: this.mob.id,
      type: this.mob.type,
      state: this.ai.state,
      stateTime: +this.ai.stateTime.toFixed(2),
      targetId: this.ai.targetId,
      stealthed: !!this.ai.stealthed,
      windingUp: !!this.ai.windup,
      threat: { ...this.ai.threat }
    };
  }
}

module.exports = { EnemyBrain, STATES };
