// ============================================================
// Dungeon of the Covenant — Phase 2
// server/game/enemies/Elites.js
// Elite variants: an affix system applied as stat/behavior modifiers
// on top of the base elite archetypes (elite_executioner, elite_lich).
//
// Affixes: Swift, Brutal, Vampiric, Shielded, Explosive.
// Each affix carries an aura color the server syncs so the client can
// render the elite aura ring. All numbers server-side.
//
// Coordinator wiring:
//   const elite = Elites.createElite('elite_executioner', biome, floor);
//   Object.assign(mob, elite.stats);        // after spawnMob()
//   Elites.applyAffixes(mob, elite.affixes);
//   // in the damage path, BEFORE hp is reduced:
//   amount = Elites.absorbDamage(mob, amount);
//   // in the mob tick, once per tick:
//   Elites.tick(dt, ctx);   // shield regen + explosive fuses
//   // when an elite dies:
//   Elites.onEliteDeath(mob, ctx);
//   // when an elite deals damage (vampiric):
//   Elites.onEliteDealtDamage(mob, amountDealt, ctx);
// ============================================================

'use strict';

const AFFIXES = {
  swift: {
    id: 'swift',
    name: 'Swift',
    desc: '+35% move speed, 30% faster attacks',
    aura: 0x33ffcc,
    apply(mob) {
      mob.speed = +(mob.speed * 1.35).toFixed(2);
      mob.attackCooldown = +(mob.attackCooldown * 0.70).toFixed(2);
      mob.telegraphMs = Math.max(350, Math.round(mob.telegraphMs * 0.85));
    }
  },
  brutal: {
    id: 'brutal',
    name: 'Brutal',
    desc: '+50% damage',
    aura: 0xff4422,
    apply(mob) {
      mob.damage = Math.round(mob.damage * 1.5);
    }
  },
  vampiric: {
    id: 'vampiric',
    name: 'Vampiric',
    desc: 'Heals 30% of damage it deals',
    aura: 0xff2266,
    lifesteal: 0.30,
    apply() { /* hook-based; nothing to precompute */ }
  },
  shielded: {
    id: 'shielded',
    name: 'Shielded',
    desc: 'Absorbing ward (25% max HP), reforms 8s after breaking',
    aura: 0x4488ff,
    apply(mob) {
      mob._shieldMax = Math.round(mob.maxHp * 0.25);
      mob._shield = mob._shieldMax;
      mob._shieldRegenAt = 0;
    }
  },
  explosive: {
    id: 'explosive',
    name: 'Explosive',
    desc: 'Detonates on death: 1s fuse, then heavy AoE',
    aura: 0xffaa00,
    apply() { /* hook-based; nothing to precompute */ }
  }
};

const AFFIX_IDS = Object.keys(AFFIXES);

// Elites always get at least 1 affix; floors 4+ roll a second.
function rollAffixes(floor, rng) {
  const rand = rng || Math.random;
  const count = (floor >= 4 ? 2 : 1);
  const pool = [...AFFIX_IDS];
  const out = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.floor(rand() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// createElite(baseType, biomeId, floor, opts) -> { stats, affixes, auraColor }
// stats is a buildMobStats() block with elite HP/damage bumps already
// applied by the archetype table; affixes are rolled here.
function createElite(baseType, biomeId, floor, opts = {}) {
  const { buildMobStats } = require('./Archetypes');
  const stats = buildMobStats(baseType, biomeId, floor);
  stats.name = `${stats.biomePrefix} ${stats.name.replace(stats.biomePrefix + ' ', '')}`;
  // Elites are named threats, not pack filler.
  const affixes = opts.affixes || rollAffixes(stats.floor, opts.rng);
  const auraColor = affixes.length > 0 ? AFFIXES[affixes[0]].aura : 0xffd700;
  return { stats, affixes, auraColor };
}

// applyAffixes(mob, affixIds) — mutates the live mob. Idempotent-ish:
// re-applying the same set is safe (affix list is stored on the mob).
function applyAffixes(mob, affixIds) {
  mob.affixes = mob.affixes || [];
  for (const id of affixIds || []) {
    const affix = AFFIXES[id];
    if (!affix || mob.affixes.includes(id)) continue;
    affix.apply(mob);
    mob.affixes.push(id);
  }
  if (mob.affixes.length > 0) {
    mob.auraColor = AFFIXES[mob.affixes[0]].aura;
    mob.isElite = true;
  }
  return mob;
}

// -- damage hooks ------------------------------------------------------
// absorbDamage: call BEFORE reducing mob.hp. Returns the amount that
// gets through the shield (0 if fully absorbed). Updates ward state.
function absorbDamage(mob, amount) {
  if (!mob.affixes || !mob.affixes.includes('shielded')) return amount;
  if (mob._shield == null) {
    mob._shieldMax = Math.round(mob.maxHp * 0.25);
    mob._shield = mob._shieldMax;
  }
  if (mob._shield <= 0) return amount;
  const absorbed = Math.min(mob._shield, amount);
  mob._shield -= absorbed;
  if (mob._shield <= 0) {
    mob._shieldRegenAt = (Date.now() / 1000) + 8; // reforms in 8s
  }
  return amount - absorbed;
}

// onEliteDealtDamage: call AFTER the elite's damage lands (vampiric).
function onEliteDealtDamage(mob, amountDealt, ctx) {
  if (!mob.affixes || !mob.affixes.includes('vampiric')) return;
  if (mob.isDead || amountDealt <= 0) return;
  const heal = Math.round(amountDealt * (AFFIXES.vampiric.lifesteal || 0.3));
  mob.hp = Math.min(mob.maxHp, mob.hp + heal);
  if (ctx && typeof ctx.broadcast === 'function') {
    ctx.broadcast({
      type: 'floating_text',
      text: `+${heal} LEECH`,
      x: mob.x, z: mob.z,
      style: 'heal'
    });
  }
}

// onEliteDeath: explosive fuse. Broadcasts a telegraph, detonates
// after 1.0s via the pending-fuse list processed in tick().
const _fuses = []; // { x, z, radius, damage, damageType, sourceName, fuse, id }

function onEliteDeath(mob, ctx) {
  if (!mob.affixes || !mob.affixes.includes('explosive')) return;
  const radius = 5.0;
  const damage = Math.round(mob.damage * 3);
  const fuse = {
    id: `fuse_${mob.id}_${Date.now()}`,
    x: mob.x, z: mob.z,
    radius, damage,
    damageType: mob.damageType || 'fire',
    sourceName: `${mob.name} Detonation`,
    fuse: 1.0
  };
  _fuses.push(fuse);
  if (ctx && typeof ctx.broadcast === 'function') {
    ctx.broadcast({
      type: 'enemy_telegraph',
      enemyId: mob.id,
      telegraph: {
        id: fuse.id,
        shape: 'circle',
        x: +mob.x.toFixed(2), z: +mob.z.toFixed(2),
        radius,
        angle: 0,
        duration: 1.0,
        color: 0xffaa00
      },
      windupMs: 1000,
      kind: 'explosive_fuse'
    });
  }
}

// tick(dt, ctx): shield regen + fuse countdown. Call once per server tick.
// ctx: { players, broadcast, damagePlayer }
function tick(dt, ctx) {
  const now = Date.now() / 1000;
  // Shielded elites: reform ward 8s after it breaks.
  if (ctx && Array.isArray(ctx.mobs)) {
    for (const mob of ctx.mobs) {
      if (mob.isDead || !mob.affixes || !mob.affixes.includes('shielded')) continue;
      if (mob._shield <= 0 && now >= (mob._shieldRegenAt || 0)) {
        mob._shield = mob._shieldMax || Math.round(mob.maxHp * 0.25);
        if (typeof ctx.broadcast === 'function') {
          ctx.broadcast({
            type: 'floating_text',
            text: 'WARD REFORMED',
            x: mob.x, z: mob.z,
            style: 'buff'
          });
        }
      }
    }
  }
  // Explosive fuses.
  for (let i = _fuses.length - 1; i >= 0; i--) {
    const f = _fuses[i];
    f.fuse -= dt;
    if (f.fuse > 0) continue;
    _fuses.splice(i, 1);
    if (typeof ctx.broadcast === 'function') {
      ctx.broadcast({ type: 'screen_shake', magnitude: 0.5, duration: 0.4 });
    }
    if (ctx && ctx.players && typeof ctx.damagePlayer === 'function') {
      for (const p of Object.values(ctx.players)) {
        if (p.isDowned || p.isDead) continue;
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (d <= f.radius) {
          ctx.damagePlayer(p, f.damage, f.damageType, f.sourceName);
        }
      }
    }
  }
}

function getAffixInfo(id) {
  const a = AFFIXES[id];
  return a ? { id: a.id, name: a.name, desc: a.desc, aura: a.aura } : null;
}

module.exports = {
  AFFIXES,
  AFFIX_IDS,
  rollAffixes,
  createElite,
  applyAffixes,
  absorbDamage,
  onEliteDealtDamage,
  onEliteDeath,
  tick,
  getAffixInfo
};
