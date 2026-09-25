// server/game/systems/Nemesis.js — NEMESIS-LITE (workstream 6, third signature pick).
//
// An elite that escapes at low HP REMEMBERS who hurt it and returns stronger
// later in the run — with a personal grudge. Kill it for good and the grudge
// is settled with bonus spoils; let it slip away three times and it escapes
// the dungeon entirely, laughing.
//
// Why this pick: Relic Fusion is loot-crafting (common), Greed Shrines overlap
// Oaths mechanically — but a personal nemesis arc is the single most memorable
// thing a roguelike run can produce, it needs zero new assets (reuses elite
// types, renamed + boosted), and it harmonizes with the other two systems'
// themes: the dungeon REMEMBERS (Living Dungeon) and debts are PERSONAL
// (Covenant Oaths).
//
// Server-authoritative. One nemesis at a time per room; elites only.
//
// Coordinator hook checklist (see SIGNATURE_PROTOCOL.md for exact call sites):
//   Nemesis.init(room)                                  — room construction
//   Nemesis.onMobDamaged(room, mob, attacker, amount)   — after mob.takeDamage
//   Nemesis.tryLethalEscape(room, mob, killer)          — in deal paths, when
//        res.isDead && mob is elite; if it returns true, SKIP handleEntityDeath
//   Nemesis.onFloorStart(room)                          — generateProceduralDungeonFloor
//   Nemesis.onRoomTick(room)                            — each tick
//   Nemesis.modifyDamageToPlayer(mob, player, amount)   — mob->player damage
//   Nemesis.onNemesisSlain(room, mob, killer)           — handleEntityDeath when mob.isNemesis
//   Nemesis.getPublicState(room)                        — merged into snapshot.signature
'use strict';

const ELITE_TYPES = ['elite_executioner', 'elite_lich'];
const FLEE_HP_FRac = 0.22;      // non-lethal flee check below 22% HP
const FLEE_CHANCE = 0.45;
const RETURN_DELAY_MS = 90000;  // returns ~90s after fleeing, or next floor
const MAX_RETURNS = 3;          // after the 3rd return there is nowhere left to run
const GRUDGE_DMG_MULT = 1.30;   // +30% damage vs its grudge target

const RETURN_TITLES = {
  1: 'the Returned',
  2: 'Twice-Returned',
  3: 'Thrice-Returned, Apex of the Deep'
};

const TAUNTS = [
  '{name}, you left me bleeding in the dark. I REMEMBER.',
  'Did you miss me, {name}? I counted every wound you gave me.',
  '{name}! This time I brought friends. This time you do not walk away.',
  'You should have finished it, {name}. Now I finish YOU.'
];

function ensure(room) {
  if (!room.nemesis) {
    room.nemesis = {
      active: null,       // { type, baseName, name, returns, grudges:{pid:amount}, grudgeName, grudgeId, mobId, fledAt }
      pendingReturnAt: 0,
      escapedForever: []  // names that slipped away for good
    };
  }
  return room.nemesis;
}

function grudgeLeader(room, grudges) {
  let bestId = null, bestDmg = -1;
  for (const [pid, dmg] of Object.entries(grudges || {})) {
    if (dmg > bestDmg) { bestDmg = dmg; bestId = pid; }
  }
  const p = bestId && room.players[bestId];
  if (p && !p.isDead) return p;
  // fall back: a random living hero becomes the grudge target
  const alive = Object.values(room.players).filter(pl => !pl.isDead && !pl.isDowned);
  return alive[Math.floor(Math.random() * alive.length)] || null;
}

const Nemesis = {

  init(room) { ensure(room); },

  isElite(mob) {
    return !!mob && ELITE_TYPES.includes(mob.type);
  },

  // Track who hurt it; maybe it flees BEFORE the killing blow.
  onMobDamaged(room, mob, attacker, amount) {
    if (!Nemesis.isElite(mob) || mob.isDead || amount <= 0) return;
    if (!attacker || !attacker.id || attacker.isBot) return;
    mob.grudges = mob.grudges || {};
    mob.grudges[attacker.id] = (mob.grudges[attacker.id] || 0) + amount;

    const st = ensure(room);
    // No flee if a nemesis is already active, or this one has run out of road.
    if (st.active) return;
    if (mob.isNemesis && (mob.nemesisReturns || 0) >= MAX_RETURNS) return;

    const frac = mob.hp / Math.max(1, mob.maxHp);
    if (frac < FLEE_HP_FRac && Math.random() < FLEE_CHANCE) {
      Nemesis.flee(room, mob, attacker, false);
    }
  },

  // Called when a killing blow lands on an elite. Returns true if the elite
  // ESCAPED instead of dying — coordinator must skip handleEntityDeath then.
  // The FIRST lethal blow per run against an elite always triggers the arc
  // (deterministic, so the fantasy reliably happens); later elites die clean.
  tryLethalEscape(room, mob, killer) {
    if (!Nemesis.isElite(mob)) return false;
    const st = ensure(room);
    if (st.active) return false;                    // one nemesis at a time
    if (mob.isNemesis && (mob.nemesisReturns || 0) >= MAX_RETURNS) return false;
    if (mob.isNemesis) return Nemesis.flee(room, mob, killer, true), true;
    if (st.escapedForever.length > 0 || st.totalArcs > 0) return false; // one arc per run
    return Nemesis.flee(room, mob, killer, true), true;
  },

  flee(room, mob, killer, wasLethal) {
    const st = ensure(room);
    const target = grudgeLeader(room, mob.grudges);
    const grudgeName = target ? target.name : 'the party';

    mob.isDead = true;
    mob.fledNemesis = true;
    room.mobs = (room.mobs || []).filter(m => m.id !== mob.id);

    const returns = mob.isNemesis ? (mob.nemesisReturns || 0) : 0;
    const name = mob.isNemesis ? mob.name : mob.name;

    st.active = {
      type: mob.type,
      baseName: mob.name.replace(/, (the Returned|Twice-Returned|Thrice-Returned.*)$/, ''),
      name,
      returns,                    // completed returns so far
      grudges: { ...(mob.grudges || {}) },
      grudgeId: target ? target.id : null,
      grudgeName,
      mobId: null,
      fledAt: Date.now(),
      wasLethal
    };
    st.totalArcs = (st.totalArcs || 0) + 1;
    st.pendingReturnAt = Date.now() + RETURN_DELAY_MS;

    room.broadcast({ type: 'screen_shake', magnitude: 0.4, duration: 0.4 });
    room.broadcast({
      type: 'ground_fx', fxType: 'smoke_veil',
      x: mob.x, z: mob.z, radius: 5.0
    });
    room.broadcast({
      type: 'nemesis_fled',
      mobId: mob.id,
      name,
      grudgeName,
      returns,
      text: `💨 ${name} ${wasLethal ? 'cheats death at the final instant' : 'melts into the shadows at low health'} — fleeing into the dark! It will remember ${grudgeName}...`
    });
    room.broadcast({
      type: 'narrator_announcement',
      text: `${name} escapes into the lightless deep, clutching its wounds. Somewhere below, it is already planning revenge on ${grudgeName}.`,
      tone: 'danger'
    });
    return true;
  },

  // The nemesis returns at the START of the next floor (dramatic entrance),
  // or 90s later if the party lingers.
  onFloorStart(room) {
    const st = ensure(room);
    if (st.active && st.pendingReturnAt) {
      Nemesis.spawnReturn(room);
    }
  },

  onRoomTick(room) {
    if (room.state !== 'dungeon') return;
    const st = ensure(room);
    if (st.active && st.pendingReturnAt && Date.now() >= st.pendingReturnAt) {
      Nemesis.spawnReturn(room);
    }
  },

  spawnReturn(room) {
    const st = ensure(room);
    const arc = st.active;
    if (!arc) return;
    st.pendingReturnAt = 0;

    const target = (arc.grudgeId && room.players[arc.grudgeId] && !room.players[arc.grudgeId].isDead)
      ? room.players[arc.grudgeId]
      : grudgeLeader(room, arc.grudges);
    if (!target) return; // nobody left to hate; arc fizzles

    const returns = arc.returns + 1;
    const ang = Math.random() * Math.PI * 2;
    const mob = room.spawnMob(arc.type, target.x + Math.cos(ang) * 8, target.z + Math.sin(ang) * 8);
    if (!mob) return;

    const hpMult = 1 + 0.45 * returns;
    const dmgMult = 1 + 0.25 * returns;
    mob.maxHp = Math.round(mob.maxHp * hpMult);
    mob.hp = mob.maxHp;
    mob.damage = Math.round(mob.damage * dmgMult);
    mob.speed = +(mob.speed + 0.4 * returns).toFixed(2);
    mob.isNemesis = true;
    mob.nemesisReturns = returns;
    mob.grudgeTargetId = target.id;
    mob.grudges = { ...(arc.grudges || {}) };
    mob.name = `${arc.baseName}, ${RETURN_TITLES[Math.min(returns, MAX_RETURNS)]}`;

    arc.mobId = mob.id;
    arc.returns = returns;
    arc.name = mob.name;
    arc.grudgeId = target.id;
    arc.grudgeName = target.name;

    const taunt = TAUNTS[Math.floor(Math.random() * TAUNTS.length)].replace('{name}', target.name);

    room.broadcast({ type: 'screen_shake', magnitude: 0.7, duration: 0.6 });
    room.broadcast({
      type: 'nemesis_returned',
      mobId: mob.id,
      name: mob.name,
      grudgeName: target.name,
      returns,
      taunt,
      x: mob.x, z: mob.z,
      text: `⚔️ ${mob.name} HAS RETURNED! "${taunt}"`
    });
    room.broadcast({
      type: 'narrator_announcement',
      text: `${mob.name} claws its way back from the deep — stronger, faster, and furious. "${taunt}"`,
      tone: 'danger'
    });
    room.broadcast({
      type: 'floating_text', text: `⚔️ ${mob.name.toUpperCase()}!`,
      x: mob.x, z: mob.z, style: 'crit'
    });
  },

  // +30% damage against its grudge target. Coordinator: apply in mob->player damage.
  modifyDamageToPlayer(mob, player, amount) {
    if (mob && mob.isNemesis && player && player.id === mob.grudgeTargetId) {
      return Math.round(amount * GRUDGE_DMG_MULT);
    }
    return amount;
  },

  // Called from handleEntityDeath when the slain mob is the nemesis.
  // Settles the grudge with bonus spoils.
  onNemesisSlain(room, mob, killer) {
    const st = ensure(room);
    const arc = st.active;
    st.active = null;
    st.pendingReturnAt = 0;

    const killerName = killer ? killer.name : 'The Party';
    const settledVsGrudge = killer && mob.grudgeTargetId && killer.id === mob.grudgeTargetId;

    // Bonus spoils: two elite gear drops + shards for every human hero.
    try {
      const LootGenerator = require('./LootGenerator');
      for (let i = 0; i < 2; i++) {
        const item = LootGenerator.generateItem(room.floor || 1, 'elite');
        room.spawnFloorLoot('gear_drop', mob.x + (i === 0 ? -1.2 : 1.2), mob.z + 0.8,
          item.gearScore, item.name, false, item);
      }
    } catch (e) { /* loot is a bonus, never a crash */ }
    for (const p of Object.values(room.players)) {
      if (!p.isBot) p.stats.shardsEarned = (p.stats.shardsEarned || 0) + 50;
    }

    room.broadcast({
      type: 'nemesis_slain',
      name: mob.name,
      killerName,
      returns: mob.nemesisReturns || 0,
      text: settledVsGrudge
        ? `🏆 THE GRUDGE IS SETTLED! ${killerName} puts down ${mob.name} face-to-face! Bonus spoils for the party!`
        : `🏆 THE GRUDGE IS SETTLED! ${killerName} slays ${mob.name}! It will not return. Bonus spoils for the party!`
    });
    room.broadcast({
      type: 'narrator_announcement',
      text: `${mob.name} collapses — truly dead this time. The debt is paid in full.`,
      tone: 'victory'
    });
  },

  getPublicState(room) {
    const st = room.nemesis;
    if (!st || !st.active) return { active: null, escapedForever: (st && st.escapedForever) || [] };
    return {
      active: {
        name: st.active.name,
        returns: st.active.returns,
        grudgeName: st.active.grudgeName,
        mobId: st.active.mobId
      },
      escapedForever: st.escapedForever
    };
  }
};

module.exports = Nemesis;
