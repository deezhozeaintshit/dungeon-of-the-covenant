// server/game/systems/LivingDungeon.js — THE DUNGEON FIGHTS BACK.
//
// Tracks per-room party behavior (damage by category, kills by archetype,
// deaths) and mutates the dungeon against the dominant strategy. If the party
// leans hard into one approach (>70% of tracked damage in one category), the
// dungeon adapts: gap-closer packs vs ranged turtles, thorn-hardened brutes vs
// melee balls, null-warded casters vs magic spam — always with a flavorful,
// VISIBLE whisper. Adaptation is never silent.
//
// NEW FILES ONLY — coordinator wires hooks into Room.js / server.js.
// Coordinator hook checklist (see SIGNATURE_PROTOCOL.md for exact call sites):
//   LivingDungeon.init(room)                        — room construction
//   LivingDungeon.recordDamage(room, attacker, amount, damageType) — deal paths
//   LivingDungeon.recordKill(room, killer, mob)     — handleEntityDeath
//   LivingDungeon.recordDeath(room, player)         — damagePlayer down/death
//   LivingDungeon.onRoomTick(room)                  — each tick (self-throttled)
//   LivingDungeon.onFloorStart(room)                — generateProceduralDungeonFloor
//   LivingDungeon.getDamageTakenMult(mob, damageType) — mob damage intake
//   LivingDungeon.getPublicState(room)              — merged into snapshot.signature
'use strict';

const EVAL_INTERVAL_MS = 5000;
const DOMINANCE_THRESHOLD = 0.70;
const MIN_TRACKED_DAMAGE = 1200; // ignore trivial skirmishes
const WHISPER_COOLDOWN_MS = 20000;
const PRESSURE_THRESHOLD = 3;    // deaths before the dungeon tastes blood

// damageType -> strategic category
function classify(damageType) {
  const t = String(damageType || '').toLowerCase();
  if (t === 'projectile') return 'ranged';
  if (t === 'physical' || t === 'shatter' || t === 'execute') return 'melee';
  // fire, frost, dark, radiant, toxic — sorcery of every stripe
  return 'magic';
}

function archetypeOf(mob) {
  const t = mob.type || '';
  if (t === 'bone_archer') return 'ranged';
  if (t === 'blight_necrolyte') return 'caster';
  if (t === 'elite_executioner' || t === 'elite_lich') return 'elite';
  if (t === 'boss_malakor') return 'boss';
  return 'skirmisher';
}

function freshFloor() {
  return {
    damage: { melee: 0, ranged: 0, magic: 0 },
    byPlayer: {}, // playerId -> { name, melee, ranged, magic }
    kills: { skirmisher: 0, ranged: 0, caster: 0, elite: 0, boss: 0 },
    adaptations: [], // adaptation ids triggered this floor
    pressureDeaths: 0,
    bloodHuntDone: false
  };
}

function ensure(room) {
  if (!room.livingDungeon) {
    room.livingDungeon = {
      floor: freshFloor(),
      memory: { lastDominance: null, adaptationsTotal: 0 },
      nextEvalAt: 0,
      lastWhisperAt: 0
    };
  }
  return room.livingDungeon;
}

const LivingDungeon = {

  init(room) {
    ensure(room);
  },

  // --- event recording ---------------------------------------------------------

  recordDamage(room, attacker, amount, damageType) {
    if (!attacker || !attacker.stats || amount <= 0) return;
    const ld = ensure(room);
    const cat = classify(damageType);
    ld.floor.damage[cat] += amount;
    if (!ld.floor.byPlayer[attacker.id]) {
      ld.floor.byPlayer[attacker.id] = { name: attacker.name, melee: 0, ranged: 0, magic: 0 };
    }
    ld.floor.byPlayer[attacker.id][cat] += amount;
  },

  recordKill(room, killer, mob) {
    const ld = ensure(room);
    ld.floor.kills[archetypeOf(mob)] += 1;
  },

  recordDeath(room, player) {
    const ld = ensure(room);
    ld.floor.pressureDeaths += 1;
  },

  // --- resistance hook -----------------------------------------------------------
  // Coordinator: multiply incoming mob damage by this in the mob-damage path.
  getDamageTakenMult(mob, damageType) {
    if (!mob) return 1.0;
    const cat = classify(damageType);
    if (mob.resistPhysical && cat === 'melee') return 1 - mob.resistPhysical;
    if (mob.resistMagic && cat === 'magic') return 1 - mob.resistMagic;
    return 1.0;
  },

  // --- tick ------------------------------------------------------------------------

  onRoomTick(room) {
    if (room.state !== 'dungeon') return;
    const ld = ensure(room);
    const now = Date.now();
    if (now < ld.nextEvalAt) return;
    ld.nextEvalAt = now + EVAL_INTERVAL_MS;

    // Blood pressure: the dungeon tastes death and sends hunters.
    if (!ld.floor.bloodHuntDone && ld.floor.pressureDeaths >= PRESSURE_THRESHOLD) {
      ld.floor.bloodHuntDone = true;
      LivingDungeon._triggerBloodHunt(room);
      return;
    }

    const d = ld.floor.damage;
    const total = d.melee + d.ranged + d.magic;
    if (total < MIN_TRACKED_DAMAGE) return;

    const shares = {
      melee: d.melee / total,
      ranged: d.ranged / total,
      magic: d.magic / total
    };
    const dominant = Object.keys(shares).find(k => shares[k] > DOMINANCE_THRESHOLD);
    if (!dominant) return;
    ld.memory.lastDominance = dominant;

    if (dominant === 'ranged' && !ld.floor.adaptations.includes('gap_closers')) {
      ld.floor.adaptations.push('gap_closers');
      LivingDungeon._adaptGapClosers(room);
    } else if (dominant === 'melee' && !ld.floor.adaptations.includes('thorned')) {
      ld.floor.adaptations.push('thorned');
      LivingDungeon._adaptThorned(room);
    } else if (dominant === 'magic' && !ld.floor.adaptations.includes('null_warded')) {
      ld.floor.adaptations.push('null_warded');
      LivingDungeon._adaptNullWarded(room);
    }
  },

  onFloorStart(room) {
    const ld = ensure(room);
    // The dungeon remembers last floor's dominant strategy and pre-deploys.
    const remembered = ld.memory.lastDominance;
    ld.floor = freshFloor();
    ld.nextEvalAt = Date.now() + 8000;
    if (remembered) {
      ld.floor.adaptations.push(`remembered_${remembered}`);
      LivingDungeon._spawnRemembered(room, remembered);
    }
  },

  // --- adaptations -------------------------------------------------------------------

  _whisper(room, text) {
    const ld = ensure(room);
    const now = Date.now();
    if (now - ld.lastWhisperAt < WHISPER_COOLDOWN_MS) return;
    ld.lastWhisperAt = now;
    room.broadcast({ type: 'dungeon_whisper', text });
    room.broadcast({ type: 'narrator_announcement', text, tone: 'warning' });
  },

  _leaderFor(room, category) {
    const ld = ensure(room);
    let best = null, bestDmg = 0;
    for (const [pid, rec] of Object.entries(ld.floor.byPlayer)) {
      const p = room.players[pid];
      if (!p || p.isDead || p.isDowned) continue;
      if (rec[category] > bestDmg) { bestDmg = rec[category]; best = p; }
    }
    if (!best) {
      const alive = Object.values(room.players).filter(p => !p.isDead && !p.isDowned);
      best = alive[Math.floor(Math.random() * alive.length)] || null;
    }
    return best;
  },

  _spawnNear(room, type, anchor, count, mutate) {
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 4;
      const mob = room.spawnMob(type, anchor.x + Math.cos(ang) * r, anchor.z + Math.sin(ang) * r);
      if (mob) {
        mob.ldAdapted = true;
        if (mutate) mutate(mob);
        spawned.push(mob);
      }
    }
    if (spawned.length) {
      room.broadcast({
        type: 'dungeon_adaptation',
        mobIds: spawned.map(m => m.id),
        x: anchor.x, z: anchor.z
      });
      room.broadcast({
        type: 'floating_text', text: '👁️ THE DUNGEON ADAPTS!',
        x: anchor.x, z: anchor.z, style: 'crit'
      });
    }
    return spawned;
  },

  // Ranged turtles -> fast gap-closers that sprint at the backline.
  _adaptGapClosers(room) {
    const anchor = LivingDungeon._leaderFor(room, 'ranged');
    if (!anchor) return;
    LivingDungeon._spawnNear(room, 'void_assassin', anchor, 3, (m) => {
      m.speed = +(m.speed * 1.25).toFixed(2);
      m.name = `Dungebred ${m.name}`;
      m.huntTargetId = anchor.id;
    });
    LivingDungeon._spawnNear(room, 'cinder_thrall', anchor, 2, (m) => {
      m.speed = +(m.speed * 1.25).toFixed(2);
      m.name = `Dungebred ${m.name}`;
      m.huntTargetId = anchor.id;
    });
    ensure(room).memory.adaptationsTotal++;
    LivingDungeon._whisper(room,
      `👁️ "The dungeon has noticed your cowardice, ${anchor.name}... it sends teeth to close the distance."`);
  },

  // Melee ball -> thorn-hardened brutes that punish blades.
  _adaptThorned(room) {
    const anchor = LivingDungeon._leaderFor(room, 'melee');
    if (!anchor) return;
    LivingDungeon._spawnNear(room, 'crypt_ghoul', anchor, 4, (m) => {
      m.resistPhysical = 0.45;      // 45% less melee damage taken
      m.thorns = (m.thorns || 0) + 10;
      m.maxHp = Math.round(m.maxHp * 1.2); m.hp = m.maxHp;
      m.name = `Thorn-Hardened ${m.name}`;
    });
    ensure(room).memory.adaptationsTotal++;
    LivingDungeon._whisper(room,
      `👁️ "Blades, blades, always blades... the dungeon grows THORNS against your steel."`);
  },

  // Magic spam -> null-warded casters that drink sorcery.
  _adaptNullWarded(room) {
    const anchor = LivingDungeon._leaderFor(room, 'magic');
    if (!anchor) return;
    LivingDungeon._spawnNear(room, 'blight_necrolyte', anchor, 3, (m) => {
      m.resistMagic = 0.45;         // 45% less magic damage taken
      m.attackCooldown = 1.0;       // casts faster
      m.maxHp = Math.round(m.maxHp * 1.2); m.hp = m.maxHp;
      m.name = `Null-Warded ${m.name}`;
    });
    ensure(room).memory.adaptationsTotal++;
    LivingDungeon._whisper(room,
      `👁️ "Your sorcery tickles, little mage... the dungeon DRINKS it now."`);
  },

  // Deaths -> the dungeon tastes blood and sends hunters.
  _triggerBloodHunt(room) {
    const alive = Object.values(room.players).filter(p => !p.isDead && !p.isDowned && !p.isBot);
    const anchor = alive[Math.floor(Math.random() * alive.length)] ||
      Object.values(room.players).find(p => !p.isDead && !p.isDowned);
    if (!anchor) return;
    LivingDungeon._spawnNear(room, 'void_assassin', anchor, 3, (m) => {
      m.name = `Bloodscented ${m.name}`;
      m.huntTargetId = anchor.id;
      m.damage = Math.round(m.damage * 1.15);
    });
    LivingDungeon._whisper(room,
      `👁️ "The dungeon tastes blood... and it wants MORE."`);
  },

  _spawnRemembered(room, dominance) {
    const spawn = Object.values(room.players).find(p => !p.isBot && !p.isDead) ||
      Object.values(room.players).find(p => !p.isDead);
    if (!spawn) return;
    const label = { ranged: 'cowardice', melee: 'blades', magic: 'sorcery' }[dominance] || dominance;
    if (dominance === 'ranged') {
      LivingDungeon._spawnNear(room, 'void_assassin', spawn, 2, (m) => {
        m.speed = +(m.speed * 1.25).toFixed(2);
        m.name = `Dungebred ${m.name}`;
      });
    } else if (dominance === 'melee') {
      LivingDungeon._spawnNear(room, 'crypt_ghoul', spawn, 2, (m) => {
        m.resistPhysical = 0.45; m.thorns = (m.thorns || 0) + 10;
        m.name = `Thorn-Hardened ${m.name}`;
      });
    } else {
      LivingDungeon._spawnNear(room, 'blight_necrolyte', spawn, 2, (m) => {
        m.resistMagic = 0.45; m.attackCooldown = 1.0;
        m.name = `Null-Warded ${m.name}`;
      });
    }
    LivingDungeon._whisper(room,
      `👁️ "The dungeon REMEMBERS your ${label}... it came prepared."`);
  },

  // --- snapshot --------------------------------------------------------------------------

  getPublicState(room) {
    const ld = room.livingDungeon;
    if (!ld) return { pressure: 0, adaptations: [], dominance: null };
    const d = ld.floor.damage;
    const total = d.melee + d.ranged + d.magic;
    let dominance = null;
    if (total >= MIN_TRACKED_DAMAGE) {
      if (d.ranged / total > DOMINANCE_THRESHOLD) dominance = 'ranged';
      else if (d.melee / total > DOMINANCE_THRESHOLD) dominance = 'melee';
      else if (d.magic / total > DOMINANCE_THRESHOLD) dominance = 'magic';
    }
    return {
      pressure: ld.floor.pressureDeaths,
      adaptations: [...ld.floor.adaptations],
      adaptationsTotal: ld.memory.adaptationsTotal,
      dominance,
      remembered: ld.memory.lastDominance
    };
  }
};

module.exports = LivingDungeon;
