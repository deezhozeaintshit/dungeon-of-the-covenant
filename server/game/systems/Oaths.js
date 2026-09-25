// server/game/systems/Oaths.js — COVENANT OATHS (signature flagship mechanic).
//
// Mid-run, a player may swear a binding oath to a dark power at an Oath Shrine
// (covenant obelisk / soul altar). Every oath is a REAL tradeoff: a permanent
// run-long benefit paired with a run-long cost AND a behavioral term. Violating
// the term breaks the oath and triggers a curse. Server-authoritative; every
// swear/break is broadcast to the party (betrayal is the point).
//
// NEW FILES ONLY — the coordinator wires hooks into Room.js / server.js.
// Defensive optional-chaining is used for Health/Progression/Abilities systems.
//
// Coordinator hook checklist (see SIGNATURE_PROTOCOL.md for exact call sites):
//   Oaths.onFloorStart(room)            — after initDungeonLayout
//   Oaths.checkShrineProximity(room)    — each tick
//   Oaths.handleSwear(room, pid, shrineId, oathId) — on ws 'swear_oath'
//   Oaths.onTick(room, dt)              — each tick
//   Oaths.onKill(room, killer, entity)  — in handleEntityDeath, killer set
//   Oaths.recordDamageDealt(room, pid, amount) — in deal paths (tithe term)
//   Oaths.modifyOutgoingDamage(p, amt)  — curse multipliers, in deal paths
//   Oaths.getDamageTakenMult(p)         — in damagePlayer
//   Oaths.getSpeedMult(p) / getThorns(p) — movement / melee reflect
//   Oaths.onAreaDamageLanded(room, attacker, x, z, radius, base) — Ruin FF
//   Oaths.onHeal(room, src, target, amt) — Silent Coin heal denial
//   Oaths.onDash(room, player)          — Iron Vigil term check
//   Oaths.onPlayerDowned(room, player)  — Martyr + Hollow Saint checks
//   Oaths.modifyGoldPickup(p, amt) / modifyXpGain(p, amt) — Silent Coin x2
//   Oaths.getPublicState(room)          — merged into snapshot.signature
'use strict';

const MAX_OATHS_PER_PLAYER = 2;
const SHRINE_OFFER_RADIUS = 3.4;   // stand this close to be offered the bargain
const SWEAR_RANGE = 5.0;           // max distance to seal it
const TITHE_STARVE_SEC = 90;       // Crimson Tithe: deal damage this often or it collects
const RUIN_STARVE_SEC = 75;        // Oath of Ruin: feed it kills this often
const HOLLOW_AURA_RADIUS = 6.0;
const HOLLOW_AURA_TICK = 2.0;      // seconds between aura heals
const HOLLOW_AURA_PCT = 0.03;      // 3% max HP per tick
const HUNT_INTERVAL_SEC = 45;      // Hollow Saint: ambush cadence
const MARTYR_BUFF_RADIUS = 15.0;
const MARTYR_BUFF_SEC = 20;

// ---------------------------------------------------------------------------
// Oath definitions. apply/remove mutate real player stats. breakCheck hooks
// are invoked from Oaths.onTick / event hooks below.
// ---------------------------------------------------------------------------
const OATH_DEFS = {
  crimson_tithe: {
    id: 'crimson_tithe',
    name: 'Oath of the Crimson Tithe',
    patron: 'The Red Ledger',
    icon: '🩸',
    flavor: '"Power is never given. It is bled for. Sign — and bleed well."',
    benefit: '+35% damage dealt (permanent this run)',
    cost: 'Max HP permanently −20% this run (never restored)',
    term: 'The Tithe must be fed: deal damage at least once every 90s while foes remain, or it collects from YOU.',
    curseName: 'The Tithe Collects',
    curseDesc: 'Lose 30% of current HP instantly. The oath is void.',
    apply(room, player) {
      player.damageBuff = +(player.damageBuff * 1.35).toFixed(2);
      const newMax = Math.max(1, Math.round(player.maxHp * 0.8));
      setMaxHp(room, player, newMax); // permanent: remove() does NOT restore
    },
    remove(room, player) {
      player.damageBuff = +(player.damageBuff / 1.35).toFixed(2);
    },
    breakCurse(room, player) {
      const loss = Math.round(player.hp * 0.30);
      if (loss > 0 && typeof player.takeDamage === 'function') {
        player.takeDamage(loss, 'dark', 'The Tithe Collects');
      }
      return null; // instant curse, no timed debuff
    }
  },

  hollow_saint: {
    id: 'hollow_saint',
    name: 'Oath of the Hollow Saint',
    patron: 'The Hollow Saint',
    icon: '🕯️',
    flavor: '"I will keep your hearts beating. In exchange, the dark will learn your name."',
    benefit: 'Heal-over-time aura: you and nearby allies regenerate 3% max HP every 2s',
    cost: 'You are HUNTED — ambush packs spawn to kill you every 45s',
    term: 'The Saint demands vigilance: if an ally falls within 12m of you, the oath breaks.',
    curseName: "The Saint's Silence",
    curseDesc: 'The aura dies. You are marked: +20% damage taken for 60s.',
    apply() { /* aura + hunt driven by onTick runtime */ },
    remove() { /* runtime cleared */ },
    breakCurse() {
      return { id: 'saints_silence', name: "The Saint's Silence", damageTakenMult: 1.2, durationSec: 60 };
    }
  },

  ruin: {
    id: 'ruin',
    name: 'Oath of Ruin',
    patron: 'Ruin, the Unmaker',
    icon: '💥',
    flavor: '"Everything breaks. Swear, and be the breaking."',
    benefit: 'Your kills detonate: 90 fire damage in 4.5m',
    cost: 'FRIENDLY FIRE IS ON FOR YOU — your attacks wound allies for 50% of base damage',
    term: 'Ruin must be fed: land a killing blow at least once every 75s while foes remain, or it feeds on you.',
    curseName: 'Ruin Unbound',
    curseDesc: 'For 60s, 15% of all damage you deal is reflected back into you.',
    apply() {},
    remove() {},
    breakCurse() {
      return { id: 'ruin_unbound', name: 'Ruin Unbound', reflectPct: 0.15, durationSec: 60 };
    }
  },

  silent_coin: {
    id: 'silent_coin',
    name: 'Oath of the Silent Coin',
    patron: 'The Silent Coin',
    icon: '🪙',
    flavor: '"Wealth loves the quiet. Let no hand but yours sustain you."',
    benefit: 'DOUBLE gold and XP from your kills',
    cost: 'You cannot be healed by others — their magic dies on your skin',
    term: 'Suffer an ally\'s healing touch twice and the Coin calls the debt.',
    curseName: 'Poverty of the Grave',
    curseDesc: 'Lose 50% of your carried gold. −25% damage for 60s.',
    apply() {},
    remove() {},
    breakCurse(room, player) {
      player.stats.goldCollected = Math.floor(player.stats.goldCollected * 0.5);
      return { id: 'poverty_of_the_grave', name: 'Poverty of the Grave', damageMult: 0.75, durationSec: 60 };
    }
  },

  iron_vigil: {
    id: 'iron_vigil',
    name: 'Oath of the Iron Vigil',
    patron: 'The Iron Vigil',
    icon: '🛡️',
    flavor: '"Stand. Do not bend. Do not run. The Vigil does not retreat."',
    benefit: '−30% damage taken, +15 thorns (melee attackers bleed)',
    cost: '−25% move speed, forever this run',
    term: 'The Vigil never retreats: dashing while a foe stands within 6m breaks the oath.',
    curseName: "The Vigil's Shame",
    curseDesc: '−25% damage for 60s. The party will remember your cowardice.',
    apply() {},
    remove() {},
    breakCurse() {
      return { id: 'vigils_shame', name: "The Vigil's Shame", damageMult: 0.75, durationSec: 60 };
    }
  },

  ashen_martyr: {
    id: 'ashen_martyr',
    name: 'Oath of the Ashen Martyr',
    patron: 'The Ashen Martyr',
    icon: '🔥',
    flavor: '"Fall where they can see you. Your ending is their beginning."',
    benefit: '+10% damage. When you fall, nearby allies gain +50% damage & +40% speed for 20s',
    cost: 'Your downed timer is halved (15s to death)',
    term: 'A death alone is just a death: if you fall with NO ally within 15m, the oath breaks.',
    curseName: 'Hollow Sacrifice',
    curseDesc: '−20% damage for 60s. Your death meant nothing.',
    apply(room, player) {
      player.damageBuff = +(player.damageBuff * 1.10).toFixed(2);
    },
    remove(room, player) {
      player.damageBuff = +(player.damageBuff / 1.10).toFixed(2);
    },
    breakCurse() {
      return { id: 'hollow_sacrifice', name: 'Hollow Sacrifice', damageMult: 0.80, durationSec: 60 };
    }
  }
};

const OATH_IDS = Object.keys(OATH_DEFS);

// --- internal helpers ------------------------------------------------------

function setMaxHp(room, player, newMax) {
  // Prefer the Health system when it exists; fall back to direct mutation.
  const health = room.systems && room.systems.health;
  if (health && typeof health.setMaxHp === 'function') {
    health.setMaxHp(room, player.id, newMax);
  } else {
    player.maxHp = Math.max(1, Math.round(newMax));
    player.hp = Math.min(player.hp, player.maxHp);
  }
}

function oathState(player) {
  if (!player.oathState) player.oathState = { oaths: [], curses: [] };
  return player.oathState;
}

function hasOath(player, oathId) {
  return oathState(player).oaths.some(o => o.id === oathId);
}

function getOath(player, oathId) {
  return oathState(player).oaths.find(o => o.id === oathId);
}

function activeCurses(player) {
  const now = Date.now();
  const st = oathState(player);
  st.curses = st.curses.filter(c => c.expiresAt > now);
  return st.curses;
}

function alivePlayers(room) {
  return Object.values(room.players).filter(p => !p.isDead);
}

function foesAlive(room) {
  const mobs = (room.mobs || []).some(m => !m.isDead);
  const boss = room.boss && !room.boss.isDead;
  return mobs || boss;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const Oaths = {

  defs: OATH_DEFS,
  MAX_OATHS_PER_PLAYER,

  // --- floor lifecycle -----------------------------------------------------

  onFloorStart(room) {
    room.oathShrines = [];
    // Two shrines per floor near the Grand Crossroads hub (mid-run discovery).
    const spots = [
      { x: -7.5, z: -19.5, model: 'oath_obelisk', name: 'Obelisk of the First Bargain' },
      { x: 7.5, z: -19.5, model: 'oath_altar', name: 'Altar of the Second Price' }
    ];
    for (const s of spots) {
      const offered = [...OATH_IDS].sort(() => Math.random() - 0.5).slice(0, 3);
      room.oathShrines.push({
        id: `oathshrine_${room.nextEntityId++}`,
        x: s.x, y: 0, z: s.z,
        model: s.model, // 'oath_obelisk' -> covenant_obelisk.glb, 'oath_altar' -> soul_altar.glb
        name: s.name,
        offeredOathIds: offered,
        usedBy: [],      // playerIds that already swore here
        offeredTo: []     // playerIds already shown the modal
      });
    }
    room.broadcast({
      type: 'oath_shrines_spawned',
      shrines: room.oathShrines.map(s => ({
        id: s.id, x: s.x, z: s.z, model: s.model, name: s.name
      })),
      text: '🕯️ Two oath-shrines smolder at the Grand Crossroads. The dark powers are listening...'
    });
  },

  // Offer the bargain when a living human hero lingers near a shrine.
  checkShrineProximity(room) {
    if (!room.oathShrines || room.state !== 'dungeon') return;
    for (const shrine of room.oathShrines) {
      for (const p of alivePlayers(room)) {
        if (p.isBot || p.isDowned) continue;
        if (shrine.offeredTo.includes(p.id) || shrine.usedBy.includes(p.id)) continue;
        if (oathState(p).oaths.length >= MAX_OATHS_PER_PLAYER) continue;
        if (Math.hypot(p.x - shrine.x, p.z - shrine.z) > SHRINE_OFFER_RADIUS) continue;
        shrine.offeredTo.push(p.id);
        room.broadcast({
          type: 'oath_shrine_available',
          playerId: p.id,
          shrineId: shrine.id,
          shrineName: shrine.name,
          x: shrine.x, z: shrine.z,
          choices: shrine.offeredOathIds.map(id => publicDef(OATH_DEFS[id]))
        });
      }
    }
  },

  // --- swearing --------------------------------------------------------------

  handleSwear(room, playerId, shrineId, oathId) {
    const player = room.players[playerId];
    const shrine = (room.oathShrines || []).find(s => s.id === shrineId);
    const def = OATH_DEFS[oathId];
    const deny = (reason) => {
      room.broadcast({ type: 'oath_swear_denied', playerId, reason });
      return false;
    };
    if (!player || player.isDead || player.isDowned) return deny('You must be standing to swear.');
    if (player.isBot) return deny('Bots cannot swear oaths.');
    if (!shrine) return deny('That shrine is gone.');
    if (!def) return deny('No such oath exists.');
    if (Math.hypot(player.x - shrine.x, player.z - shrine.z) > SWEAR_RANGE) return deny('You must stand before the shrine to swear.');
    if (shrine.usedBy.includes(playerId)) return deny('You have already sworn at this shrine.');
    if (!shrine.offeredOathIds.includes(oathId)) return deny('That oath was not offered here.');
    if (hasOath(player, oathId)) return deny('You already bear that oath.');
    const st = oathState(player);
    if (st.oaths.length >= MAX_OATHS_PER_PLAYER) return deny(`A soul can bear at most ${MAX_OATHS_PER_PLAYER} oaths per run.`);

    const now = Date.now();
    const runtime = {
      id: oathId,
      swornAt: now,
      shrineId,
      auraTimer: 0,
      huntTimer: HUNT_INTERVAL_SEC * 0.5, // first hunt comes sooner — the dark is eager
      lastDamageAt: now,
      lastKillAt: now,
      violations: 0
    };
    def.apply(room, player);
    st.oaths.push(runtime);
    shrine.usedBy.push(playerId);

    room.broadcast({
      type: 'oath_sworn',
      playerId: player.id,
      playerName: player.name,
      classKey: player.classKey,
      oathId, oathName: def.name, icon: def.icon,
      flavor: def.flavor,
      partyText: `⚔️ ${player.name} has sworn the ${def.name}! ${def.benefit} — but: ${def.cost}`
    });
    room.broadcast({
      type: 'narrator_announcement',
      text: `${player.name} kneels before the ${shrine.name} and swears the ${def.name}. The dark powers accept... for now.`,
      tone: 'warning'
    });
    return true;
  },

  // --- breaking & curses -------------------------------------------------------

  breakOath(room, playerId, oathId, reason) {
    const player = room.players[playerId];
    if (!player) return false;
    const st = oathState(player);
    const idx = st.oaths.findIndex(o => o.id === oathId);
    if (idx === -1) return false;
    const def = OATH_DEFS[oathId];
    st.oaths.splice(idx, 1);
    def.remove(room, player);

    const curse = def.breakCurse(room, player);
    if (curse) {
      curse.expiresAt = Date.now() + curse.durationSec * 1000;
      st.curses.push(curse);
    }

    room.broadcast({
      type: 'oath_broken',
      playerId: player.id,
      playerName: player.name,
      oathId, oathName: def.name, icon: def.icon,
      reason,
      curseName: def.curseName,
      curseDesc: def.curseDesc,
      partyText: `💀 ${player.name} has BROKEN the ${def.name}! ${reason} — ${def.curseName}: ${def.curseDesc}`
    });
    room.broadcast({
      type: 'narrator_announcement',
      text: `${player.name} breaks the ${def.name}! ${def.curseName} falls upon them: ${def.curseDesc}`,
      tone: 'danger'
    });
    return true;
  },

  // --- per-tick -----------------------------------------------------------------

  onTick(room, dt) {
    if (room.state !== 'dungeon') return;
    const now = Date.now();
    const foes = foesAlive(room);

    for (const p of alivePlayers(room)) {
      const st = oathState(p);
      if (st.oaths.length === 0 && st.curses.length === 0) continue;

      // expire curses (also prunes in activeCurses)
      activeCurses(p);

      for (const oath of [...st.oaths]) {
        const def = OATH_DEFS[oath.id];

        if (oath.id === 'hollow_saint') {
          // HoT aura
          oath.auraTimer -= dt;
          if (oath.auraTimer <= 0) {
            oath.auraTimer = HOLLOW_AURA_TICK;
            for (const ally of alivePlayers(room)) {
              if (ally.isDowned) continue;
              if (Math.hypot(ally.x - p.x, ally.z - p.z) <= HOLLOW_AURA_RADIUS) {
                const amt = Math.max(1, Math.round(ally.maxHp * HOLLOW_AURA_PCT));
                ally.hp = Math.min(ally.maxHp, ally.hp + amt);
              }
            }
          }
          // HUNTED: ambush packs target the oathbearer
          oath.huntTimer -= dt;
          if (oath.huntTimer <= 0) {
            oath.huntTimer = HUNT_INTERVAL_SEC;
            Oaths._spawnHuntPack(room, p);
          }
        }

        if (oath.id === 'crimson_tithe' && foes) {
          if ((now - oath.lastDamageAt) / 1000 > TITHE_STARVE_SEC) {
            Oaths.breakOath(room, p.id, oath.id,
              'The Tithe went unfed for 90 seconds.');
          }
        }

        if (oath.id === 'ruin' && foes) {
          if ((now - oath.lastKillAt) / 1000 > RUIN_STARVE_SEC) {
            Oaths.breakOath(room, p.id, oath.id,
              'Ruin went unfed for 75 seconds — no killing blow was landed.');
          }
        }
      }
    }
  },

  _spawnHuntPack(room, target) {
    const packTypes = ['void_assassin', 'void_assassin', 'cinder_thrall'];
    for (const t of packTypes) {
      const ang = Math.random() * Math.PI * 2;
      const r = 7 + Math.random() * 3;
      const mob = room.spawnMob(t, target.x + Math.cos(ang) * r, target.z + Math.sin(ang) * r);
      if (mob) {
        mob.huntTargetId = target.id; // coordinator: mob AI prioritizes this player
        mob.name = `Hunting ${mob.name}`;
      }
    }
    room.broadcast({
      type: 'narrator_announcement',
      text: `The dark stirs... a hunting pack scents ${target.name}, oathbearer of the Hollow Saint!`,
      tone: 'danger'
    });
    room.broadcast({
      type: 'floating_text',
      text: '👁️ HUNTED! The pack comes for you!',
      x: target.x, z: target.z, style: 'crit'
    });
  },

  // --- combat hooks --------------------------------------------------------------

  // Call from deal paths whenever a player deals damage (feeds Tithe term).
  recordDamageDealt(room, playerId, amount) {
    const p = room.players[playerId];
    if (!p || amount <= 0) return;
    const oath = getOath(p, 'crimson_tithe');
    if (oath) oath.lastDamageAt = Date.now();
  },

  // Outgoing damage multiplier from active curses (oath benefits ride damageBuff).
  modifyOutgoingDamage(player, amount) {
    let mult = 1.0;
    for (const c of activeCurses(player)) {
      if (c.damageMult) mult *= c.damageMult;
    }
    return Math.round(amount * mult);
  },

  // Incoming damage multiplier: Iron Vigil −30%; Saint's Silence +20%.
  getDamageTakenMult(player) {
    let mult = 1.0;
    if (hasOath(player, 'iron_vigil')) mult *= 0.70;
    for (const c of activeCurses(player)) {
      if (c.damageTakenMult) mult *= c.damageTakenMult;
    }
    return mult;
  },

  getSpeedMult(player) {
    return hasOath(player, 'iron_vigil') ? 0.75 : 1.0;
  },

  getThorns(player) {
    return hasOath(player, 'iron_vigil') ? 15 : 0;
  },

  // Ruin Unbound curse: reflect a slice of dealt damage back at the attacker.
  onOutgoingDamageLanded(room, attacker, amount) {
    for (const c of activeCurses(attacker)) {
      if (c.reflectPct && amount > 0) {
        const reflect = Math.max(1, Math.round(amount * c.reflectPct));
        if (typeof attacker.takeDamage === 'function') {
          attacker.takeDamage(reflect, 'dark', c.name);
        }
        room.broadcast({
          type: 'floating_text', text: `💀 RUIN REFLECTS! -${reflect}`,
          x: attacker.x, z: attacker.z, style: 'crit'
        });
      }
    }
  },

  // Oath of Ruin: after the attacker's AoE lands, allies in the blast take 50%.
  onAreaDamageLanded(room, attacker, x, z, radius, baseDamage) {
    if (!attacker || !hasOath(attacker, 'ruin')) return;
    if (attacker.isBot) return;
    const ff = Math.max(1, Math.round(baseDamage * 0.5));
    for (const ally of alivePlayers(room)) {
      if (ally.id === attacker.id || ally.isDowned) continue;
      if (Math.hypot(ally.x - x, ally.z - z) <= radius + 1.0) {
        ally.takeDamage(ff, 'fire', `${attacker.name} (Oath of Ruin)`);
        room.broadcast({
          type: 'floating_text', text: `🔥 FRIENDLY FIRE! -${ff}`,
          x: ally.x, z: ally.z, style: 'crit'
        });
      }
    }
  },

  // Oath of Ruin: kills detonate. Guarded against chain reactions.
  onKill(room, killer, entity) {
    if (!killer || killer.isBot || !hasOath(killer, 'ruin')) return;
    const oath = getOath(killer, 'ruin');
    oath.lastKillAt = Date.now();
    if (room._oathRuinChain) return;
    room._oathRuinChain = true;
    try {
      room.broadcast({
        type: 'ground_fx', fxType: 'corpse_explosion',
        x: entity.x, z: entity.z, radius: 4.5, usedCorpse: true
      });
      room.dealAreaDamage(killer, entity.x, entity.z, 4.5, 90, 'fire');
    } finally {
      room._oathRuinChain = false;
    }
  },

  // Silent Coin: external heals die on the oathbearer's skin. 2nd touch = broken.
  // Returns the final heal amount. Coordinator MUST route ALL ally-heals through here:
  // sanctuary ticks, cleric beam/lance ally-heal, tactical 'heal', soul-drain share.
  onHeal(room, source, target, amount) {
    if (!source || !target || source.id === target.id) return amount;
    if (!hasOath(target, 'silent_coin')) return amount;
    const oath = getOath(target, 'silent_coin');
    oath.violations += 1;
    room.broadcast({
      type: 'floating_text',
      text: oath.violations === 1
        ? '🪙 THE COIN WARNS: no other hand may sustain you!'
        : '🪙 THE COIN CALLS THE DEBT!',
      x: target.x, z: target.z, style: 'crit'
    });
    if (oath.violations >= 2) {
      Oaths.breakOath(room, target.id, 'silent_coin',
        `${source.name}'s healing touched them a second time.`);
    }
    return 0;
  },

  // Iron Vigil term: dashing while a foe is within 6m = retreat = broken.
  onDash(room, player) {
    if (!hasOath(player, 'iron_vigil')) return;
    const near = room.findNearestFoe ? room.findNearestFoe(player.x, player.z, 6.0) : null;
    if (near) {
      Oaths.breakOath(room, player.id, 'iron_vigil',
        'They dashed from battle with a foe within 6m. The Vigil does not retreat.');
    }
  },

  // Ashen Martyr: falling alone breaks it; falling among allies empowers them.
  // Hollow Saint: an ally falling within 12m of an oathbearer breaks THEIR oath.
  onPlayerDowned(room, player) {
    for (const p of alivePlayers(room)) {
      if (p.id === player.id || p.isBot) continue;
      if (hasOath(p, 'hollow_saint') &&
          Math.hypot(p.x - player.x, p.z - player.z) <= 12.0) {
        Oaths.breakOath(room, p.id, 'hollow_saint',
          `${player.name} fell within 12m of them. The Saint demands vigilance.`);
      }
    }
    if (hasOath(player, 'ashen_martyr')) {
      const near = alivePlayers(room).filter(a =>
        a.id !== player.id && !a.isDowned &&
        Math.hypot(a.x - player.x, a.z - player.z) <= MARTYR_BUFF_RADIUS);
      if (near.length === 0) {
        Oaths.breakOath(room, player.id, 'ashen_martyr',
          'They fell with no ally within 15m. A death alone is just a death.');
      } else {
        for (const ally of near) {
          ally.damageBuff = +(ally.damageBuff * 1.5).toFixed(2);
          ally._martyrExpiry = Date.now() + MARTYR_BUFF_SEC * 1000;
          ally._martyrFrom = player.id;
          const baseSpeed = ally.speed;
          ally.speed = +(baseSpeed * 1.4).toFixed(2);
          ally._martyrSpeedRestore = baseSpeed;
          setTimeout(() => {
            if (!ally.isDead) {
              ally.damageBuff = +(ally.damageBuff / 1.5).toFixed(2);
              if (ally._martyrSpeedRestore) ally.speed = ally._martyrSpeedRestore;
            }
          }, MARTYR_BUFF_SEC * 1000);
        }
        room.broadcast({
          type: 'combo_alert',
          comboName: `🔥 MARTYR'S PYRE! ${player.name}'s fall empowers the party! (+50% DMG, +40% SPD, 20s)`,
          x: player.x, z: player.z
        });
      }
    }
  },

  // Silent Coin economy hooks.
  modifyGoldPickup(player, amount) {
    return hasOath(player, 'silent_coin') ? amount * 2 : amount;
  },
  modifyXpGain(player, amount) {
    return hasOath(player, 'silent_coin') ? amount * 2 : amount;
  },

  // --- snapshot ------------------------------------------------------------------

  getPublicState(room) {
    const oaths = {};
    const curses = {};
    for (const p of Object.values(room.players)) {
      const st = p.oathState;
      if (!st) continue;
      if (st.oaths.length) {
        oaths[p.id] = st.oaths.map(o => ({
          id: o.id, name: OATH_DEFS[o.id].name, icon: OATH_DEFS[o.id].icon
        }));
      }
      const ac = activeCurses(p);
      if (ac.length) {
        curses[p.id] = ac.map(c => ({ id: c.id, name: c.name }));
      }
    }
    return {
      shrines: (room.oathShrines || []).map(s => ({
        id: s.id, x: s.x, z: s.z, model: s.model, name: s.name,
        usedBy: [...s.usedBy]
      })),
      oaths, curses
    };
  }
};

function publicDef(def) {
  return {
    id: def.id, name: def.name, patron: def.patron, icon: def.icon,
    flavor: def.flavor, benefit: def.benefit, cost: def.cost, term: def.term,
    curseName: def.curseName, curseDesc: def.curseDesc
  };
}

// Expose the public oath catalog for the client ceremony UI / docs.
Oaths.publicCatalog = () => OATH_IDS.map(id => publicDef(OATH_DEFS[id]));

module.exports = Oaths;
