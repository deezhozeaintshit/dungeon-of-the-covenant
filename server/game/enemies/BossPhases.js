// ============================================================
// Dungeon of the Covenant — Phase 2
// server/game/enemies/BossPhases.js
// Biome-tied multi-phase boss fights.
//
// Each biome gets its own Sovereign (all mount boss_sovereign.glb with
// a biome reskin tint). Fights run 3 phases with HP-threshold
// transitions; every phase unlocks new telegraphed attack patterns.
// Phase changes are broadcast via {type:'boss_phase', ...} so the
// client can banner them.
//
// SERVER-AUTHORITATIVE: telegraphs resolve here, damage goes through
// ctx.damagePlayer. The client only draws decals and the HP bar.
//
// Coordinator wiring:
//   const boss = BossPhases.createBoss('forge', x, z, partySize);
//   // per tick: boss.update(dt, ctx)
//   // ctx: { players, broadcast, damagePlayer,
//   //        spawnAdds(type, x, z, count), spawnProjectile(opts),
//   //        nextTelegraphId() }
//   roomState.boss = boss.getState();
// ============================================================

'use strict';

const BOSS_MODEL = 'boss_sovereign.glb';

// Attack pattern implementations are data + one executor each.
// cooldown: seconds between uses. range: [min,max] target distance.
// weight: relative pick probability when multiple are ready.
const BOSS_TABLE = {
  crypt: {
    name: 'Veylith, the Ossuary Matriarch',
    title: 'Matriarch of the Bone Vaults',
    reskinTint: 0x9fc8ee,
    baseHp: 5200,
    addsTypes: ['rot_hound', 'skel_warrior'],
    phases: [
      {
        threshold: 1.0, name: 'The Matriarch Wakes',
        banner: 'VEYLITH WAKES! The bone vaults rattle!',
        speedMult: 1.0, damageMult: 1.0, cooldownMult: 1.0,
        attacks: [
          { id: 'aoe_slam', cooldown: 9, range: [0, 9], weight: 3 },
          { id: 'summon_adds', cooldown: 20, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.66, name: 'Choir of Splinters',
        banner: 'VEYLITH CALLS THE CHOIR! Splinters rain from the dark!',
        speedMult: 1.15, damageMult: 1.2, cooldownMult: 0.9,
        attacks: [
          { id: 'aoe_slam', cooldown: 8, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 11, range: [0, 8], weight: 3 },
          { id: 'summon_adds', cooldown: 18, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.33, name: 'Ossuary Collapse',
        banner: 'VEYLITH IS FRENZIED! The crypt itself turns against you!',
        speedMult: 1.3, damageMult: 1.45, cooldownMult: 0.75,
        enrageAfter: 75,
        attacks: [
          { id: 'aoe_slam', cooldown: 7, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 9, range: [0, 8], weight: 3 },
          { id: 'volley', cooldown: 10, range: [4, 22], weight: 2 },
          { id: 'summon_adds', cooldown: 16, range: [0, 30], weight: 2 }
        ]
      }
    ]
  },
  cavern: {
    name: 'Glacius, Warden of the Rime',
    title: 'Warden of the Frozen Reliquary',
    reskinTint: 0x66ddff,
    baseHp: 5400,
    addsTypes: ['rot_hound', 'cultist_archer'],
    phases: [
      {
        threshold: 1.0, name: 'The Rime Stirs',
        banner: 'GLACIUS STIRS! The air freezes in your lungs!',
        speedMult: 1.0, damageMult: 1.0, cooldownMult: 1.0,
        attacks: [
          { id: 'cone_sweep', cooldown: 10, range: [0, 8], weight: 3 },
          { id: 'summon_adds', cooldown: 20, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.66, name: 'Whiteout',
        banner: 'WHITEOUT! Glacius shatters the ice around him!',
        speedMult: 1.15, damageMult: 1.2, cooldownMult: 0.9,
        attacks: [
          { id: 'aoe_slam', cooldown: 9, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 9, range: [0, 8], weight: 3 },
          { id: 'leap', cooldown: 14, range: [7, 24], weight: 2 }
        ]
      },
      {
        threshold: 0.33, name: 'Absolute Zero',
        banner: 'ABSOLUTE ZERO! Flee the cold or become part of it!',
        speedMult: 1.3, damageMult: 1.45, cooldownMult: 0.75,
        enrageAfter: 75,
        attacks: [
          { id: 'aoe_slam', cooldown: 7, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 8, range: [0, 8], weight: 3 },
          { id: 'volley', cooldown: 9, range: [4, 22], weight: 3 },
          { id: 'leap', cooldown: 12, range: [7, 24], weight: 2 }
        ]
      }
    ]
  },
  forge: {
    name: 'Malakor, Soul-Forge Warden',
    title: 'Lord of the Smoldering Crypt',
    reskinTint: 0xff7722,
    baseHp: 5600,
    addsTypes: ['rot_hound', 'skel_warrior'],
    phases: [
      {
        threshold: 1.0, name: 'The Warden Rises',
        banner: 'MALAKOR AWAKENS! The Soul-Forge Warden rises from his molten throne!',
        speedMult: 1.0, damageMult: 1.0, cooldownMult: 1.0,
        attacks: [
          { id: 'aoe_slam', cooldown: 9, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 11, range: [0, 8], weight: 2 },
          { id: 'summon_adds', cooldown: 20, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.66, name: 'Soul-Forge Ignition',
        banner: 'THE SOUL-FORGE IGNITES! The chamber grows scorching hot!',
        speedMult: 1.2, damageMult: 1.25, cooldownMult: 0.9,
        attacks: [
          { id: 'aoe_slam', cooldown: 8, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 9, range: [0, 8], weight: 3 },
          { id: 'leap', cooldown: 13, range: [7, 24], weight: 2 },
          { id: 'summon_adds', cooldown: 18, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.33, name: 'Warden\'s Pyre',
        banner: 'THE WARDEN\'S PYRE! Malakor burns with the fury of the forge!',
        speedMult: 1.35, damageMult: 1.5, cooldownMult: 0.72,
        enrageAfter: 60,
        attacks: [
          { id: 'aoe_slam', cooldown: 6.5, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 8, range: [0, 8], weight: 3 },
          { id: 'volley', cooldown: 9, range: [4, 22], weight: 2 },
          { id: 'leap', cooldown: 11, range: [7, 24], weight: 2 }
        ]
      }
    ]
  },
  throne_room: {
    name: 'The Covenant Sovereign',
    title: 'Voice of the Astral Rift',
    reskinTint: 0xaa33ff,
    baseHp: 6000,
    addsTypes: ['void_assassin', 'skel_warrior'],
    phases: [
      {
        threshold: 1.0, name: 'The Rift Opens',
        banner: 'THE SOVEREIGN MANIFESTS! Reality thins around the throne!',
        speedMult: 1.0, damageMult: 1.0, cooldownMult: 1.0,
        attacks: [
          { id: 'volley', cooldown: 10, range: [4, 22], weight: 3 },
          { id: 'cone_sweep', cooldown: 11, range: [0, 8], weight: 2 },
          { id: 'summon_adds', cooldown: 22, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.66, name: 'Dimensional Echo',
        banner: 'DIMENSIONAL ECHO! The Sovereign is everywhere at once!',
        speedMult: 1.2, damageMult: 1.25, cooldownMult: 0.88,
        attacks: [
          { id: 'leap', cooldown: 12, range: [7, 24], weight: 3 },
          { id: 'volley', cooldown: 9, range: [4, 22], weight: 3 },
          { id: 'aoe_slam', cooldown: 9, range: [0, 9], weight: 2 },
          { id: 'summon_adds', cooldown: 18, range: [0, 30], weight: 2 }
        ]
      },
      {
        threshold: 0.33, name: 'Covenant Unbound',
        banner: 'THE COVENANT IS UNBOUND! Survive the unraveling!',
        speedMult: 1.35, damageMult: 1.5, cooldownMult: 0.7,
        enrageAfter: 60,
        attacks: [
          { id: 'leap', cooldown: 10, range: [7, 24], weight: 3 },
          { id: 'volley', cooldown: 8, range: [4, 22], weight: 3 },
          { id: 'aoe_slam', cooldown: 7, range: [0, 9], weight: 3 },
          { id: 'cone_sweep', cooldown: 8, range: [0, 8], weight: 2 }
        ]
      }
    ]
  }
};

function normalizeBossBiome(biomeId) {
  const map = { ossuary_crypt: 'crypt', glacial_sanctum: 'cavern', blood_citadel: 'forge', void_nexus: 'throne_room', blight_catacombs: 'cavern' };
  if (BOSS_TABLE[biomeId]) return biomeId;
  return map[biomeId] || 'forge';
}

class PhaseBoss {
  constructor(cfg, x, z, partySize) {
    const party = Math.max(1, partySize || 1);
    this.id = `boss_${cfg.name.toLowerCase().replace(/[^a-z]+/g, '_')}`;
    this.biomeId = cfg.biomeId;
    this.name = cfg.name;
    this.title = cfg.title;
    this.model = BOSS_MODEL;
    this.reskinTint = cfg.reskinTint;
    this.x = x; this.y = 0; this.z = z;
    this.radius = 2.2;
    this.rotation = 0;

    this.maxHp = Math.round(cfg.baseHp * (1 + 0.35 * (party - 1)));
    this.hp = this.maxHp;

    this.phaseIndex = 0;
    this.phases = cfg.phases;
    this.addsTypes = cfg.addsTypes;
    this.isAwake = false;
    this.isDead = false;
    this.isEnraged = false;
    this.enrageTimer = null;
    this.targetPlayerId = null;
    this.activeTelegraph = null;

    // Per-attack cooldown timers, keyed by attack id.
    this.timers = {};
    this.basicTimer = 1.0;
    this.moveSpeed = 3.6;
    this.basicDamage = 38;
    this.statuses = {};
  }

  get phase() { return this.phaseIndex + 1; }
  get phaseName() { return this.phases[this.phaseIndex].name; }

  _phaseMods() {
    const p = this.phases[this.phaseIndex];
    return {
      speedMult: p.speedMult || 1,
      damageMult: (p.damageMult || 1) * (this.isEnraged ? 1.4 : 1),
      cooldownMult: p.cooldownMult || 1
    };
  }

  update(dt, ctx) {
    if (this.isDead) return;
    dt = Math.max(0, Math.min(dt, 0.25));

    // Dormant until the party reaches the sanctum.
    if (!this.isAwake) {
      const near = Object.values(ctx.players || {}).some(
        p => !p.isDead && !p.isDowned && Math.hypot(p.x - this.x, p.z - this.z) <= 14
      );
      if (near) {
        this.isAwake = true;
        const cfg = this.phases[0];
        ctx.broadcast({ type: 'boss_awakened', bossId: this.id, bossName: this.name, bossTitle: this.title });
        ctx.broadcast({ type: 'narrator_announcement', text: cfg.banner, tone: 'danger' });
        ctx.broadcast({ type: 'boss_phase', bossId: this.id, phase: 1, name: cfg.name, title: this.title });
      } else {
        return;
      }
    }

    if (this.statuses.frozen) return;

    this._checkPhaseTransition(ctx);

    // Final-phase enrage countdown.
    const phaseCfg = this.phases[this.phaseIndex];
    if (phaseCfg.enrageAfter && !this.isEnraged) {
      if (this.enrageTimer == null) this.enrageTimer = phaseCfg.enrageAfter;
      this.enrageTimer -= dt;
      if (this.enrageTimer <= 0) {
        this.isEnraged = true;
        ctx.broadcast({
          type: 'narrator_announcement',
          text: `${this.name.toUpperCase()} HAS ENRAGED!`,
          tone: 'warning'
        });
        ctx.broadcast({ type: 'floating_text', text: 'ENRAGED', x: this.x, z: this.z, style: 'crit' });
      }
    }

    // Resolve an in-flight telegraph.
    if (this.activeTelegraph) {
      this.activeTelegraph.elapsed += dt;
      if (this.activeTelegraph.elapsed >= this.activeTelegraph.duration) {
        const tel = this.activeTelegraph;
        this.activeTelegraph = null;
        this._resolveTelegraph(tel, ctx);
      }
      return; // rooted during windup
    }

    const alive = Object.values(ctx.players || {}).filter(p => !p.isDowned && !p.isDead);
    if (alive.length === 0) return;

    // Target: taunter wins, else nearest.
    let target = alive.find(p => p.hasTaunted) || null;
    if (!target) {
      let best = Infinity;
      for (const p of alive) {
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < best) { best = d; target = p; }
      }
    }
    if (!target) return;
    this.targetPlayerId = target.id;

    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    this.rotation = Math.atan2(dx, dz);

    // Pick an attack.
    const mods = this._phaseMods();
    const ready = [];
    for (const atk of phaseCfg.attacks) {
      const t = this.timers[atk.id] || 0;
      if (t <= 0 && dist >= atk.range[0] && dist <= atk.range[1]) {
        ready.push(atk);
      }
    }
    for (const k of Object.keys(this.timers)) {
      this.timers[k] = Math.max(0, this.timers[k] - dt);
    }

    if (ready.length > 0) {
      let totalW = 0;
      for (const a of ready) totalW += a.weight;
      let roll = Math.random() * totalW;
      let pick = ready[0];
      for (const a of ready) { roll -= a.weight; if (roll <= 0) { pick = a; break; } }
      this.timers[pick.id] = pick.cooldown * mods.cooldownMult;
      this._startAttack(pick.id, target, ctx, mods);
      return;
    }

    // Filler: basic melee or advance.
    const speed = this.moveSpeed * mods.speedMult;
    if (dist <= 3.4) {
      this.basicTimer -= dt;
      if (this.basicTimer <= 0) {
        this.basicTimer = 2.0 * mods.cooldownMult;
        ctx.damagePlayer(target, Math.round(this.basicDamage * mods.damageMult), 'physical', `${this.name} Strike`);
        ctx.broadcast({ type: 'boss_attack_anim', attack: 'swing', bossId: this.id });
      }
    } else {
      const step = (speed * dt) / dist;
      this.x += dx * step;
      this.z += dz * step;
    }
  }

  _checkPhaseTransition(ctx) {
    const frac = this.hp / this.maxHp;
    let next = this.phaseIndex;
    for (let i = 0; i < this.phases.length; i++) {
      if (frac <= this.phases[i].threshold) next = i;
    }
    if (next !== this.phaseIndex) {
      this.phaseIndex = next;
      const cfg = this.phases[next];
      this.activeTelegraph = null; // new phase interrupts windups
      this.timers = {};
      this.isEnraged = false;
      this.enrageTimer = null;
      ctx.broadcast({
        type: 'boss_phase',
        bossId: this.id,
        phase: next + 1,
        name: cfg.name,
        title: this.title
      });
      ctx.broadcast({ type: 'narrator_announcement', text: cfg.banner, tone: 'danger' });
      ctx.broadcast({ type: 'screen_shake', magnitude: 0.5, duration: 0.5 });
    }
  }

  _telId(ctx, kind) {
    return ctx.nextTelegraphId ? ctx.nextTelegraphId() : `btel_${this.id}_${kind}_${Date.now()}`;
  }

  _startAttack(attackId, target, ctx, mods) {
    const dmg = (base) => Math.round(base * mods.damageMult);
    if (attackId === 'summon_adds') {
      if (typeof ctx.spawnAdds !== 'function') return; // coordinator must wire adds
      const n = 2 + (this.phaseIndex >= 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const type = this.addsTypes[i % this.addsTypes.length];
        const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
        ctx.spawnAdds(type, this.x + Math.cos(ang) * 4, this.z + Math.sin(ang) * 4, 1);
      }
      ctx.broadcast({
        type: 'narrator_announcement',
        text: `${this.name} rends the dark — minions crawl forth!`,
        tone: 'danger'
      });
      return;
    }
    if (attackId === 'volley') {
      if (typeof ctx.spawnProjectile !== 'function') return; // coordinator must wire projectiles
      const bolts = 8 + this.phaseIndex * 4;
      const baseAng = Math.atan2(target.x - this.x, target.z - this.z);
      for (let i = 0; i < bolts; i++) {
        const ang = baseAng + (i / bolts) * Math.PI * 2;
        ctx.spawnProjectile({
          isEnemy: true, sourceName: this.name,
          x: this.x + Math.sin(ang) * 1.2, y: 1.4, z: this.z + Math.cos(ang) * 1.2,
          vx: Math.sin(ang) * 9.5, vz: Math.cos(ang) * 9.5,
          radius: 0.45, damage: dmg(30), damageType: 'dark',
          color: this.reskinTint, life: 2.6
        });
      }
      ctx.broadcast({ type: 'boss_attack_anim', attack: 'volley', bossId: this.id });
      return;
    }

    // Telegraph attacks: announce, then resolve in update().
    let tel;
    if (attackId === 'aoe_slam') {
      tel = {
        kind: 'aoe_slam', shape: 'circle',
        x: this.x, z: this.z, radius: 6.5,
        duration: 1.8, elapsed: 0,
        damage: dmg(75), damageType: 'blunt',
        color: this.reskinTint, id: this._telId(ctx, 'slam')
      };
    } else if (attackId === 'cone_sweep') {
      tel = {
        kind: 'cone_sweep', shape: 'cone',
        x: this.x, z: this.z, radius: 7.0,
        angle: this.rotation, coneAngle: Math.PI * 0.55,
        duration: 1.4, elapsed: 0,
        damage: dmg(65), damageType: 'dark',
        color: this.reskinTint, id: this._telId(ctx, 'cone')
      };
    } else if (attackId === 'leap') {
      tel = {
        kind: 'leap', shape: 'circle',
        x: target.x, z: target.z, radius: 4.5,
        duration: 1.6, elapsed: 0,
        damage: dmg(90), damageType: 'fire',
        color: this.reskinTint, id: this._telId(ctx, 'leap')
      };
    } else {
      return;
    }
    this.activeTelegraph = tel;
    ctx.broadcast({
      type: 'enemy_telegraph',
      enemyId: this.id,
      telegraph: {
        id: tel.id,
        shape: tel.shape,
        x: +tel.x.toFixed(2), z: +tel.z.toFixed(2),
        radius: tel.radius,
        angle: +(tel.angle || 0).toFixed(3),
        coneAngle: tel.coneAngle ? +tel.coneAngle.toFixed(3) : undefined,
        duration: tel.duration,
        color: tel.color
      },
      windupMs: Math.round(tel.duration * 1000),
      kind: tel.kind,
      isBoss: true
    });
  }

  _resolveTelegraph(tel, ctx) {
    ctx.broadcast({ type: 'screen_shake', magnitude: 0.6, duration: 0.4 });
    if (tel.kind === 'leap') {
      this.x = tel.x;
      this.z = tel.z;
    }
    for (const p of Object.values(ctx.players || {})) {
      if (p.isDowned || p.isDead) continue;
      const dx = p.x - tel.x;
      const dz = p.z - tel.z;
      const d = Math.hypot(dx, dz);
      if (d > tel.radius) continue;
      if (tel.shape === 'cone') {
        const angToP = Math.atan2(dx, dz);
        let diff = Math.abs(angToP - (tel.angle || 0));
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff > (tel.coneAngle || Math.PI * 0.55) / 2) continue;
      }
      ctx.damagePlayer(p, tel.damage, tel.damageType, `${this.name} ${tel.kind}`);
      if (tel.kind === 'aoe_slam') p.stunDuration = Math.max(p.stunDuration || 0, 1.0);
    }
  }

  takeDamage(amount, damageType, attacker) {
    if (this.isDead || !this.isAwake) return { damageDealt: 0, isDead: false };
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) {
      this.isDead = true;
      this.activeTelegraph = null;
      return { damageDealt: dmg, isDead: true, killer: attacker };
    }
    return { damageDealt: dmg, isDead: false };
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      title: this.title,
      biomeId: this.biomeId,
      model: this.model,
      reskinTint: this.reskinTint,
      x: this.x, y: this.y, z: this.z,
      hp: this.hp,
      maxHp: this.maxHp,
      phase: this.phase,
      phaseName: this.phaseName,
      rotation: this.rotation,
      isEnraged: this.isEnraged,
      isAwake: this.isAwake,
      isDead: this.isDead,
      // Phase 2: soul-seal ward count (legacy HUD + damage ward hook in Room).
      sealsRemaining: this.sealsRemaining ?? 2,
      statuses: this.statuses,
      activeTelegraph: this.activeTelegraph ? {
        kind: this.activeTelegraph.kind,
        shape: this.activeTelegraph.shape,
        x: this.activeTelegraph.x,
        z: this.activeTelegraph.z,
        radius: this.activeTelegraph.radius,
        angle: this.activeTelegraph.angle || 0,
        coneAngle: this.activeTelegraph.coneAngle || 0,
        progress: Math.min(1, this.activeTelegraph.elapsed / this.activeTelegraph.duration)
      } : null
    };
  }
}

// createBoss(biomeId, x, z, partySize) -> PhaseBoss
function createBoss(biomeId, x = 0, z = -75, partySize = 1) {
  const key = normalizeBossBiome(biomeId);
  const cfg = { ...BOSS_TABLE[key], biomeId: key };
  return new PhaseBoss(cfg, x, z, partySize);
}

module.exports = {
  BOSS_MODEL,
  BOSS_TABLE,
  normalizeBossBiome,
  PhaseBoss,
  createBoss
};
