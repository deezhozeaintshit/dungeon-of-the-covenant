// server/game/systems/Rift.js — ENDLESS RIFT MODE (Phase 4, workstream 4).
// ============================================================================
// Post-campaign scaling dungeons. Tier N compounds enemy HP/damage/speed via
// scalingFor(tier) (quadratic — hard at tier 50, never overflow-broken), and
// each tier rolls 1-3 affixes from AFFIX_DEFS (deterministic per tier, so the
// server, the tier preview, and every client agree without trusting anyone).
//
// SERVER-AUTHORITATIVE CONTRACT:
//   - Enemy stats are computed here from the tier. The client never sends
//     tier stats; Room.spawnMob calls scaleMobStats() on the archetype stats
//     object, and Room's boss spawn calls scaleBossSpawn().
//   - Tier transitions are validated server-side: an account may enter tier
//     T only if T <= meta.rift.unlockedTier, and clearing T unlocks T+1.
//     Tier state lives in profile.meta.rift inside server/data/accounts.json
//     (survives restarts; saved atomically by authService.saveAccounts()).
//   - Entry cost: 1 rift keystone (earned on campaign victory, +1/day from
//     the daily delve) OR a Rift Pact — a run-long binding (-15% max HP,
//     +10% damage taken) sworn at entry. The server consumes/validates;
//     the client's payment choice is only a preference.
//   - Rewards: gear drops roll through LootGenerator with a tier-derived
//     rarity bonus (extend, don't fork), and clears submit to the shared
//     Leaderboards rift_depth board (server-measured only).
//
// Affix combat hooks (all real, all server-side):
//   molten     — burning ground patches damage players standing in them
//   frenzied   — +45% enemy attack speed (shorter cooldown + telegraph)
//   shielded   — enemies periodically gain an absorb shield (Room.takeDamage hook)
//   vampiric   — enemies heal 30% of damage they deal to players
//   volatile   — enemies explode on death (Room.handleEntityDeath hook)
//   relentless — enemies are immune to stun/slow/fear crowd control
//   tyrannical — bosses & elites gain +100% HP / +35% damage
//   swarming   — 35% chance a spawned mob brings a twin
//
// PROTOCOL (server <-> client):
//   C->S: { type: 'rift_status', accountToken }
//   S->C: { type: 'rift_status', ok, unlockedTier, bestTier, keystones,
//           totalClears, lastDailyDelve, seasonId, unlocked }
//   C->S: { type: 'rift_tier_preview', accountToken, tier }
//   S->C: { type: 'rift_tier_preview', ok, tier, affixes, scaling, allowed, reason }
//   C->S: { type: 'rift_start', accountToken, tier, payment: 'keystone'|'pact',
//           playerName, chosenClass, profile }
//   S->C: { type: 'rift_denied', reason }
//   S->C: { type: 'rift_started', tier, affixes, scaling, pact, roomCode }
//   S->C: { type: 'rift_cleared', tier, clearTimeMs, newUnlockedTier, keystones,
//           dailyDelveBonus, leaderboard: { rank, weekId } }
//   S->C: { type: 'rift_keystone_granted', keystones, reason }

'use strict';

const authService = require('../../authService');
const LootGenerator = require('../LootGenerator');
const Leaderboards = require('./Leaderboards');

// ---------------------------------------------------------------------------
// Affix definitions. apply-time behavior lives in the hook functions below;
// the defs carry the client-facing catalog (icon/name/desc) plus tunables.
// ---------------------------------------------------------------------------
const AFFIX_DEFS = {
  molten: {
    id: 'molten', name: 'Molten', icon: '🌋',
    desc: 'Burning ground erupts beneath the party — keep moving or burn.',
    patchIntervalSec: 6, patchRadius: 2.6, patchDurationSec: 8, dpsBase: 26
  },
  frenzied: {
    id: 'frenzied', name: 'Frenzied', icon: '⚡',
    desc: 'Enemies attack 45% faster and telegraph sooner.',
    attackCooldownMult: 0.55, telegraphMult: 0.8
  },
  shielded: {
    id: 'shielded', name: 'Shielded', icon: '🛡️',
    desc: 'Enemies periodically raise an absorb shield (18% max HP, 6s).',
    intervalSec: 12, shieldDurationSec: 6, shieldPct: 0.18
  },
  vampiric: {
    id: 'vampiric', name: 'Vampiric', icon: '🩸',
    desc: 'Enemies heal for 30% of the damage they deal to heroes.',
    healPct: 0.30
  },
  volatile: {
    id: 'volatile', name: 'Volatile', icon: '💥',
    desc: 'Enemies detonate on death, scorching nearby heroes.',
    radius: 3.5, damageBase: 60
  },
  relentless: {
    id: 'relentless', name: 'Relentless', icon: '🗿',
    desc: 'Enemies are immune to stun, slow, and fear.'
  },
  tyrannical: {
    id: 'tyrannical', name: 'Tyrannical', icon: '👑',
    desc: 'Bosses and elites gain +100% HP and +35% damage.',
    hpMult: 2.0, dmgMult: 1.35
  },
  swarming: {
    id: 'swarming', name: 'Swarming', icon: '🐀',
    desc: 'The dark multiplies: 35% chance a spawned foe brings a twin.',
    twinChance: 0.35
  }
};

const AFFIX_IDS = Object.keys(AFFIX_DEFS);

// Rift Pact: the covenant-oath entry cost. A binding sworn at the gate —
// run-long, broadcast to the party, enforced server-side.
const RIFT_PACT = {
  maxHpMult: 0.85,
  damageTakenMult: 1.10,
  name: 'Rift Pact',
  desc: '−15% max HP, +10% damage taken for the entire delve.'
};

// ---------------------------------------------------------------------------
// Scaling curve. Quadratic per-tier compounding: tier 1 is a clear step up
// from campaign floors, tier 50 is brutal, tier 999 stays finite (no
// overflow, no Infinity — every multiplier is a bounded polynomial).
//
//   hp:  1 + 0.30t + 0.012t²   → t=1: 1.31   t=10: 5.2   t=25: 16.0  t=50: 46.0
//   dmg: 1 + 0.12t + 0.0022t²  → t=1: 1.12   t=10: 2.42  t=25: 5.38  t=50: 12.5
//   spd: 1 + min(0.40, 0.014t) → t=50: 1.40 (hard cap — animation sanity)
// ---------------------------------------------------------------------------
const MAX_TIER = 999;

function _clampTier(tier) {
  const t = Math.floor(Number(tier));
  if (!Number.isFinite(t)) return 1;
  return Math.max(1, Math.min(MAX_TIER, t));
}

function scalingFor(tier) {
  const t = _clampTier(tier);
  const hpMult = 1 + 0.30 * t + 0.012 * t * t;
  const dmgMult = 1 + 0.12 * t + 0.0022 * t * t;
  const speedMult = 1 + Math.min(0.40, 0.014 * t);
  return {
    tier: t,
    hpMult: +hpMult.toFixed(3),
    dmgMult: +dmgMult.toFixed(3),
    speedMult: +speedMult.toFixed(3)
  };
}

// Deterministic affix roll: seeded shuffle of the affix list by tier.
// 1 affix tiers 1-4, 2 affixes tiers 5-11, 3 affixes tier 12+.
function affixCountForTier(tier) {
  const t = _clampTier(tier);
  if (t >= 12) return 3;
  if (t >= 5) return 2;
  return 1;
}

function _mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function affixesForTier(tier) {
  const t = _clampTier(tier);
  const rand = _mulberry32((t * 2654435761) >>> 0);
  const pool = AFFIX_IDS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, affixCountForTier(t)).map(id => AFFIX_DEFS[id]);
}

function hasAffix(affixes, id) {
  return Array.isArray(affixes) && affixes.some(a => (a && a.id) === id);
}

// Client-safe catalog entries (icon/name/desc only — no tunables leak).
function publicAffixes(tier) {
  return affixesForTier(tier).map(a => ({
    id: a.id, name: a.name, icon: a.icon, desc: a.desc
  }));
}

// ---------------------------------------------------------------------------
// Account persistence. meta.rift is created lazily; ensureMeta-style in
// place so MetaProgression.ensureMeta stays the only sanitizer of meta.
// ---------------------------------------------------------------------------
function ensureRift(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (!profile.meta || typeof profile.meta !== 'object') profile.meta = {};
  const m = profile.meta;
  if (!m.rift || typeof m.rift !== 'object') m.rift = {};
  const r = m.rift;
  if (!Number.isInteger(r.keystones) || r.keystones < 0) r.keystones = 0;
  if (!Number.isInteger(r.unlockedTier) || r.unlockedTier < 0) r.unlockedTier = 0;
  if (!Number.isInteger(r.bestTier) || r.bestTier < 0) r.bestTier = 0;
  if (!Number.isInteger(r.totalClears) || r.totalClears < 0) r.totalClears = 0;
  if (!r.bestTimes || typeof r.bestTimes !== 'object') r.bestTimes = {};
  if (typeof r.lastDailyDelve !== 'string') r.lastDailyDelve = null;
  return r;
}

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function publicStatus(profile) {
  const r = ensureRift(profile) || { keystones: 0, unlockedTier: 0, bestTier: 0, totalClears: 0, lastDailyDelve: null };
  return {
    ok: true,
    unlocked: r.unlockedTier >= 1,
    unlockedTier: r.unlockedTier,
    bestTier: r.bestTier,
    keystones: r.keystones,
    totalClears: r.totalClears,
    lastDailyDelve: r.lastDailyDelve
  };
}

// ---------------------------------------------------------------------------
// Entry validation + cost. The client only states a preference; the server
// decides. Returns { ok } or { ok:false, reason }.
// ---------------------------------------------------------------------------
function validateEntry(profile, tier, payment) {
  const r = ensureRift(profile);
  if (!r) return { ok: false, reason: 'No account record. Link your account to enter the Rift.' };
  const t = _clampTier(tier);
  if (r.unlockedTier < 1) {
    return { ok: false, reason: 'The Rift is sealed. Defeat Malakor to earn your first keystone.' };
  }
  if (t > r.unlockedTier) {
    return { ok: false, reason: `Tier ${t} is sealed. Clear Tier ${r.unlockedTier} to unlock Tier ${r.unlockedTier + 1}.` };
  }
  if (payment === 'pact') return { ok: true, tier: t, payment: 'pact' };
  if (r.keystones < 1) {
    return {
      ok: false,
      reason: 'No rift keystones. Clear the campaign or complete your daily delve — or swear a Rift Pact instead.'
    };
  }
  return { ok: true, tier: t, payment: 'keystone' };
}

// Consume the entry cost AFTER validateEntry passed. Caller persists.
function consumeEntry(profile, payment) {
  const r = ensureRift(profile);
  if (!r) return false;
  if (payment === 'pact') return true;
  if (r.keystones < 1) return false;
  r.keystones -= 1;
  return true;
}

// ---------------------------------------------------------------------------
// Scaling application — called from Room.spawnMob (stats object) and the
// boss spawn. Affix stat mutations ride along so spawn-time application is
// a single pass.
// ---------------------------------------------------------------------------
function scaleMobStats(stats, tier, affixes) {
  if (!stats || typeof stats !== 'object') return stats;
  const s = scalingFor(tier);
  const tyr = hasAffix(affixes, 'tyrannical') && (stats.role === 'elite' || stats.role === 'boss');
  const hpM = s.hpMult * (tyr ? AFFIX_DEFS.tyrannical.hpMult : 1);
  const dmgM = s.dmgMult * (tyr ? AFFIX_DEFS.tyrannical.dmgMult : 1);
  stats.maxHp = Math.max(1, Math.round((stats.maxHp || 1) * hpM));
  stats.hp = stats.maxHp;
  stats.damage = Math.max(1, Math.round((stats.damage || 1) * dmgM));
  stats.speed = +((stats.speed || 4) * s.speedMult).toFixed(2);
  if (hasAffix(affixes, 'frenzied')) {
    const f = AFFIX_DEFS.frenzied;
    if (stats.attackCooldown) stats.attackCooldown = +(stats.attackCooldown * f.attackCooldownMult).toFixed(2);
    if (stats.telegraphMs) stats.telegraphMs = Math.max(250, Math.round(stats.telegraphMs * f.telegraphMult));
  }
  stats.riftTier = s.tier;
  return stats;
}

// Per-mob affix state applied once at spawn (shield timers, CC immunity,
// swarming twin). Called from Room.spawnMob after the mob object exists.
function applyMobAffixes(room, mob) {
  if (!room || !mob || room.riftTier < 1) return;
  const affixes = room.riftAffixes || [];
  if (hasAffix(affixes, 'relentless')) mob.ccImmune = true;
  if (hasAffix(affixes, 'shielded')) {
    mob.riftShieldTimer = AFFIX_DEFS.shielded.intervalSec * 0.5; // first shield arrives sooner
    mob.riftShield = null;
  }
  if (hasAffix(affixes, 'swarming') && !mob._riftTwin && !room._riftSwarmGuard) {
    if (Math.random() < AFFIX_DEFS.swarming.twinChance) {
      room._riftSwarmGuard = true;
      try {
        const twin = room.spawnMob(mob.legacyType || mob.type, mob.x + 1.2, mob.z + 1.2);
        if (twin) twin._riftTwin = true;
      } finally {
        room._riftSwarmGuard = false;
      }
    }
  }
}

// Boss spawn scaling: same curve, tyrannical doubles down on bosses too.
function scaleBossSpawn(room, boss) {
  if (!room || !boss || room.riftTier < 1) return;
  const affixes = room.riftAffixes || [];
  const fakeStats = {
    maxHp: boss.maxHp, damage: boss.damage || 50, speed: 4,
    role: 'boss', attackCooldown: null, telegraphMs: null
  };
  scaleMobStats(fakeStats, room.riftTier, affixes);
  boss.maxHp = fakeStats.maxHp;
  boss.hp = boss.maxHp;
  if (typeof boss.damage === 'number') boss.damage = fakeStats.damage;
  boss.riftTier = room.riftTier;
}

// Shielded affix: absorb incoming mob damage while the shield holds.
// Called from the mob takeDamage path in Room.spawnMob.
function absorbShield(mob, amount) {
  if (!mob || !mob.riftShield || mob.riftShield.amount <= 0) return amount;
  const now = Date.now();
  if (now > mob.riftShield.expiresAt) { mob.riftShield = null; return amount; }
  const absorbed = Math.min(mob.riftShield.amount, amount);
  mob.riftShield.amount -= absorbed;
  if (mob.riftShield.amount <= 0) mob.riftShield = null;
  return amount - absorbed;
}

// ---------------------------------------------------------------------------
// Per-tick rift runtime: molten patches + shielded refresh + relentless CC
// purge. Called from Room.update() — no-op outside rift rooms.
// ---------------------------------------------------------------------------
function onTick(room, dt) {
  if (!room || room.riftTier < 1 || room.state !== 'dungeon') return;
  const affixes = room.riftAffixes || [];
  const s = scalingFor(room.riftTier);

  if (hasAffix(affixes, 'molten')) _tickMolten(room, dt, s);
  if (hasAffix(affixes, 'shielded')) _tickShields(room, dt);
  if (hasAffix(affixes, 'relentless')) _purgeCrowdControl(room);
}

function _alivePlayers(room) {
  return Object.values(room.players || {}).filter(p => !p.isDead && !p.isDowned);
}

function _tickMolten(room, dt, s) {
  const def = AFFIX_DEFS.molten;
  room._riftMoltenTimer = (room._riftMoltenTimer || 0) - dt;
  if (room._riftMoltenTimer <= 0) {
    room._riftMoltenTimer = def.patchIntervalSec;
    const targets = _alivePlayers(room).filter(p => !p.isBot);
    const pool = targets.length ? targets : _alivePlayers(room);
    if (pool.length) {
      const anchor = pool[Math.floor(Math.random() * pool.length)];
      room.groundEffects.push({
        id: `rift_molten_${room.nextEntityId++}`,
        type: 'fire_pool', // client already renders fire_pool circles
        riftMolten: true,
        x: anchor.x + (Math.random() - 0.5) * 4,
        z: anchor.z + (Math.random() - 0.5) * 4,
        radius: def.patchRadius,
        duration: def.patchDurationSec,
        dps: Math.round(def.dpsBase * s.dmgMult)
      });
      room.broadcast({
        type: 'narrator_announcement',
        text: '🌋 The rift floor erupts — MOLTEN ground! Move!',
        tone: 'danger'
      });
    }
  }
  // Damage tick (1s cadence) for heroes standing in rift-molten patches.
  room._riftMoltenDmgTimer = (room._riftMoltenDmgTimer || 0) - dt;
  if (room._riftMoltenDmgTimer <= 0) {
    room._riftMoltenDmgTimer = 1.0;
    for (const eff of room.groundEffects) {
      if (!eff.riftMolten) continue;
      for (const p of _alivePlayers(room)) {
        if (Math.hypot(p.x - eff.x, p.z - eff.z) <= eff.radius) {
          room.damagePlayer(p, eff.dps, 'fire', 'Molten Rift');
        }
      }
    }
  }
}

function _tickShields(room, dt) {
  const def = AFFIX_DEFS.shielded;
  const now = Date.now();
  const targets = room.mobs || [];
  if (room.boss && !room.boss.isDead) targets.push(room.boss);
  for (const m of targets) {
    if (m.isDead || m.riftShieldTimer === undefined) continue;
    m.riftShieldTimer -= dt;
    if (m.riftShieldTimer <= 0) {
      m.riftShieldTimer = def.intervalSec;
      m.riftShield = {
        amount: Math.max(1, Math.round(m.maxHp * def.shieldPct)),
        expiresAt: now + def.shieldDurationSec * 1000
      };
      room.broadcast({
        type: 'floating_text',
        text: '🛡️ SHIELDED',
        x: m.x, z: m.z, style: 'info'
      });
    }
    if (m.riftShield && now > m.riftShield.expiresAt) m.riftShield = null;
  }
}

function _purgeCrowdControl(room) {
  for (const m of room.mobs || []) {
    if (m.isDead || !m.statuses) continue;
    for (const cc of ['stun', 'slow', 'fear', 'root']) {
      if (m.statuses[cc]) delete m.statuses[cc];
    }
  }
  const b = room.boss;
  if (b && !b.isDead && b.statuses) {
    for (const cc of ['stun', 'slow', 'fear', 'root']) {
      if (b.statuses[cc]) delete b.statuses[cc];
    }
  }
}

// Vampiric: called from Room.damagePlayer after the hit lands.
function onPlayerDamaged(room, player, attacker, dealt) {
  if (!room || room.riftTier < 1 || !dealt || dealt <= 0) return;
  if (!hasAffix(room.riftAffixes, 'vampiric')) return;
  // Attacker must be a real enemy (mobs and the boss carry maxHp; players
  // and null attackers do not heal).
  if (!attacker || typeof attacker.maxHp !== 'number' || attacker.isDead) return;
  if (room.players && room.players[attacker.id]) return; // never a hero
  const heal = Math.max(1, Math.round(dealt * AFFIX_DEFS.vampiric.healPct));
  attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
}

// Volatile: called from Room.handleEntityDeath. Guarded against chains.
function onMobDeath(room, entity, killer) {
  if (!room || room.riftTier < 1) return;
  if (!hasAffix(room.riftAffixes, 'volatile')) return;
  if (!entity || entity.isBoss || room._riftVolatileChain) return;
  const def = AFFIX_DEFS.volatile;
  const s = scalingFor(room.riftTier);
  room._riftVolatileChain = true;
  try {
    const dmg = Math.max(1, Math.round(def.damageBase * s.dmgMult));
    room.broadcast({
      type: 'ground_fx', fxType: 'corpse_explosion',
      x: entity.x, z: entity.z, radius: def.radius, usedCorpse: false
    });
    room.broadcast({
      type: 'floating_text', text: `💥 VOLATILE! -${dmg}`,
      x: entity.x, z: entity.z, style: 'crit'
    });
    for (const p of _alivePlayers(room)) {
      if (Math.hypot(p.x - entity.x, p.z - entity.z) <= def.radius + 0.8) {
        room.damagePlayer(p, dmg, 'fire', 'Volatile Detonation');
      }
    }
  } finally {
    room._riftVolatileChain = false;
  }
}

// Rift Pact damage-taken multiplier (entry-cost oath). Read in damagePlayer.
function getPlayerDamageTakenMult(player) {
  return player && player.riftPact ? RIFT_PACT.damageTakenMult : 1.0;
}

// Apply the Rift Pact binding to a hero (entry cost). Broadcast to the party.
function applyPactToPlayer(room, player) {
  if (!room || !player || player.isBot || player.riftPact) return;
  player.riftPact = true;
  const newMax = Math.max(1, Math.round(player.maxHp * RIFT_PACT.maxHpMult));
  player.maxHp = newMax;
  player.hp = Math.min(player.hp, newMax);
  room.broadcast({
    type: 'narrator_announcement',
    text: `⛓️ ${player.name} swears the RIFT PACT — ${RIFT_PACT.desc} The gate drinks deep.`,
    tone: 'warning'
  });
}

// ---------------------------------------------------------------------------
// Rewards: tier-scaled gear (extends LootGenerator, no fork).
// ---------------------------------------------------------------------------
function rarityBonusForTier(tier) {
  return Math.min(40, Math.floor(_clampTier(tier) * 2));
}

function generateRiftItem(tier, sourceType = 'mob', biomeId) {
  const t = _clampTier(tier);
  return LootGenerator.generateItem(t, sourceType, biomeId, {
    rarityBonus: rarityBonusForTier(t)
  });
}

// ---------------------------------------------------------------------------
// Run lifecycle.
// ---------------------------------------------------------------------------

// Campaign victory: earn a keystone and unlock Rift Tier 1 (once).
function onCampaignVictory(room) {
  if (!room || room.riftTier > 0) return; // rift clears are not campaign victories
  let granted = 0;
  for (const player of Object.values(room.players || {})) {
    if (player.isBot || !player.accountUsername) continue;
    const profile = authService.getProfileByUsername(player.accountUsername);
    if (!profile) continue;
    const r = ensureRift(profile);
    if (!r) continue;
    r.keystones += 1;
    r.unlockedTier = Math.max(r.unlockedTier, 1);
    granted++;
  }
  if (granted > 0) {
    authService.saveAccounts();
    const sample = Object.values(room.players).find(p => !p.isBot && p.accountUsername);
    const keystones = sample
      ? (ensureRift(authService.getProfileByUsername(sample.accountUsername)) || {}).keystones
      : 0;
    room.broadcast({
      type: 'rift_keystone_granted',
      keystones,
      reason: 'campaign_victory',
      text: '🗝️ RIFT KEYSTONE earned! The Endless Rift yawns open — Tier 1 awaits.'
    });
  }
}

// Rift clear: boss slain in a rift room. Unlocks next tier, pays the daily
// delve bonus, submits the shared deepest-tier leaderboard. Single execution.
function onRiftCleared(room, killer) {
  if (!room || room.riftTier < 1 || room._riftCleared) return null;
  room._riftCleared = true;
  const tier = room.riftTier;
  const clearTimeMs = Math.max(1, Date.now() - (room.startTime || Date.now()));
  const humans = Object.values(room.players || {}).filter(p => !p.isBot);
  const today = _todayStr();
  let newUnlockedTier = tier;
  let keystones = 0;
  let dailyDelveBonus = false;

  for (const player of humans) {
    if (!player.accountUsername) continue;
    const profile = authService.getProfileByUsername(player.accountUsername);
    if (!profile) continue;
    const r = ensureRift(profile);
    if (!r) continue;
    r.unlockedTier = Math.max(r.unlockedTier, tier + 1);
    r.bestTier = Math.max(r.bestTier, tier);
    r.totalClears += 1;
    const prev = r.bestTimes[tier];
    if (!prev || clearTimeMs < prev) r.bestTimes[tier] = clearTimeMs;
    // Daily delve: first rift clear each calendar day pays a bonus keystone.
    if (r.lastDailyDelve !== today) {
      r.lastDailyDelve = today;
      r.keystones += 1;
      dailyDelveBonus = true;
    }
    newUnlockedTier = Math.max(newUnlockedTier, r.unlockedTier);
    keystones = r.keystones;
  }
  authService.saveAccounts();

  // Shared deepest-tier leaderboard (workstream 1's schema): server-measured
  // only — tier cleared, clear time, party size.
  let leaderboard = null;
  const rep = humans.find(p => p.accountUsername);
  if (rep) {
    const res = Leaderboards.submit('rift_depth', {
      username: rep.accountUsername,
      displayName: rep.name,
      value: tier,
      meta: { riftTier: tier, clearTimeMs, partySize: humans.length }
    });
    if (res.ok && res.entry) {
      leaderboard = {
        rank: null, // filled below from the week board when available
        weekId: res.entry.weekId,
        improved: res.improved,
        displayValue: res.entry.displayValue
      };
      const board = Leaderboards.getBoard('rift_depth', { weekId: res.entry.weekId, limit: 100 });
      if (board.ok) {
        const mine = board.entries.find(e => e.username === String(rep.accountUsername).toLowerCase());
        if (mine) leaderboard.rank = mine.rank;
      }
    }
  }

  room.broadcast({
    type: 'rift_cleared',
    tier,
    clearTimeMs,
    clearTimeSec: Math.round(clearTimeMs / 1000),
    newUnlockedTier,
    keystones,
    dailyDelveBonus,
    leaderboard,
    text: `🌀 RIFT TIER ${tier} CLEARED in ${Math.round(clearTimeMs / 1000)}s! Tier ${tier + 1} unlocked.` +
      (dailyDelveBonus ? ' Daily delve bonus: +1 🗝️ keystone!' : '')
  });
  return { tier, clearTimeMs, newUnlockedTier, keystones, dailyDelveBonus, leaderboard };
}

// Public rift state for Room.getSnapshot().
function getPublicState(room) {
  if (!room || room.riftTier < 1) return null;
  return {
    tier: room.riftTier,
    affixes: (room.riftAffixes || []).map(a => a.id),
    pact: !!room.riftPact
  };
}

module.exports = {
  AFFIX_DEFS,
  AFFIX_IDS,
  RIFT_PACT,
  MAX_TIER,
  scalingFor,
  affixCountForTier,
  affixesForTier,
  hasAffix,
  publicAffixes,
  ensureRift,
  publicStatus,
  validateEntry,
  consumeEntry,
  scaleMobStats,
  applyMobAffixes,
  scaleBossSpawn,
  absorbShield,
  onTick,
  onPlayerDamaged,
  onMobDeath,
  getPlayerDamageTakenMult,
  applyPactToPlayer,
  rarityBonusForTier,
  generateRiftItem,
  onCampaignVictory,
  onRiftCleared,
  getPublicState
};
